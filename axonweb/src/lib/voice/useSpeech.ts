/**
 * Liga a resposta em streaming do Axon à voz do aparelho.
 *
 * Regra de produto: só fala o que o usuário pediu para ouvir. Na fase 1 isso é
 * um toggle; quando a entrada por voz existir, mensagens FALADAS sempre falam e
 * mensagens DIGITADAS nunca — ouvir uma resposta que você digitou é intrusivo.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { createSentenceQueue, type SentenceQueue } from "./sentenceQueue";
import { getEngine } from "./tts";

const ENABLED_KEY = "axon_voice_enabled";

function lerPreferencia(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export interface UseSpeechOptions {
  /**
   * Chamado quando cada frase COMEÇA a ser falada. A tela de voz usa isso para
   * destacar a frase que está saindo agora; o chat de texto não passa nada.
   * A frase chega já sanitizada (sem markdown, "14:30" virou "14 e 30"), então
   * não bate caractere a caractere com o texto exibido.
   */
  onSentenceStart?: (frase: string) => void;
}

export interface UseSpeech {
  /** O usuário quer ouvir as respostas? */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /** Há fala tocando agora. */
  speaking: boolean;
  /** O aparelho tem voz utilizável (no Android pode faltar o pacote PT-BR). */
  available: boolean;
  /**
   * Começa a escutar uma nova resposta. Chamar ao enviar a mensagem.
   * `force=true` fala mesmo com o toggle desligado — usado pela entrada por
   * voz: mensagem FALADA sempre fala de volta, digitada respeita o toggle.
   */
  begin: (force?: boolean) => void;
  /** Cada delta de texto do stream. */
  push: (chunk: string) => void;
  /** Fim do stream. */
  finish: () => void;
  /** Para a fala imediatamente e descarta o resto. */
  stop: () => void;
  /** Destrava o áudio; chamar DENTRO do gesto do usuário (clique/toque). */
  warmup: () => void;
}

export function useSpeech(options: UseSpeechOptions = {}): UseSpeech {
  const [enabled, setEnabledState] = useState<boolean>(lerPreferencia);
  const [speaking, setSpeaking] = useState(false);
  const [available, setAvailable] = useState(true);

  const queueRef = useRef<SentenceQueue | null>(null);
  // `enabled` é lido de dentro de callbacks do stream, que capturariam um valor
  // velho — o ref mantém sempre o atual.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Mesmo motivo: `begin` é memoizado uma vez e chamaria sempre o callback da
  // primeira renderização.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const stop = useCallback(() => {
    queueRef.current?.cancel();
    queueRef.current = null;
    setSpeaking(false);
  }, []);

  const setEnabled = useCallback(
    (v: boolean) => {
      setEnabledState(v);
      try {
        localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
      } catch {
        // Preferência é conveniência; não pode derrubar nada.
      }
      if (!v) stop();
    },
    [stop],
  );

  const warmup = useCallback(() => {
    const engine = getEngine();
    // `warmup` é o único ponto que ESPERA a lista de vozes chegar (o
    // `voiceschanged` só dispara depois do primeiro tick). Por isso ele roda no
    // clique que liga a voz, bem antes da primeira fala.
    void engine.warmup().then(() => setAvailable(engine.isAvailable));
  }, []);

  const begin = useCallback((force = false) => {
    // Uma resposta nova cancela a anterior — senão duas falam por cima.
    queueRef.current?.cancel();
    if (!enabledRef.current && !force) {
      queueRef.current = null;
      return;
    }
    const engine = getEngine();
    setAvailable(engine.isAvailable);
    if (!engine.isAvailable) {
      queueRef.current = null;
      return;
    }
    setSpeaking(true);
    queueRef.current = createSentenceQueue(engine, {
      onIdle: () => setSpeaking(false),
      onSentenceStart: (frase) => optionsRef.current.onSentenceStart?.(frase),
    });
  }, []);

  const push = useCallback((chunk: string) => {
    queueRef.current?.push(chunk);
  }, []);

  const finish = useCallback(() => {
    queueRef.current?.flush();
  }, []);

  // O app saindo de foco tem que calar a voz: sem isto o navegador continua
  // falando com a aba em segundo plano, o que é péssimo.
  useEffect(() => {
    const aoEsconder = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", aoEsconder);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", aoEsconder);
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [stop]);

  return { enabled, setEnabled, speaking, available, begin, push, finish, stop, warmup };
}
