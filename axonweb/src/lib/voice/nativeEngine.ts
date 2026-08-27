/**
 * Voz nativa do aparelho, via Web Speech API (`speechSynthesis`).
 *
 * Custo zero e sem rede — mas a API tem três armadilhas conhecidas, todas
 * tratadas aqui:
 *
 *  1. `getVoices()` volta VAZIO na primeira chamada em quase todo navegador; a
 *     lista só chega no evento `voiceschanged`.
 *  2. O Chrome desktop trava utterances longas em ~15s. Falamos por frases
 *     curtas (ver sentenceQueue), e ainda assim mantemos o `pause()/resume()`
 *     periódico que é o workaround conhecido.
 *  3. O WebView do Android pode não ter o pacote de voz PT-BR instalado. Nesse
 *     caso não há voz utilizável e `isAvailable` fica false, para a UI avisar em
 *     vez de falhar em silêncio (ou pior: falar português com sotaque inglês).
 */

import type { SpeechEngine } from "./tts";
import { loadVoicePrefs } from "./tts";

/** O bug do Chrome aparece perto dos 15s; recarregamos bem antes. */
const KEEPALIVE_MS = 10_000;

/** Tempo máximo esperando o `voiceschanged` antes de seguir com o que houver. */
const VOICES_TIMEOUT_MS = 1_000;

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

/**
 * Lista de vozes, esperando o `voiceschanged` quando ela ainda não chegou.
 * O resultado é memorizado — só a primeira chamada espera.
 */
export function ensureVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesPromise) return voicesPromise;

  voicesPromise = new Promise((resolve) => {
    const s = synth();
    if (!s) return resolve([]);

    const jaTem = s.getVoices();
    if (jaTem.length > 0) return resolve(jaTem);

    let pronto = false;
    const finalizar = () => {
      if (pronto) return;
      pronto = true;
      s.removeEventListener("voiceschanged", finalizar);
      resolve(s.getVoices());
    };

    s.addEventListener("voiceschanged", finalizar);
    // Alguns aparelhos nunca disparam o evento; não podemos esperar para sempre.
    setTimeout(finalizar, VOICES_TIMEOUT_MS);
  });

  return voicesPromise;
}

/** Só as vozes em português, melhores primeiro. */
export function listPortugueseVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const pt = voices.filter((v) => v.lang?.toLowerCase().startsWith("pt"));
  return pt.sort((a, b) => {
    // pt-BR antes de pt-PT.
    const brA = a.lang.toLowerCase().startsWith("pt-br") ? 0 : 1;
    const brB = b.lang.toLowerCase().startsWith("pt-br") ? 0 : 1;
    if (brA !== brB) return brA - brB;
    // Vozes remotas (Google/Microsoft) soam MUITO melhor que as locais.
    const remotaA = a.localService ? 1 : 0;
    const remotaB = b.localService ? 1 : 0;
    return remotaA - remotaB;
  });
}

function pickVoice(voices: SpeechSynthesisVoice[], preferidaURI?: string): SpeechSynthesisVoice | null {
  const pt = listPortugueseVoices(voices);
  if (preferidaURI) {
    const escolhida = voices.find((v) => v.voiceURI === preferidaURI);
    if (escolhida) return escolhida;
  }
  return pt[0] ?? null;
}

export function createNativeEngine(): SpeechEngine {
  const s = synth();

  let vozes: SpeechSynthesisVoice[] = [];
  let temVozPt = false;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  // Cancelar dispara `onerror` nas utterances em voo; sem esta marca, um
  // cancelamento deliberado apareceria como falha no console.
  let cancelando = false;

  void ensureVoices().then((v) => {
    vozes = v;
    temVozPt = listPortugueseVoices(v).length > 0;
  });

  const pararKeepalive = () => {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
  };

  const engine: SpeechEngine = {
    id: "native",

    get isAvailable() {
      // Antes de as vozes carregarem assumimos que dá — senão o botão apareceria
      // desabilitado no primeiro instante e "consertaria sozinho" depois.
      return Boolean(s) && (vozes.length === 0 || temVozPt);
    },

    async warmup() {
      if (!s) return;
      // Falar uma string vazia dentro do gesto do usuário destrava o canal de
      // áudio; sem isto a primeira fala real pode ser engolida.
      try {
        s.cancel();
        const u = new SpeechSynthesisUtterance("");
        u.volume = 0;
        s.speak(u);
      } catch {
        // Warmup é otimização; se falhar, a fala ainda tem chance de funcionar.
      }
      if (vozes.length === 0) {
        vozes = await ensureVoices();
        temVozPt = listPortugueseVoices(vozes).length > 0;
      }
    },

    speak(text, opts) {
      return new Promise<void>((resolve) => {
        if (!s || !text.trim()) return resolve();

        if (opts?.signal?.aborted) return resolve();

        const prefs = loadVoicePrefs();
        // Última tentativa síncrona: se `ensureVoices` ainda não resolveu, a
        // lista pode ter chegado ao navegador nesse meio-tempo. Quem chama já
        // passou por `warmup()`, que espera de verdade — isto é só a rede de
        // segurança para o caso de alguém falar sem aquecer antes.
        if (vozes.length === 0) {
          vozes = s.getVoices();
          if (vozes.length > 0) temVozPt = listPortugueseVoices(vozes).length > 0;
        }

        const u = new SpeechSynthesisUtterance(text);
        const voz = pickVoice(vozes, prefs.voiceURI);
        if (voz) {
          u.voice = voz;
          u.lang = voz.lang;
        } else {
          u.lang = "pt-BR";
        }
        u.rate = prefs.rate;
        u.pitch = prefs.pitch;

        let terminou = false;
        const finalizar = () => {
          if (terminou) return;
          terminou = true;
          opts?.signal?.removeEventListener("abort", aoAbortar);
          if (!s.speaking && !s.pending) pararKeepalive();
          resolve();
        };

        const aoAbortar = () => {
          cancelando = true;
          s.cancel();
          finalizar();
        };

        u.onend = finalizar;
        u.onerror = (e) => {
          // "interrupted"/"canceled" são consequência de cancel() — esperados.
          if (!cancelando && e.error !== "interrupted" && e.error !== "canceled") {
            console.warn("[voz] falha ao falar:", e.error);
          }
          finalizar();
        };

        opts?.signal?.addEventListener("abort", aoAbortar, { once: true });

        cancelando = false;
        s.speak(u);

        // Workaround do bug de ~15s do Chrome desktop.
        if (!keepalive) {
          keepalive = setInterval(() => {
            if (!s.speaking) return pararKeepalive();
            s.pause();
            s.resume();
          }, KEEPALIVE_MS);
        }
      });
    },

    cancel() {
      if (!s) return;
      cancelando = true;
      pararKeepalive();
      s.cancel();
    },
  };

  return engine;
}
