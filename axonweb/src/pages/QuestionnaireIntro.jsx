import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";

import { useTheme } from "../components/theme/ThemeProvider";
import axonHappyWave from "../assets/axon/axon-happy-wave.png";

// ===========================================================================
// CONTEÚDO DOS SLIDES
// ===========================================================================
// Introdução curta antes do questionário cronobiológico inicial.
// Texto em terceira pessoa para manter uma comunicação mais madura,
// sem parecer que o robô está falando diretamente como personagem infantil.

const slides = [
  {
    title: "O Axon entende sua rotina para criar uma experiência mais inteligente.",
    description:
      "Antes de começar, algumas perguntas ajudam o Axon a identificar seus horários, seus padrões de energia e a forma como você costuma organizar o dia.",
    note: "A configuração leva poucos minutos.",
  },
  {
    title: "Cada pessoa funciona de um jeito.",
    description:
      "Existem pessoas que rendem melhor pela manhã, outras à tarde e outras à noite. O questionário ajuda a reconhecer esses padrões para adaptar o aplicativo ao seu ritmo real.",
    note: "Tempo estimado: 10 a 15 minutos.",
  },
  {
    title: "O objetivo não é mudar quem você é.",
    description:
      "A proposta é entender como você funciona para organizar sua rotina com mais clareza, foco e consistência, sem forçar um modelo genérico de produtividade.",
    note: "Não existem respostas certas ou erradas.",
  },
  {
    title: "Este é só o começo da sua configuração.",
    description:
      "Com o tempo, seus dados e hábitos ajudam o Axon a ajustar recomendações, identificar padrões e tornar sua experiência cada vez mais personalizada.",
    note: "Você poderá ajustar suas preferências depois.",
  },
  {
    title: "Agora é hora de conhecer melhor sua rotina.",
    description:
      "Responda com sinceridade. Em poucos minutos, o Axon terá informações suficientes para montar uma configuração inicial mais alinhada com você.",
    note: "Pronto para começar?",
  },
];

// ===========================================================================
// PÁGINA DE INTRODUÇÃO DO QUESTIONÁRIO
// ===========================================================================

export default function QuestionnaireIntro() {
  const navigate = useNavigate();

  const [currentSlide, setCurrentSlide] = useState(0);

  const isLastSlide = currentSlide === slides.length - 1;
  const slide = slides[currentSlide];

  function nextSlide() {
    if (isLastSlide) {
      navigate("/questionnaire");
      return;
    }

    setCurrentSlide((prev) => prev + 1);
  }

  function previousSlide() {
    setCurrentSlide((prev) => Math.max(prev - 1, 0));
  }

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#2d0850] px-4 py-5 text-white">
      <IntroBackground />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-[430px] flex-col">
        <Header onSkip={() => navigate("/questionnaire")} />

        <section className="flex flex-1 flex-col justify-center py-6">
          <SlideCard
            slide={slide}
            totalSlides={slides.length}
            currentSlide={currentSlide}
            isLastSlide={isLastSlide}
            onSelectSlide={setCurrentSlide}
            onNext={nextSlide}
            onBack={previousSlide}
          />
        </section>
      </div>
    </main>
  );
}

// ===========================================================================
// COMPONENTES DA INTRODUÇÃO
// ===========================================================================

function Header({ onSkip }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <Link to="/" className="flex items-center gap-2">
        <img
          src="/axon-logo-inverted.svg"
          alt="Axon"
          className="h-8 w-8 object-contain"
        />

        <span className="text-sm font-semibold tracking-[-0.02em] text-white">
          AXON
        </span>
      </Link>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSkip}
          className="min-h-9 rounded-2xl border border-white/20 bg-white/10 px-4 text-xs font-semibold text-white/78 backdrop-blur-2xl transition hover:bg-white/16 hover:text-white active:scale-[0.98]"
        >
          Pular Apresentação
        </button>

        <ThemeSwitchButton />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// ALTERNADOR DE TEMA — APOIO DE DESIGN (PROVISÓRIO)
// ---------------------------------------------------------------------------
// Botão só para comparar o visual claro e o escuro durante os ajustes desta
// tela. Usa o mesmo ThemeProvider do resto do app, então a escolha fica salva
// em localStorage e vale para as outras telas. Pode ser removido quando o
// design estiver fechado (mesmo papel do LandingThemeSwitch na landing).

function ThemeSwitchButton() {
  const { resolvedTheme, toggleTheme } = useTheme();

  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Ver tema claro" : "Ver tema escuro";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white/78 backdrop-blur-2xl transition hover:bg-white/16 hover:text-white active:scale-[0.98]"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function SlideCard({
  slide,
  totalSlides,
  currentSlide,
  isLastSlide,
  onSelectSlide,
  onNext,
  onBack,
}) {
  return (
    <div className="relative mx-auto w-full max-w-[330px]">
      <DecorativeStack />

      <div className="relative z-10 overflow-hidden rounded-[2.2rem] border border-white/90 bg-white px-5 pb-5 pt-7 text-center text-[#4c1d95] shadow-[0_28px_90px_rgba(0,0,0,0.24)] dark:border-white/10 dark:bg-[#11101a]/94 dark:text-white dark:shadow-[0_28px_90px_rgba(0,0,0,0.48)]">
        <SlideDots
          total={totalSlides}
          currentSlide={currentSlide}
          onSelect={onSelectSlide}
        />

        {/*
          Altura fixa para que todos os slides tenham o mesmo card, tomando
          "Cada pessoa funciona de um jeito." como referência. Como os textos
          variam de tamanho, a área do mascote é flexível (min-h-0 + max-h-full)
          e absorve a diferença: o mascote encolhe um pouco nos slides de texto
          mais longo em vez de esticar o card.
        */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentSlide}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="flex h-[490px] flex-col"
          >
            <div>
              <h1 className="mx-auto max-w-[16.8rem] text-[1.38rem] font-black leading-[0.98] tracking-[-0.045em] text-[#4c1d95] dark:text-white">
                {slide.title}
              </h1>

              <p className="mx-auto mt-3 max-w-[17.5rem] text-[0.72rem] font-medium leading-5 text-[#6d28d9]/66 dark:text-white/62">
                {slide.description}
              </p>

              <div className="mx-auto mt-4 max-w-[16rem] rounded-xl border border-[#7b2cbf]/20 bg-[#fbf8ff] px-3 py-1.5 dark:border-white/10 dark:bg-[#191722]">
                <p className="text-[0.64rem] font-semibold leading-4 text-[#6d28d9]/72 dark:text-white/62">
                  {slide.note}
                </p>
              </div>
            </div>

            <div className="relative mx-auto mt-5 flex min-h-0 flex-1 items-center justify-center">
              <div className="absolute left-1/2 top-1/2 h-[13rem] w-[13rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b2cbf]/10 blur-2xl dark:bg-[#7b2cbf]/20" />

              <motion.img
                src={axonHappyWave}
                alt="Mascote Axon acenando"
                animate={{ y: [-5, 5, -5] }}
                transition={{
                  duration: 5.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="relative z-10 h-[245px] max-h-full w-auto object-contain drop-shadow-[0_28px_52px_rgba(45,8,80,0.18)] dark:drop-shadow-[0_34px_58px_rgba(0,0,0,0.34)]"
              />
            </div>

            <FooterActions
              currentSlide={currentSlide}
              isLastSlide={isLastSlide}
              onNext={onNext}
              onBack={onBack}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function SlideDots({
  total,
  currentSlide,
  onSelect,
}) {
  return (
    <div className="mb-5 flex justify-center gap-2">
      {Array.from({ length: total }).map((_, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onSelect(index)}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            index === currentSlide
              ? "w-8 bg-[#7b2cbf] shadow-[0_0_18px_rgba(123,44,191,0.26)] dark:bg-[#a855f7]"
              : "w-7 bg-[#7b2cbf]/16 dark:bg-white/14"
          }`}
          aria-label={`Ir para slide ${index + 1}`}
        />
      ))}
    </div>
  );
}

function FooterActions({
  currentSlide,
  isLastSlide,
  onNext,
  onBack,
}) {
  return (
    <footer className="mt-auto flex items-center justify-between">
      {currentSlide > 0 ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar slide"
          className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#7b2cbf]/24 bg-[#fbf8ff] text-[#6d28d9] shadow-[0_12px_28px_rgba(45,8,80,0.08)] transition hover:-translate-y-0.5 hover:border-[#7b2cbf]/38 hover:bg-white hover:shadow-[0_18px_38px_rgba(123,44,191,0.14)] active:scale-[0.96] dark:border-white/10 dark:bg-[#191722] dark:text-white/70 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)] dark:hover:border-white/18 dark:hover:bg-[#211c2d] dark:hover:text-white"
        >
          <ChevronLeft className="h-5 w-5 transition group-hover:-translate-x-0.5" />
        </button>
      ) : (
        <div className="h-11 w-11" aria-hidden="true" />
      )}

      <button
        type="button"
        onClick={onNext}
        aria-label={isLastSlide ? "Começar questionário" : "Avançar slide"}
        className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#7b2cbf] text-white shadow-[0_18px_42px_rgba(123,44,191,0.22)] transition hover:-translate-y-0.5 hover:bg-[#8d31dd] hover:shadow-[0_22px_48px_rgba(123,44,191,0.28)] active:scale-[0.96] dark:bg-[#a855f7] dark:hover:bg-[#b968ff]"
      >
        <ChevronRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
      </button>
    </footer>
  );
}

// ===========================================================================
// ELEMENTOS VISUAIS
// ===========================================================================

// Camadas que representam os próximos cards da sequência. Todas seguem a
// mesma direção — deslocam para a direita e para baixo com rotação crescente —
// para dar a leitura de uma pilha enfileirada, e não de cartas espalhadas.
// A superfície acompanha a do card da frente (branco no claro, #11101a no
// escuro), apenas mais recuada, para que a pilha tenha volume.
// Ordem do array = ordem de pintura: do card mais distante para o mais próximo.
// O `scale` decrescente mantém a pilha dentro do frame de 430px da página
// (o `main` tem overflow-hidden), mesmo com o deslocamento e a rotação.
const UPCOMING_CARD_LAYERS = [
  "translate-x-[0.00rem] translate-y-[0.10rem] rotate-[5deg] scale-[1.02] border-white/42 bg-white/30 shadow-[0_16px_44px_rgba(45,8,80,0.16)] dark:border-white/10 dark:bg-[#11101a]/45 dark:shadow-[0_16px_44px_rgba(0,0,0,0.34)]",
  "translate-x-[0.00rem] translate-y-[0.08rem] rotate-[3deg] scale-[1.01] border-white/62 bg-white/55 shadow-[0_18px_48px_rgba(45,8,80,0.18)] dark:border-white/14 dark:bg-[#11101a]/50 dark:shadow-[0_18px_48px_rgba(0,0,0,0.38)]",
];

function DecorativeStack() {
  return (
    <>
      {UPCOMING_CARD_LAYERS.map((layerClassName, index) => (
        <div
          key={`upcoming-card-${index}`}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 -z-10 rounded-[2.2rem] border ${layerClassName}`}
        />
      ))}
    </>
  );
}

function IntroBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-14rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/60 blur-[120px]" />
      <div className="absolute bottom-[-18rem] left-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/32 blur-[120px]" />
      <div className="absolute bottom-[-16rem] right-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/22 blur-[120px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.1]" />
    </div>
  );
}