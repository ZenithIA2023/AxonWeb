/**
 * Captura de áudio do microfone via `MediaRecorder`.
 *
 * Corta sozinho em 60s / 2MB — o mesmo teto que o backend aplica em
 * `stt_service._MAX_BYTES` — para que uma gravação esquecida ligada não vire
 * uma cobrança de transcrição fora de controle.
 *
 * `track.stop()` ao final é obrigatório, não cosmético: sem ele o ícone de
 * microfone do navegador (ou do app instalado) continua aceso depois de
 * soltar o botão, e o Axon parece estar espionando o usuário.
 */

import { requestMicStream } from "./permission";

const MAX_DURATION_MS = 60_000;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMESLICE_MS = 250;

// Ordem de preferência: Opus é o menor e o que o backend já espera (a Fase 2
// foi testada com ele); os demais são o que Safari/iOS oferecem quando Opus
// não existe.
const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export interface VoiceRecording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface VoiceRecorderEvents {
  /** Nível de volume do microfone, 0 a 1 — chamado a cada quadro enquanto grava. */
  onLevel?: (level: number) => void;
  /**
   * Disparado quando a gravação é cortada sozinha (60s ou 2MB) — já entrega o
   * áudio capturado até aqui; não é preciso (nem correto) chamar `stop()`
   * depois disso.
   */
  onAutoStop?: (recording: VoiceRecording) => void;
}

export interface VoiceRecorder {
  start(): Promise<void>;
  /** Para a gravação e resolve com o áudio capturado. */
  stop(): Promise<VoiceRecording>;
  /** Para e descarta — usado no gesto de "deslizar para cancelar". */
  cancel(): void;
  readonly isRecording: boolean;
}

export function createVoiceRecorder(events: VoiceRecorderEvents = {}): VoiceRecorder {
  let stream: MediaStream | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let totalBytes = 0;
  let recording = false;
  let cancelled = false;
  let autoStopped = false;

  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let levelFrame: number | null = null;

  let resolveStop: ((r: VoiceRecording) => void) | null = null;
  let rejectStop: ((e: Error) => void) | null = null;

  const cleanupStream = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const clearAutoStopTimer = () => {
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }
  };

  const stopLevelLoop = () => {
    if (levelFrame !== null) {
      cancelAnimationFrame(levelFrame);
      levelFrame = null;
    }
    const ctx = audioCtx;
    audioCtx = null;
    analyser = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  };

  const startLevelLoop = () => {
    if (!stream || !events.onLevel) return;
    try {
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (const v of data) {
          const norm = (v - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        // Ganho de 4x: RMS de voz normal fica bem abaixo de 1.0 cru, e o
        // medidor parece morto sem isso.
        events.onLevel?.(Math.min(1, rms * 4));
        levelFrame = requestAnimationFrame(tick);
      };
      levelFrame = requestAnimationFrame(tick);
    } catch {
      // Medidor de nível é cosmético — segue gravando sem ele se o navegador recusar.
    }
  };

  /** Único caminho de parada: manual, cancelamento ou automático convergem aqui. */
  const triggerStop = (auto: boolean) => {
    if (!recording || !mediaRecorder) return;
    autoStopped = auto;
    clearAutoStopTimer();
    stopLevelLoop();
    recording = false;
    mediaRecorder.stop();
  };

  return {
    get isRecording() {
      return recording;
    },

    async start() {
      if (recording) return;
      cancelled = false;
      autoStopped = false;
      chunks = [];
      totalBytes = 0;

      stream = await requestMicStream();

      const mimeType = pickMimeType();
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size === 0) return;
        chunks.push(e.data);
        totalBytes += e.data.size;
        if (totalBytes >= MAX_BYTES) triggerStop(true);
      };

      mediaRecorder.onstop = () => {
        cleanupStream();
        const durationMs = Date.now() - startedAt;
        const finalType = mediaRecorder?.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: finalType });
        chunks = [];

        const doneResolve = resolveStop;
        const doneReject = rejectStop;
        resolveStop = null;
        rejectStop = null;

        if (cancelled) {
          doneReject?.(new Error("Gravação cancelada"));
          return;
        }

        const result: VoiceRecording = { blob, mimeType: finalType, durationMs };
        if (autoStopped) {
          events.onAutoStop?.(result);
        } else {
          doneResolve?.(result);
        }
      };

      recording = true;
      startedAt = Date.now();
      mediaRecorder.start(TIMESLICE_MS);
      startLevelLoop();

      autoStopTimer = setTimeout(() => triggerStop(true), MAX_DURATION_MS);
    },

    stop() {
      return new Promise<VoiceRecording>((resolve, reject) => {
        if (!recording || !mediaRecorder) {
          reject(new Error("Nenhuma gravação em andamento"));
          return;
        }
        resolveStop = resolve;
        rejectStop = reject;
        triggerStop(false);
      });
    },

    cancel() {
      if (!recording || !mediaRecorder) {
        cleanupStream();
        return;
      }
      cancelled = true;
      triggerStop(false);
    },
  };
}
