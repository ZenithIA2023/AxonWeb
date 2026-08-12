import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

const loadingMessages = [
  "Carregando seu ambiente",
  "Sincronizando sua rotina",
  "Abrindo seu Dashboard",
];

const TOTAL_DURATION = 2600;

export default function AppLoading() {
  const navigate = useNavigate();

  const [progress, setProgress] = useState(0);

  const activeMessageIndex = useMemo(() => {
    const index = Math.floor((progress / 100) * loadingMessages.length);
    return Math.min(index, loadingMessages.length - 1);
  }, [progress]);

  const currentMessage = loadingMessages[activeMessageIndex];

  useEffect(() => {
    const startedAt = Date.now();

    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const nextProgress = Math.min((elapsed / TOTAL_DURATION) * 100, 100);

      setProgress(nextProgress);

      if (nextProgress >= 100) {
        window.clearInterval(progressTimer);

        window.setTimeout(() => {
          navigate("/dashboard");
        }, 220);
      }
    }, 80);

    return () => {
      window.clearInterval(progressTimer);
    };
  }, [navigate]);

  return (
    <main className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#2d0850] px-4 text-white">
      <AppLoadingBackground />

      <section className="relative z-10 flex w-full max-w-[340px] flex-col items-center text-center">
        <LogoVignette />

        <div className="mt-8 min-h-[58px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentMessage}
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              <h1 className="text-[1.35rem] font-black leading-none tracking-[-0.045em] text-white">
                {currentMessage}
              </h1>

              <p className="mx-auto mt-3 max-w-[17rem] text-[0.72rem] font-medium leading-5 text-white/58">
                O Axon está preparando sua experiência.
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-8 w-full max-w-[16rem]">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
            <motion.div
              className="h-full rounded-full bg-[#a855f7] shadow-[0_0_18px_rgba(168,85,247,0.34)]"
              animate={{ width: `${Math.round(progress)}%` }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function LogoVignette() {
  return (
    <div className="relative flex h-[220px] w-[220px] items-center justify-center">
      <motion.div
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.26, 0.52, 0.26],
        }}
        transition={{
          duration: 3.1,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute h-[180px] w-[180px] rounded-full bg-[#7b2cbf]/44 blur-3xl"
      />

      <motion.div
        animate={{ rotate: 360 }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "linear",
        }}
        className="absolute h-[176px] w-[176px] rounded-full border border-white/10"
      />

      <motion.div
        animate={{ rotate: -360 }}
        transition={{
          duration: 26,
          repeat: Infinity,
          ease: "linear",
        }}
        className="absolute h-[132px] w-[132px] rounded-full border border-white/8"
      />

      <motion.div
        animate={{
          scale: [1, 1.035, 1],
        }}
        transition={{
          duration: 3.2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="relative flex h-24 w-24 items-center justify-center"
      >
        <div className="relative flex h-24 w-24 rotate-45 items-center justify-center rounded-[1.7rem] border border-white/16 bg-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
          <div className="absolute inset-0 rounded-[1.7rem] bg-[linear-gradient(135deg,rgba(255,255,255,0.24),transparent_54%)] opacity-70" />

          <img
            src="/axon-logo.svg"
            alt="Axon"
            className="relative h-24 w-24 -rotate-45 object-contain"
          />
        </div>
      </motion.div>
    </div>
  );
}

function AppLoadingBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-14rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/60 blur-[120px]" />
      <div className="absolute bottom-[-18rem] left-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/32 blur-[120px]" />
      <div className="absolute bottom-[-16rem] right-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/22 blur-[120px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.1]" />
    </div>
  );
}