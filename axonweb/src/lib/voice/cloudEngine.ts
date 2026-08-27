/**
 * Voz neural, gerada no servidor (Google / ElevenLabs / OpenAI).
 *
 * Substitui a voz nativa, que foi testada e reprovada por soar artificial. Como
 * implementa a mesma interface `SpeechEngine`, nada fora daqui precisou mudar —
 * era exatamente para isto que a fronteira existia.
 *
 * O detalhe que faz a diferença: o áudio da PRÓXIMA frase é buscado enquanto a
 * atual ainda toca. Sem isso haveria um silêncio de ~1s entre cada frase, e a
 * fala soaria mais picotada que a voz nativa que estamos substituindo.
 */

import * as api from "../api";
import type { SpeechEngine } from "./tts";
import { loadVoicePrefs } from "./tts";

/** Um pedido de fala que já pode estar em voo. */
interface Pedido {
  texto: string;
  audio: Promise<Blob>;
  controller: AbortController;
}

export function createCloudEngine(): SpeechEngine {
  let audioEl: HTMLAudioElement | null = null;
  let urlAtual: string | null = null;
  let cancelado = false;

  // A frase seguinte, já sendo baixada enquanto a atual toca.
  let precarregado: Pedido | null = null;

  const liberarUrl = () => {
    if (urlAtual) {
      URL.revokeObjectURL(urlAtual);
      urlAtual = null;
    }
  };

  /** Um único <audio> reciclado: criar um por frase vaza memória no iOS. */
  const elemento = (): HTMLAudioElement => {
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.preload = "auto";
    }
    return audioEl;
  };

  const buscar = (texto: string): Pedido => {
    const prefs = loadVoicePrefs();
    const controller = new AbortController();
    return {
      texto,
      controller,
      audio: api.synthesizeSpeech(
        texto,
        prefs.voiceURI ?? null,
        prefs.rate,
        controller.signal,
      ),
    };
  };

  const engine: SpeechEngine = {
    id: "cloud",

    // Depende do servidor, não do aparelho. Se o provedor falhar, `speak`
    // rejeita e quem chama decide — não dá para saber antes.
    isAvailable: true,

    async warmup() {
      cancelado = false;
      // Tocar um áudio vazio dentro do gesto do usuário destrava o autoplay.
      // Sem isto a primeira frase é bloqueada pelo navegador.
      try {
        const el = elemento();
        el.src =
          "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjEyLjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAABAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA//8AAAAATGF2YzU4LjE4AAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//sQZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQZCIP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";
        el.volume = 0;
        await el.play().catch(() => {});
        el.pause();
        el.volume = 1;
      } catch {
        // Warmup é otimização; a fala ainda tem chance de funcionar sem ele.
      }
    },

    speak(text, opts) {
      if (cancelado || !text.trim()) return Promise.resolve();

      // Se já pré-carregamos exatamente esta frase, reaproveita o download.
      const pedido =
        precarregado && precarregado.texto === text ? precarregado : buscar(text);
      precarregado = null;

      return new Promise<void>((resolve) => {
        let terminou = false;
        const finalizar = () => {
          if (terminou) return;
          terminou = true;
          opts?.signal?.removeEventListener("abort", aoAbortar);
          resolve();
        };

        const aoAbortar = () => {
          pedido.controller.abort();
          const el = elemento();
          el.pause();
          finalizar();
        };
        opts?.signal?.addEventListener("abort", aoAbortar, { once: true });

        pedido.audio
          .then((blob) => {
            if (cancelado || opts?.signal?.aborted) return finalizar();

            liberarUrl();
            urlAtual = URL.createObjectURL(blob);

            const el = elemento();
            el.src = urlAtual;
            el.onended = finalizar;
            el.onerror = () => {
              console.warn("[voz] falha ao tocar o áudio");
              finalizar();
            };
            void el.play().catch((e) => {
              // Autoplay bloqueado: o gesto do usuário expirou.
              console.warn("[voz] reprodução bloqueada:", e?.name ?? e);
              finalizar();
            });
          })
          .catch((e) => {
            if (e?.name !== "AbortError") {
              console.warn("[voz] falha ao gerar a fala:", e?.message ?? e);
            }
            finalizar();
          });
      });
    },

    /**
     * Começa a baixar uma frase antes de ela ser falada. O SentenceQueue chama
     * isto para a próxima da fila enquanto a atual ainda toca.
     */
    prefetch(text: string) {
      if (cancelado || !text.trim()) return;
      precarregado?.controller.abort();
      precarregado = buscar(text);
      // Sem isto, uma falha no pré-carregamento vira "unhandled rejection" no
      // console; o erro real é tratado quando `speak` consome a mesma promise.
      precarregado.audio.catch(() => {});
    },

    cancel() {
      cancelado = true;
      precarregado?.controller.abort();
      precarregado = null;
      if (audioEl) {
        audioEl.pause();
        audioEl.onended = null;
        audioEl.removeAttribute("src");
      }
      liberarUrl();
      // Um cancel não é permanente: a próxima resposta volta a falar.
      queueMicrotask(() => {
        cancelado = false;
      });
    },
  };

  return engine;
}
