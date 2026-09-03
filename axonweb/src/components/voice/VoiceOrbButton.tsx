/**
 * Push-to-talk da página de voz: um círculo grande, com gradiente e anel que
 * pulsa enquanto grava.
 *
 * A máquina de gesto é a mesma do `VoiceButton` do chat (pointer capture,
 * deslizar para cancelar) — o que muda é só a pele. Os dois consomem a mesma
 * `UseVoiceSession`, então a lógica de gravação continua num lugar só.
 */

import { useCallback, useRef, useState } from "react";
import { Loader2, Mic, X } from "lucide-react";

import type { UseVoiceSession } from "../../lib/voice/useVoiceSession";

// Distância (px) de deslize antes de armar o cancelamento — abaixo disso um
// tremor da mão não deve descartar a gravação sem querer.
const ARM_CANCEL_PX = 56;
// Distância que já cancela na hora, sem esperar soltar o dedo.
const AUTO_CANCEL_PX = 120;

interface VoiceOrbButtonProps {
  session: UseVoiceSession;
  /** Chamado no pointerdown (gesto real do usuário) para destravar o áudio. */
  onWarmup?: () => void;
  disabled?: boolean;
}

export function VoiceOrbButton({ session, onWarmup, disabled }: VoiceOrbButtonProps) {
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
      // Precisa ser aqui dentro: fora de um gesto real o navegador bloqueia o
      // autoplay e a primeira resposta sai muda, sem erro nenhum.
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

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={handlePointerCancel}
      style={{
        touchAction: "none",
        transform: `translateX(${recording ? dragX : 0}px) scale(${recording && !armed ? 1.06 : 1})`,
        background: armed
          ? "rgba(251, 113, 133, 0.18)"
          : processing
          ? "rgba(255,255,255,0.07)"
          : "linear-gradient(155deg, #f0abfc 0%, #a855f7 52%, #6d28d9 100%)",
        boxShadow: armed
          ? "0 10px 30px rgba(251, 113, 133, 0.28)"
          : processing
          ? "none"
          : recording
          ? "0 16px 54px rgba(232, 121, 249, 0.62), inset 0 1px 0 rgba(255,255,255,0.5)"
          : "0 14px 44px rgba(168, 85, 247, 0.5), inset 0 1px 0 rgba(255,255,255,0.5)",
        border: armed ? "1px solid rgba(251, 113, 133, 0.44)" : "none",
        transition: "transform 0.2s ease, box-shadow 0.3s ease, background 0.25s ease",
      }}
      className="relative grid h-[88px] w-[88px] select-none place-items-center rounded-full text-white disabled:cursor-not-allowed disabled:opacity-45"
      aria-label={
        processing
          ? "Processando fala"
          : armed
          ? "Solte para cancelar"
          : recording
          ? "Solte para enviar, deslize para cancelar"
          : "Segure para falar com o Axon"
      }
    >
      {/* Anel que se expande e some, marcando que o microfone está aberto. */}
      {recording && !armed && (
        <span
          aria-hidden="true"
          className="voice-mic-ring pointer-events-none absolute -inset-3 rounded-full"
        />
      )}

      <span className="relative">
        {processing ? (
          <Loader2 className="h-7 w-7 animate-spin" style={{ color: "rgba(255,255,255,0.46)" }} />
        ) : armed ? (
          <X className="h-7 w-7" style={{ color: "#fb7185" }} />
        ) : (
          <Mic className="h-7 w-7" />
        )}
      </span>
    </button>
  );
}
