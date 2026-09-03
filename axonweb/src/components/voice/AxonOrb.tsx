/**
 * O Axon desenhado como luz: curvas fechadas cujo raio é modulado por senos de
 * fases diferentes. Cada curva é traçada duas vezes — uma grossa e borrada (o
 * brilho) e uma fina por cima (o fio) — em `lighter`, que soma as camadas em
 * vez de pintar por cima. É essa soma que faz parecer luz e não desenho.
 *
 * `energy` abre a forma, `churn` acelera a deformação. Os dois perseguem o alvo
 * com interpolação: a orb nunca salta de um estado para outro, ela chega.
 */

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

interface AxonOrbProps {
  state: OrbState;
  /** Nível do microfone (0 a 1). Só é lido durante `listening`. */
  level?: number;
  size?: number;
  /**
   * Encolhe a orb sem redesenhá-la (1 = tamanho cheio). O canvas continua no
   * mesmo tamanho e só a apresentação muda: recriá-lo reiniciaria a animação e
   * daria um piscão a cada vez que a pessoa rolasse a conversa.
   */
  scale?: number;
  className?: string;
}

/** Alvos de (energy, churn) por estado. Em `listening` a energia vem do mic. */
const ALVOS: Record<OrbState, { energy: number; churn: number }> = {
  idle: { energy: 0.12, churn: 0.2 },
  listening: { energy: 0.34, churn: 0.8 },
  thinking: { energy: 0.28, churn: 1.7 },
  speaking: { energy: 0.5, churn: 0.6 },
};

export function AxonOrb({ state, level = 0, size = 300, scale = 1, className }: AxonOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // O loop de animação roda fora do React: ler `state`/`level` direto da prop
  // dentro dele congelaria o valor da primeira renderização, e recriar o loop a
  // cada quadro custaria mais que desenhar. Os refs são a ponte.
  const stateRef = useRef(state);
  stateRef.current = state;
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Acima de 2 o ganho visual some e o custo por quadro dobra — em celular
    // isso é a diferença entre 60fps e travar.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A orb grande é a da página; a pequena aparece no modo registro, e com o
    // mesmo traço ela viraria um borrão.
    const grande = size > 150;
    const linhas = grande ? 8 : 6;

    let energy = ALVOS.idle.energy;
    let churn = ALVOS.idle.churn;
    let t = Math.random() * 10;
    let frame = 0;

    function forma(p: number, fase: number, amp: number): [number, number][] {
      const pts: [number, number][] = [];
      const base = size * 0.29;
      for (let i = 0; i <= 150; i++) {
        const a = (i / 150) * Math.PI * 2;
        const r =
          base *
          (1 +
            amp * Math.sin(3 * a + fase * 1.6) +
            amp * 0.6 * Math.sin(5 * a - fase * 1.15 + p * 3.1) +
            amp * 0.32 * Math.sin(2 * a + fase * 2.4) -
            p * 0.085);
        // O 0.95 no eixo Y achata de leve: um círculo perfeito parece um logo,
        // uma elipse quase imperceptível parece um corpo.
        pts.push([size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r * 0.95]);
      }
      return pts;
    }

    function tracar(pts: [number, number][]) {
      ctx!.beginPath();
      ctx!.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx!.lineTo(pts[i][0], pts[i][1]);
      ctx!.closePath();
    }

    function desenhar() {
      const alvo = ALVOS[stateRef.current];
      // Gravando, a energia é a voz: a orb abre quando você fala e fecha quando
      // você pausa. É o único estado em que ela responde a algo externo.
      const alvoEnergy =
        stateRef.current === "listening"
          ? alvo.energy + Math.min(levelRef.current, 1) * 0.52
          : alvo.energy;

      energy += (alvoEnergy - energy) * 0.075;
      churn += (alvo.churn - churn) * 0.05;
      t += 0.005 + churn * 0.022;

      ctx!.clearRect(0, 0, size, size);
      ctx!.globalCompositeOperation = "lighter";

      for (let l = 0; l < linhas; l++) {
        const p = l / linhas;
        const pts = forma(p, t + p * 2.5, 0.09 + energy * 0.44);
        const hue = 272 + p * 42; // roxo do app → magenta
        const lum = 60 + p * 12;

        // brilho
        tracar(pts);
        ctx!.strokeStyle = `hsla(${hue}, 96%, ${lum}%, ${0.05 + energy * 0.1})`;
        ctx!.lineWidth = grande ? 7 : 4;
        ctx!.shadowBlur = grande ? 26 : 12;
        ctx!.shadowColor = `hsla(${hue}, 100%, 66%, 0.85)`;
        ctx!.stroke();

        // fio
        tracar(pts);
        ctx!.strokeStyle = `hsla(${hue}, 98%, ${lum + 18}%, ${0.3 + (1 - p) * 0.42})`;
        ctx!.lineWidth = grande ? 1.15 : 0.85;
        ctx!.shadowBlur = grande ? 10 : 5;
        ctx!.stroke();
      }

      ctx!.globalCompositeOperation = "source-over";
      ctx!.shadowBlur = 0;

      if (!reduzido) frame = requestAnimationFrame(desenhar);
    }

    desenhar();

    // Sem isto o loop continua rodando depois de sair da página, gastando
    // bateria para desenhar num canvas que ninguém mais vê.
    return () => cancelAnimationFrame(frame);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: size,
        display: "block",
        transform: `scale(${scale})`,
        // Escala pelo centro. Ancorar no topo cortaria o brilho: o canvas
        // desenha o halo FORA da forma, e o contêiner não o acompanharia.
        transformOrigin: "center center",
        transition: "transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    />
  );
}
