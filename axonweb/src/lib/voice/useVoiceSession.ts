/**
 * Orquestra o ciclo de vida de uma gravação por voz: pressionar, gravar,
 * soltar (envia) ou cancelar (descarta). Não fala com o backend — só entrega
 * o áudio pronto via `onRecordingReady`; quem manda para `/voice/message` é
 * quem usa o hook (mesma divisão que o chat de texto já tem entre estado da
 * tela e chamada de API).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createVoiceRecorder,
  type VoiceRecorder,
  type VoiceRecording,
} from "./recorder";
import { canRecordVoice, MIC_ERROR_MESSAGES } from "./permission";

export type VoiceSessionStatus = "idle" | "recording" | "processing";

export interface UseVoiceSessionOptions {
  /** Gravação pronta para enviar — nunca chamado se o usuário cancelou. */
  onRecordingReady: (recording: VoiceRecording) => void;
  /** Erro de permissão/gravação, com mensagem já em português. */
  onError?: (message: string) => void;
}

export interface UseVoiceSession {
  status: VoiceSessionStatus;
  /** Nível do microfone, 0 a 1, para o medidor visual. */
  level: number;
  /** False quando o navegador/aparelho não oferece gravação. */
  available: boolean;
  /** Início do toque no botão. */
  press: () => void;
  /** Fim do toque. `shouldCancel` vem do gesto de deslizar. */
  release: (shouldCancel: boolean) => void;
  /** Cancela no meio do gesto (ex.: dedo saiu longe demais da área do botão). */
  cancelNow: () => void;
  /** Chamar quando o backend terminou de responder (sucesso ou erro). */
  finishProcessing: () => void;
}

export function useVoiceSession(options: UseVoiceSessionOptions): UseVoiceSession {
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<VoiceRecorder | null>(null);
  // release() pode chegar ANTES de start() terminar de pedir permissão — este
  // flag garante que a gravação é cancelada assim que (se) ela começar.
  const pendingCancelRef = useRef(false);
  const statusRef = useRef<VoiceSessionStatus>("idle");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const available = canRecordVoice();

  const setStatusBoth = useCallback((s: VoiceSessionStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const ensureRecorder = useCallback((): VoiceRecorder => {
    if (recorderRef.current) return recorderRef.current;
    const recorder = createVoiceRecorder({
      onLevel: setLevel,
      onAutoStop: (recording) => {
        setStatusBoth("processing");
        setLevel(0);
        optionsRef.current.onRecordingReady(recording);
      },
    });
    recorderRef.current = recorder;
    return recorder;
  }, [setStatusBoth]);

  const press = useCallback(() => {
    if (!available) {
      optionsRef.current.onError?.(MIC_ERROR_MESSAGES.unsupported);
      return;
    }
    if (statusRef.current === "processing") return;

    pendingCancelRef.current = false;
    const recorder = ensureRecorder();
    // Otimista: assume que vai gravar. Se falhar ou for cancelada antes de
    // começar, volta para "idle" nos ramos abaixo.
    setStatusBoth("recording");

    recorder
      .start()
      .then(() => {
        if (pendingCancelRef.current) {
          recorder.cancel();
          setStatusBoth("idle");
          setLevel(0);
        }
      })
      .catch((err: unknown) => {
        setStatusBoth("idle");
        setLevel(0);
        optionsRef.current.onError?.(err instanceof Error ? err.message : MIC_ERROR_MESSAGES.unknown);
      });
  }, [available, ensureRecorder, setStatusBoth]);

  const release = useCallback(
    (shouldCancel: boolean) => {
      const recorder = recorderRef.current;

      if (!recorder || !recorder.isRecording) {
        // Ainda aguardando permissão — marca para cancelar quando (se) iniciar.
        pendingCancelRef.current = true;
        setStatusBoth("idle");
        setLevel(0);
        return;
      }

      if (shouldCancel) {
        recorder.cancel();
        setStatusBoth("idle");
        setLevel(0);
        return;
      }

      setStatusBoth("processing");
      setLevel(0);
      recorder
        .stop()
        .then((recording) => optionsRef.current.onRecordingReady(recording))
        .catch(() => setStatusBoth("idle"));
    },
    [setStatusBoth]
  );

  const cancelNow = useCallback(() => {
    pendingCancelRef.current = true;
    recorderRef.current?.cancel();
    setStatusBoth("idle");
    setLevel(0);
  }, [setStatusBoth]);

  const finishProcessing = useCallback(() => {
    setStatusBoth("idle");
  }, [setStatusBoth]);

  // Troca de tela / desmonte com gravação em andamento: cancela, não deixa o
  // microfone ligado nem uma gravação órfã sendo processada.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
    };
  }, []);

  return { status, level, available, press, release, cancelNow, finishProcessing };
}
