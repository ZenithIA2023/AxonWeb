import { useCallback, useRef, useState } from "react";
import { Loader2, Mic, X } from "lucide-react";

import type { UseVoiceSession } from "../../lib/voice/useVoiceSession";

// Distância (px) de deslize antes de armar o cancelamento — abaixo disso um
// tremor da mão não deve descartar a gravação sem querer.
const ARM_CANCEL_PX = 56;
// Distância que já cancela na hora, sem esperar soltar o dedo — evita manter
// o microfone ligado enquanto o usuário claramente já desistiu.
const AUTO_CANCEL_PX = 120;

interface VoiceButtonProps {
  session: UseVoiceSession;
  /** Chamado no pointerdown (gesto real do usuário) para destravar áudio. */
  onWarmup?: () => void;
  disabled?: boolean;
}

/**
 * Botão de push-to-talk: pressiona e segura para gravar, solta para enviar,
 * desliza para o lado para cancelar. `touch-action: none` e `preventDefault`
 * no pointerdown evitam que o WebView selecione texto ou role a tela durante
 * a gravação — sem isso o gesto de segurar vira "selecionar" no celular.
 */
export function VoiceButton({ session, onWarmup, disabled }: VoiceButtonProps) {
  const [dragX, setDragX] = useState(0);
  const [armed, setArmed] = useState(false);
  const startXRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);

  const resetDrag = useCallback(() => {
    setDragX(0);
    setArmed(false);
    pointerIdRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || session.status === "processing") return;
      e.preventDefault();

      pointerIdRef.current = e.pointerId;
      startXRef.current = e.clientX;
      setDragX(0);
      setArmed(false);

      e.currentTarget.setPointerCapture(e.pointerId);
      onWarmup?.();
      session.press();
    },
    [disabled, onWarmup, session]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== e.pointerId) return;

      // Só o eixo horizontal importa; deslizar para cima/baixo não cancela.
      const dx = e.clientX - startXRef.current;
      const dist = Math.abs(dx);

      if (dist >= AUTO_CANCEL_PX) {
        session.cancelNow();
        resetDrag();
        return;
      }

      setDragX(dx);
      setArmed(dist >= ARM_CANCEL_PX);
    },
    [resetDrag, session]
  );

  const finish = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== e.pointerId) return;
      session.release(armed);
      resetDrag();
    },
    [armed, resetDrag, session]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== e.pointerId) return;
      session.cancelNow();
      resetDrag();
    },
    [resetDrag, session]
  );

  const recording = session.status === "recording";
  const processing = session.status === "processing";

  // Anel que cresce com o nível do microfone — precisa ser inline porque o
  // valor muda a cada quadro; classe Tailwind estática não serviria.
  const ringScale = 1 + session.level * 0.6;

  return (
    <div className="relative">
      {recording && (
        <div
          className={`pointer-events-none absolute -top-11 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[0.68rem] font-semibold shadow-card backdrop-blur-2xl transition-colors ${
            armed
              ? "border-rose-300/30 bg-rose-500/15 text-rose-600 dark:text-rose-100"
              : "border-soft bg-surface-elevated text-muted"
          }`}
        >
          {armed ? "Solte para cancelar" : "Deslize para cancelar"}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finish}
        onPointerCancel={handlePointerCancel}
        style={{
          touchAction: "none",
          transform: recording ? `translateX(${dragX}px)` : undefined,
        }}
        className={`relative flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-2xl border shadow-card backdrop-blur-2xl transition active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45 ${
          armed
            ? "border-rose-300/30 bg-rose-500/15 text-rose-600 dark:text-rose-100"
            : recording
            ? "border-accent-soft bg-[var(--accent-strong)] text-white"
            : "border-soft bg-surface-muted text-secondary"
        }`}
        aria-label={
          processing
            ? "Processando fala"
            : recording
            ? "Solte para enviar, deslize para cancelar"
            : "Segure para falar com o Axon"
        }
      >
        {recording && !armed && (
          <span
            className="pointer-events-none absolute inset-0 rounded-2xl bg-[var(--accent)]/30"
            style={{ transform: `scale(${ringScale})` }}
          />
        )}

        <span className="relative">
          {processing ? (
            <Loader2 className="h-4.5 w-4.5 animate-spin" />
          ) : armed ? (
            <X className="h-4.5 w-4.5" />
          ) : (
            <Mic className="h-4.5 w-4.5" />
          )}
        </span>
      </button>
    </div>
  );
}
