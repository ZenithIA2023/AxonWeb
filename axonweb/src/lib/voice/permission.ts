/**
 * Acesso ao microfone e classificação dos erros do `getUserMedia` em
 * mensagens que o usuário entende.
 *
 * O navegador não distingue "nunca perguntei" de "usuário negou" no mesmo
 * enum — os dois viram `NotAllowedError`. Por isso a mensagem cobre as duas
 * possibilidades em vez de fingir que sabe qual foi.
 */

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
    throw new Error(MIC_ERROR_MESSAGES[classifyMicError(err)]);
  }
}
