/**
 * A fronteira trocável da voz do Axon.
 *
 * Por que a abstração vive no FRONTEND e não no backend: a voz nativa só existe
 * dentro do aparelho (`speechSynthesis`) e uma voz neural só existe no servidor
 * (a chave de API não pode ir para o cliente). Se a fronteira estivesse no
 * backend, a implementação nativa não teria onde encaixar.
 *
 * Trocar de provedor é escrever um segundo módulo com esta interface e mudar o
 * que `getEngine()` devolve. Nada mais no app sabe qual voz está tocando.
 */

import { createCloudEngine } from "./cloudEngine";
import { createNativeEngine } from "./nativeEngine";

export type SpeechState = "idle" | "loading" | "speaking";

export interface SpeechEngine {
  readonly id: "native" | "cloud";
  /** False quando o aparelho não tem voz utilizável (ex.: sem pacote PT-BR). */
  readonly isAvailable: boolean;
  /** Enfileira um trecho. A promise resolve quando ESSE trecho terminou. */
  speak(text: string, opts?: { signal?: AbortSignal }): Promise<void>;
  /** Interrompe imediatamente e descarta o que estiver na fila. */
  cancel(): void;
  /**
   * Destrava o canal de áudio. Precisa ser chamado DENTRO de um gesto do
   * usuário (o pointerdown do microfone) — navegadores bloqueiam áudio que não
   * nasce de uma interação, e o gesto "expira" se demorarmos demais.
   */
  warmup(): Promise<void>;
  /**
   * Adianta o trabalho de uma frase que ainda vai ser falada. Só o motor de
   * nuvem implementa (baixar o áudio leva ~1s; sem adiantar, haveria silêncio
   * entre as frases). O motor nativo não precisa e omite.
   */
  prefetch?(text: string): void;
}

/** Qual motor de voz usar. */
export type EngineId = "native" | "cloud";

/** Preferências que o usuário controla na tela de Configurações. */
export interface VoicePrefs {
  /**
   * A voz escolhida. Para o motor de nuvem é o id do catálogo do backend
   * ("google:pt-BR-Chirp3-HD-Aoede"); para o nativo é o `voiceURI` do aparelho.
   */
  voiceURI?: string;
  rate: number;
  pitch: number;
  /**
   * Nuvem por padrão: a voz nativa foi testada e reprovada por soar
   * artificial. O nativo continua disponível como alternativa offline.
   */
  engine: EngineId;
}

const PREFS_KEY = "axon_voice_prefs";

export const DEFAULT_PREFS: VoicePrefs = {
  rate: 1.0,
  pitch: 1.0,
  engine: "cloud",
};

export function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<VoicePrefs>) };
  } catch {
    // localStorage pode estar bloqueado (aba anônima, cookies desligados).
    return { ...DEFAULT_PREFS };
  }
}

export function saveVoicePrefs(prefs: VoicePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferência é conveniência, não pode derrubar a fala.
  }
}

let cached: SpeechEngine | null = null;
let cachedId: EngineId | null = null;

/**
 * O motor de voz em uso, conforme a preferência do usuário. Este é o ÚNICO
 * lugar do app que sabe qual motor está tocando.
 *
 * Os motores importam apenas TIPOS daqui, então o import direto não cria ciclo
 * em runtime.
 */
export function getEngine(): SpeechEngine {
  const querido = loadVoicePrefs().engine;
  if (!cached || cachedId !== querido) {
    cached?.cancel();
    cached = querido === "native" ? createNativeEngine() : createCloudEngine();
    cachedId = querido;
  }
  return cached;
}
