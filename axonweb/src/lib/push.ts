import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

import * as api from "./api";

/**
 * Push notifications no app Android.
 *
 * Na web nada disso roda: `isSupported()` devolve false e todas as funções são
 * no-op, então o mesmo build continua servindo as duas plataformas.
 *
 * A permissão NÃO é pedida na abertura. O Android 13+ exige pedido explícito e
 * uma recusa é difícil de reverter (o usuário tem que ir às configurações do
 * sistema), então só pedimos quando o valor já ficou visível — na primeira
 * sugestão que o Axon gera.
 */

const ASKED_KEY = "axon_push_asked";
// O plugin não devolve o token depois do registro, então guardamos o último
// recebido — é ele que o logout precisa remover do backend.
const TOKEN_KEY = "axon_push_token";

export function isSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/** Já pedimos a permissão alguma vez neste aparelho? */
export function hasAsked(): boolean {
  return localStorage.getItem(ASKED_KEY) === "1";
}

function markAsked(): void {
  localStorage.setItem(ASKED_KEY, "1");
}

/**
 * Registra os listeners do FCM. Chamar uma vez, no início do app.
 *
 * `registration` chega de forma assíncrona depois de `register()` — é aí que o
 * token do aparelho aparece e vai para o backend.
 */
export function initPushListeners(onOpenNotification?: (data: Record<string, unknown>) => void): void {
  if (!isSupported()) return;

  PushNotifications.addListener("registration", (token) => {
    localStorage.setItem(TOKEN_KEY, token.value);

    // Reenviado a cada abertura de propósito: o FCM pode rotacionar o token, e
    // o backend trata o reenvio como atualização, não como duplicata.
    void api.registerDeviceToken(token.value).catch(() => {
      // Sem rede agora: o próximo início do app tenta de novo.
    });
  });

  PushNotifications.addListener("registrationError", (err) => {
    console.warn("[push] falha ao registrar no FCM", err);
  });

  // Toque na notificação com o app fechado/em segundo plano: leva o usuário
  // para a tela correspondente.
  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = (action.notification?.data ?? {}) as Record<string, unknown>;
    onOpenNotification?.(data);
  });
}

/**
 * Pede a permissão e registra o aparelho. Idempotente: se o usuário já
 * respondeu antes, não insiste.
 *
 * Devolve true se o aparelho ficou registrado.
 */
export async function requestPermissionAndRegister(): Promise<boolean> {
  if (!isSupported()) return false;

  if (!Capacitor.isPluginAvailable("PushNotifications")) {
    console.warn("[push] plugin nativo ausente — APK precisa ser reinstalado");
    return false;
  }

  try {
    let status = await PushNotifications.checkPermissions();

    if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
      // Só existe UMA chance real de perguntar: depois de negado, o sistema não
      // mostra o diálogo de novo.
      markAsked();
      status = await PushNotifications.requestPermissions();
    }

    if (status.receive !== "granted") {
      markAsked();
      return false;
    }

    // Dispara o listener "registration" acima, que envia o token ao backend.
    await PushNotifications.register();
    markAsked();
    return true;
  } catch (e) {
    console.warn("[push] erro ao pedir permissão", e);
    return false;
  }
}

/**
 * Estado atual do push neste aparelho, para a tela de Configurações.
 *
 * `permission` reflete o sistema operacional: uma vez negada, o Android não
 * mostra mais o diálogo, e só as configurações do aparelho revertem — por isso
 * a tela precisa saber diferenciar "desligado por nós" de "bloqueado no
 * sistema".
 */
export async function getStatus(): Promise<{
  supported: boolean;
  permission: "granted" | "denied" | "prompt";
  registered: boolean;
  diagnostic?: string;
}> {
  if (!isSupported()) {
    return { supported: false, permission: "prompt", registered: false };
  }

  // O plugin nativo só existe em APK compilado DEPOIS de instalá-lo. Em live
  // reload o JS atualiza sozinho, mas a ponte nativa não — então um app antigo
  // falha aqui em silêncio. Detectar isso explicitamente evita caçar fantasma.
  if (!Capacitor.isPluginAvailable("PushNotifications")) {
    return {
      supported: true,
      permission: "prompt",
      registered: false,
      diagnostic: "APK desatualizado: reinstale a versão mais recente.",
    };
  }

  try {
    const status = await PushNotifications.checkPermissions();
    const permission =
      status.receive === "granted"
        ? "granted"
        : status.receive === "denied"
          ? "denied"
          : "prompt";

    return {
      supported: true,
      permission,
      registered: permission === "granted" && !!localStorage.getItem(TOKEN_KEY),
    };
  } catch {
    return { supported: true, permission: "prompt", registered: false };
  }
}

/**
 * Desliga o push neste aparelho: tira o token do backend, então o servidor
 * para de enviar. A permissão do sistema continua concedida — religar depois
 * não passa pelo diálogo do Android de novo.
 */
export async function disable(): Promise<void> {
  if (!isSupported()) return;

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  const authToken = api.getAuthToken();
  if (authToken) {
    await api.unregisterDeviceToken(token, authToken).catch(() => {});
  }
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Desfaz o registro deste aparelho — usado no logout, para que quem sair pare
 * de receber os push da conta.
 */
export async function unregisterDevice(authToken: string): Promise<void> {
  if (!isSupported()) return;

  const token = localStorage.getItem(TOKEN_KEY);

  if (token) {
    // O logout já limpou a sessão neste ponto, então o token de autenticação
    // vem por parâmetro — sem ele o backend não saberia de quem é o aparelho e
    // a conta continuaria recebendo push aqui.
    await api.unregisterDeviceToken(token, authToken).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
  }

  try {
    await PushNotifications.removeAllDeliveredNotifications();
  } catch {
    // Limpeza da bandeja é secundária; não pode impedir o logout.
  }
}
