import { useEffect, useMemo, useState, type ElementType } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Brain,
  Clock3,
  Moon,
  Sparkles,
  Zap,
} from "lucide-react";

// ===========================================================================
// ETAPAS DA ANÁLISE
// ===========================================================================
// Etapas exibidas durante o carregamento visual antes da tela de resultado.

type AnalysisStep = {
  icon: ElementType;
  title: string;
  text: string;
};

const steps: AnalysisStep[] = [
  {
    icon: Clock3,
    title: "Lendo seus horários",
    text: "Analisando seus padrões de sono e despertar.",
  },
  {
    icon: Zap,
    title: "Mapeando sua energia",
    text: "Identificando seus melhores momentos de disposição.",
  },
  {
    icon: Brain,
    title: "Entendendo seu foco",
    text: "Cruzando informações sobre clareza e produtividade.",
  },
  {
    icon: Moon,
    title: "Comparando ritmos",
    text: "Relacionando suas respostas com perfis cronobiológicos.",
  },
  {
    icon: Sparkles,
    title: "Preparando resultados",
    text: "Montando sua configuração inicial no Axon.",
  },
];

const TOTAL_DURATION = 6200;

// ===========================================================================
// PÁGINA — ANÁLISE DO PERFIL
// ===========================================================================

export default function Analyzing() {
  const navigate = useNavigate();

  const [progress, setProgress] = useState(0);

  const activeStepIndex = useMemo(() => {
    const stepIndex = Math.floor((progress / 100) * steps.length);
    return Math.min(stepIndex, steps.length - 1);
  }, [progress]);

  const currentStep = steps[activeStepIndex];
  const CurrentIcon = currentStep.icon;
  const isFinished = progress >= 100;

  useEffect(() => {
    const startedAt = Date.now();

    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const nextProgress = Math.min((elapsed / TOTAL_DURATION) * 100, 100);

      setProgress(nextProgress);

      if (nextProgress >= 100) {
        window.clearInterval(progressTimer);
      }
    }, 80);

    return () => {
      window.clearInterval(progressTimer);
    };
  }, []);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#2d0850] px-4 py-8 text-white">
      <AnalyzingBackground />

      <div className="relative z-10 flex min-h-[calc(100vh-64px)] w-full max-w-[430px] flex-col">
        <Header />

        <section className="flex flex-1 flex-col justify-center py-6">
          <AnalysisCard
            progress={progress}
            isFinished={isFinished}
            currentStep={currentStep}
            CurrentIcon={CurrentIcon}
            onContinue={() => navigate("/result")}
          />
        </section>
      </div>
    </main>
  );
}

// ===========================================================================
// COMPONENTES VISUAIS
// ===========================================================================

function Header() {
  return (
    <header className="flex items-center justify-center">
      <Link
        to="/"
        aria-label="Voltar para a landing page"
        className="flex h-12 w-12 rotate-45 items-center justify-center rounded-2xl border border-white/18 bg-white/10 shadow-[0_20px_60px_rgba(168,85,247,0.35)] backdrop-blur-2xl transition active:scale-[0.96]"
      >
        <img
          src="/axon-logo-inverted.svg"
          alt="Axon"
          className="h-12 w-12 -rotate-45 object-contain"
        />
      </Link>
    </header>
  );
}

function AnalysisCard({
  progress,
  isFinished,
  currentStep,
  CurrentIcon,
  onContinue,
}: {
  progress: number;
  isFinished: boolean;
  currentStep: AnalysisStep;
  CurrentIcon: ElementType;
  onContinue: () => void;
}) {
  const roundedProgress = Math.round(progress);

  return (
    <div className="relative mx-auto w-full max-w-[340px]">
      <div className="relative z-10 h-[520px] overflow-hidden rounded-[1.65rem] border border-white/90 bg-white px-5 pb-6 pt-6 text-center text-[#4c1d95] shadow-[0_28px_90px_rgba(0,0,0,0.26)] dark:border-white/10 dark:bg-[#11101a]/94 dark:text-white dark:shadow-[0_28px_90px_rgba(0,0,0,0.48)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,var(--analysis-card-glow),transparent_55%)]" />

        <div className="relative flex h-full flex-col">
          <div className="mx-auto mb-7 inline-flex rounded-full border border-[#7b2cbf]/16 bg-[#fbf8ff] px-3 py-1 text-[0.62rem] font-semibold text-[#6d28d9]/68 dark:border-white/10 dark:bg-[#191722] dark:text-white/58">
            {isFinished ? "Cronotipo identificado" : "Processando respostas"}
          </div>

          <AnalysisVisual
            CurrentIcon={CurrentIcon}
            iconKey={currentStep.title}
          />

          <div className="mt-7 flex h-[132px] items-start justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep.title}
                initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="w-full"
              >
                <h1 className="mx-auto flex min-h-[64px] max-w-[14rem] items-center justify-center text-[1.75rem] font-black leading-[0.95] tracking-[-0.05em] text-[#4c1d95] dark:text-white">
                  {currentStep.title}
                </h1>

                <p className="mx-auto mt-3 flex min-h-[40px] max-w-[17rem] items-start justify-center text-[0.72rem] font-medium leading-5 text-[#6d28d9]/62 dark:text-white/62">
                  {currentStep.text}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[0.62rem] font-semibold text-[#6d28d9]/58 dark:text-white/52">
                {isFinished ? "Análise finalizada" : "Análise em andamento"}
              </p>

              <span className="rounded-full border border-[#7b2cbf]/16 bg-[#fbf8ff] px-2 py-0.5 text-[0.58rem] font-black text-[#6d28d9]/72 dark:border-white/10 dark:bg-[#191722] dark:text-white/58">
                {roundedProgress}%
              </span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-[#7b2cbf]/14 dark:bg-white/12">
              <motion.div
                className="h-full rounded-full bg-[#7b2cbf] shadow-[0_0_18px_rgba(123,44,191,0.28)] dark:bg-[#a855f7]"
                animate={{ width: `${roundedProgress}%` }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={onContinue}
            disabled={!isFinished}
            className="mt-6 inline-flex min-h-10 w-full items-center justify-center rounded-2xl bg-[#7b2cbf] px-6 text-sm font-semibold text-white shadow-[0_18px_42px_rgba(123,44,191,0.22)] transition hover:bg-[#8d31dd] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#7b2cbf]/28 disabled:text-white/48 disabled:shadow-none dark:bg-[#a855f7] dark:hover:bg-[#b968ff] dark:disabled:bg-white/10"
          >
            {isFinished ? "Ver resultado agora" : "Calculando resultados"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AnalysisVisual({
  CurrentIcon,
  iconKey,
}: {
  CurrentIcon: ElementType;
  iconKey: string;
}) {
  return (
    <div className="relative mx-auto flex h-[132px] w-[132px] items-center justify-center">
      {/* Glow suave atrás do símbolo */}
      <motion.div
        animate={{
          scale: [1, 1.08, 1],
          opacity: [0.35, 0.62, 0.35],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute h-[116px] w-[116px] rounded-[2rem] bg-[#7b2cbf]/10 blur-xl dark:bg-[#a855f7]/14"
      />

      {/* Losango base, sem rotação contínua */}
      <div className="absolute h-[92px] w-[92px] rotate-45 rounded-[1.65rem] border border-[#7b2cbf]/12 bg-[#7b2cbf]/6 shadow-[0_18px_50px_rgba(123,44,191,0.1)] dark:border-white/10 dark:bg-white/[0.05] dark:shadow-[0_20px_52px_rgba(0,0,0,0.28)]" />

      {/* Losango interno sutil */}
      <motion.div
        animate={{
          scale: [1, 0.94, 1],
          opacity: [0.55, 0.82, 0.55],
        }}
        transition={{
          duration: 3.6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute h-[68px] w-[68px] rotate-45 rounded-[1.35rem] border border-[#7b2cbf]/10 bg-white/25 dark:border-white/8 dark:bg-white/[0.035]"
      />

      {/* Ícone central */}
      <div className="relative flex h-[74px] w-[74px] items-center justify-center text-[#7b2cbf] dark:text-white/78">
        <AnimatePresence mode="wait">
          <motion.div
            key={iconKey}
            initial={{ opacity: 0, scale: 0.82, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.82, y: -4 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
          >
            <CurrentIcon className="h-9 w-9" />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Pontos decorativos bem discretos */}
      <motion.span
        animate={{ opacity: [0.25, 0.75, 0.25] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute left-5 top-6 h-2 w-2 rounded-full bg-[#7b2cbf]/22 dark:bg-white/18"
      />

      <motion.span
        animate={{ opacity: [0.75, 0.25, 0.75] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-6 right-5 h-2.5 w-2.5 rounded-full bg-[#7b2cbf]/16 dark:bg-white/14"
      />
    </div>
  );
}

function AnalyzingBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-14rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/60 blur-[120px]" />
      <div className="absolute bottom-[-18rem] left-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/32 blur-[120px]" />
      <div className="absolute bottom-[-16rem] right-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/22 blur-[120px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.1]" />

      <style>{`
        :root {
          --analysis-card-glow: rgba(123, 44, 191, 0.08);
        }

        .dark {
          --analysis-card-glow: rgba(168, 85, 247, 0.14);
        }
      `}</style>
    </div>
  );
}