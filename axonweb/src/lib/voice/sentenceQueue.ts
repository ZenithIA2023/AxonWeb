/**
 * Corta o texto que chega em streaming em FRASES e vai mandando falar.
 *
 * Sem isto o Axon só começaria a falar depois da resposta inteira pronta — o que
 * medimos em ~8,5s numa pergunta comum. Falando por frase, a voz começa assim
 * que a primeira termina (~2,5s) e o resto chega enquanto ele já está falando.
 *
 * Os cuidados que fazem a diferença entre soar natural e soar picotado:
 *  - não cortar em "14.30", "Dr." ou "ex." (ponto que não termina frase);
 *  - não falar um fragmento curto demais ("Ok.") isolado;
 *  - falar mesmo sem pontuação se o texto parar de chegar (o modelo pausou para
 *    chamar uma ferramenta e a frase ficaria pendurada).
 */

import type { SpeechEngine } from "./tts";
import { sanitizeForSpeech } from "./sanitize";

/** Curto demais para valer uma fala isolada; espera o próximo trecho. */
const MIN_CHARS = 25;

/** Sem novos deltas por este tempo, fala o que tiver acumulado. */
const IDLE_FLUSH_MS = 2_500;

/** Nunca segurar mais que isto sem falar, mesmo sem pontuação. */
const MAX_BUFFER = 320;

/**
 * Abreviações comuns em PT-BR cujo ponto NÃO termina a frase.
 * Sem isto, "às 9h com o Dr. Silva" viraria duas falas.
 */
const ABREVIACOES = [
  "sr", "sra", "srta", "dr", "dra", "prof", "profa", "eng",
  "ex", "etc", "ref", "obs", "pág", "art", "av", "núm", "no",
  "seg", "ter", "qua", "qui", "sex", "sáb", "dom",
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** True se o ponto em `idx` fecha uma frase de verdade. */
function fimDeFrase(texto: string, idx: number): boolean {
  const ch = texto[idx];
  if (ch !== "." ) return true; // ! ? … sempre fecham

  // Número dos dois lados: "14.30", "R$ 1.500" — não é fim de frase.
  const antes = texto[idx - 1];
  const depois = texto[idx + 1];
  if (/\d/.test(antes ?? "") && /\d/.test(depois ?? "")) return false;

  // Reticências em pontos separados: deixa o último decidir.
  if (depois === ".") return false;

  const palavra = texto.slice(0, idx).match(/([\p{L}]+)$/u)?.[1]?.toLowerCase();
  if (palavra && ABREVIACOES.includes(palavra)) return false;

  // Inicial de nome: "J. Silva".
  if (palavra && palavra.length === 1) return false;

  return true;
}

/**
 * Acha o fim da primeira frase completa do buffer.
 * Devolve o índice logo APÓS o separador, ou -1 se ainda não há frase fechada.
 */
function proximoCorte(buffer: string): number {
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…") continue;
    if (!fimDeFrase(buffer, i)) continue;

    // Consome pontuação repetida ("?!", "...").
    let fim = i + 1;
    while (fim < buffer.length && /[.!?…]/.test(buffer[fim])) fim++;

    // Só corta se vier espaço/quebra depois — senão a frase pode continuar
    // (ainda estamos no meio de um delta do stream).
    if (fim < buffer.length && !/\s/.test(buffer[fim])) continue;

    if (fim >= buffer.length) return -1; // pode chegar mais pontuação
    return fim;
  }
  return -1;
}

export interface SentenceQueue {
  /** Recebe cada delta de texto do stream. */
  push(chunk: string): void;
  /** Fim do stream: fala o que sobrou no buffer. */
  flush(): void;
  /** Para tudo e descarta o que não foi falado. */
  cancel(): void;
}

export interface SentenceQueueOptions {
  /** Chamado quando uma frase COMEÇA a ser falada (para destacar na tela). */
  onSentenceStart?: (frase: string) => void;
  /** Chamado quando a fila esvazia e nada mais está sendo falado. */
  onIdle?: () => void;
}

export function createSentenceQueue(
  engine: SpeechEngine,
  options: SentenceQueueOptions = {},
): SentenceQueue {
  let buffer = "";
  let cancelado = false;
  let falando = false;
  const pendentes: string[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const limparTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  /** Fala a fila em ordem, uma frase por vez. */
  const bombear = async () => {
    if (falando || cancelado) return;
    falando = true;
    while (pendentes.length > 0 && !cancelado) {
      const frase = pendentes.shift()!;
      options.onSentenceStart?.(frase);
      // Adianta a próxima ANTES de falar esta: com voz de nuvem, buscar o áudio
      // leva ~1s, e sem sobrepor haveria um silêncio entre cada frase.
      if (pendentes.length > 0) engine.prefetch?.(pendentes[0]);
      await engine.speak(frase);
    }
    falando = false;
    if (!cancelado && pendentes.length === 0) options.onIdle?.();
  };

  const enfileirar = (bruto: string) => {
    const limpo = sanitizeForSpeech(bruto);
    // Depois de limpar pode não sobrar nada pronunciável (só um emoji, p.ex.).
    if (!/[\p{L}\p{N}]/u.test(limpo)) return;
    pendentes.push(limpo);
    void bombear();
  };

  /** Tira do buffer todas as frases já fechadas. */
  const drenar = () => {
    for (;;) {
      const corte = proximoCorte(buffer);
      if (corte === -1) break;

      const frase = buffer.slice(0, corte).trim();
      // Fragmento curto ("Ok.") espera o próximo trecho para não picotar —
      // a menos que o buffer já esteja grande, e aí segurar é pior.
      if (frase.length < MIN_CHARS && buffer.length < MAX_BUFFER) break;

      buffer = buffer.slice(corte);
      enfileirar(frase);
    }

    // Sem pontuação e já muito longo: fala assim mesmo, cortando no último
    // espaço para não partir palavra ao meio.
    if (buffer.length > MAX_BUFFER) {
      const corte = buffer.lastIndexOf(" ", MAX_BUFFER);
      const at = corte > MIN_CHARS ? corte : MAX_BUFFER;
      enfileirar(buffer.slice(0, at).trim());
      buffer = buffer.slice(at);
    }
  };

  const agendarIdle = () => {
    limparTimer();
    idleTimer = setTimeout(() => {
      // O stream parou (provavelmente uma ferramenta rodando). Não deixa a
      // frase pendurada em silêncio.
      const resto = buffer.trim();
      if (resto.length >= MIN_CHARS) {
        buffer = "";
        enfileirar(resto);
      }
    }, IDLE_FLUSH_MS);
  };

  return {
    push(chunk: string) {
      if (cancelado || !chunk) return;
      buffer += chunk;
      drenar();
      agendarIdle();
    },

    flush() {
      if (cancelado) return;
      limparTimer();
      const resto = buffer.trim();
      buffer = "";
      if (resto) enfileirar(resto);
      // Stream acabou sem nada para falar e nada em voo: já está ocioso.
      if (!falando && pendentes.length === 0) options.onIdle?.();
    },

    cancel() {
      cancelado = true;
      limparTimer();
      buffer = "";
      pendentes.length = 0;
      engine.cancel();
    },
  };
}
