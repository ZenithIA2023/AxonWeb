/**
 * Acesso ao microfone e classificação dos erros do `getUserMedia` em
 * mensagens que o usuário entende.
 *
 * O navegador não distingue "nunca perguntei" de "usuário negou" no mesmo
 * enum — os dois viram `NotAllowedError`. Por isso a mensagem cobre as duas
 * possibilidades em vez de fingir que sabe qual foi.
 */

import { Capacitor } from "@capacitor/core";

export type MicPermissionError =
  | "denied"
  | "not-found"
  | "not-readable"
  | "insecure-context"
  | "unsupported"
  | "unknown";

export const MIC_ERROR_MESSAGES: Record<MicPermissionError, string> = {
  denied:
    "Permissão de microfone negada. Ative nas configurações do navegador ou do app e tente de novo.",
  "not-found": "Nenhum microfone encontrado neste aparelho.",
  "not-readable": "O microfone está sendo usado por outro aplicativo.",
  "insecure-context": "A gravação de voz só funciona em conexão segura (HTTPS).",
  unsupported: "Este navegador não suporta gravação de voz.",
  unknown: "Não foi possível acessar o microfone.",
};

function classifyMicError(err: unknown): MicPermissionError {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "SecurityError") return "denied";
    if (err.name === "NotFoundError" || err.name === "OverconstrainedError") return "not-found";
    if (err.name === "NotReadableError" || err.name === "AbortError") return "not-readable";
  }
  return "unknown";
}

/** True quando o aparelho/navegador oferece a API mínima para gravar. */
export function canRecordVoice(): boolean {
  return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/**
 * Um APK instalado ANTES do manifest ganhar `RECORD_AUDIO`/`MODIFY_AUDIO_SETTINGS`
 * (Fase 4) não mostra diálogo nenhum: o `BridgeWebChromeClient` do Capacitor
 * recusa o `getUserMedia` na hora, sem perguntar nada ao usuário — a mesma
 * falha silenciosa que o `push.ts` já trata para o plugin de notificações.
 *
 * Sem plugin nativo aqui (a Fase 4 não criou nenhum) não dá para checar
 * `Capacitor.isPluginAvailable`, mas a Permissions API entrega um sinal quase
 * tão bom: se o sistema diz "prompt" (nunca decidiu nada) e ainda assim o
 * `getUserMedia` rejeitou na mesma hora sem diálogo, quem recusou foi a
 * WebView por falta da permissão no manifest, não o usuário.
 */
async function looksLikeOutdatedApk(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const status = await navigator.permissions?.query({
      name: "microphone" as PermissionName,
    });
    return status?.state === "prompt";
  } catch {
    // Nem toda WebView implementa a Permissions API para microfone — sem
    // esse dado, não arrisca um diagnóstico que pode estar errado.
    return false;
  }
}

/**
 * Pede o microfone e devolve o stream, ou lança um erro com mensagem em
 * português pronta para mostrar ao usuário.
 */
export async function requestMicStream(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error(MIC_ERROR_MESSAGES["insecure-context"]);
  }
  if (!canRecordVoice()) {
    throw new Error(MIC_ERROR_MESSAGES.unsupported);
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const kind = classifyMicError(err);
    if (kind === "denied" && (await looksLikeOutdatedApk())) {
      throw new Error("APK desatualizado: reinstale a versão mais recente do Axon para gravar áudio.");
    }
    throw new Error(MIC_ERROR_MESSAGES[kind]);
  }
}
