import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

/**
 * Botão físico de voltar do Android.
 *
 * Sem tratamento, o Capacitor fecha o app a partir de QUALQUER tela — o
 * usuário toca em voltar esperando sair de uma subtela e perde o app inteiro.
 *
 * Comportamento implementado:
 * - Há histórico → volta uma tela.
 * - Está numa tela raiz → não sai direto: exige um segundo toque em 2s
 *   ("Toque de novo para sair"), padrão consagrado no Android.
 */

// Telas onde voltar significa "sair do app", não "voltar uma tela".
const ROOT_ROUTES = ["/dashboard", "/login", "/"];

const EXIT_WINDOW_MS = 2000;

export function initBackButton(onConfirmExit: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  let armedAt = 0;

  const handle = App.addListener("backButton", ({ canGoBack }) => {
    const rota = window.location.hash.replace(/^#/, "").split("?")[0] || "/";
    const naRaiz = ROOT_ROUTES.includes(rota);

    if (!naRaiz && canGoBack) {
      window.history.back();
      return;
    }

    // Na raiz: primeiro toque avisa, segundo dentro da janela realmente sai.
    const agora = Date.now();
    if (agora - armedAt < EXIT_WINDOW_MS) {
      App.exitApp();
      return;
    }

    armedAt = agora;
    onConfirmExit();
  });

  return () => {
    handle.then((h) => h.remove()).catch(() => {});
  };
}
