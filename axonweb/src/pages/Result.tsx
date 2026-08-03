import { useMemo, useState, type ElementType } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coffee,
  Moon,
  RefreshCcw,
  Sparkles,
  Sun,
  Target,
  Zap,
} from "lucide-react";

import { useTheme } from "../components/theme/ThemeProvider";
import { results, type ChronotypeResultKey } from "../data/results";

// ===========================================================================
// CHAVES VÁLIDAS DE CRONOTIPO
// ===========================================================================

const validKeys: ChronotypeResultKey[] = [
  "Matutino",
  "Vespertino",
  "Noturno",
  "Misto",
  "Bimodal",
];

// ===========================================================================
// PÁGINA DE RESULTADO DO CRONOTIPO
// ===========================================================================
// Primeira visualização do resultado em formato de cards.
// A leitura completa/texto corrido pode ser extraída depois para um componente
// próprio usado em Perfil/Configurações.

export default function Result() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const fromProfile = searchParams.get("from") === "profile";
  const chronotypeFromUrl = searchParams.get("chronotype");

  const [currentSlide, setCurrentSlide] = useState(0);

  const resultKey = useMemo<ChronotypeResultKey>(() => {
    if (
      chronotypeFromUrl &&
      validKeys.includes(chronotypeFromUrl as ChronotypeResultKey)
    ) {
      return chronotypeFromUrl as ChronotypeResultKey;
    }

    const stored = localStorage.getItem("axon_chronotype");

    if (stored && validKeys.includes(stored as ChronotypeResultKey)) {
      return stored as ChronotypeResultKey;
    }

    return "Misto";
  }, [chronotypeFromUrl]);

  const result = results[resultKey];
  const ResultIcon = getResultIcon(resultKey);

  const slides = useMemo(
    () => createResultSlides(result, resultKey, ResultIcon),
    [result, resultKey, ResultIcon]
  );

  const isLastSlide = currentSlide === slides.length - 1;
  const slide = slides[currentSlide];

  function goNext() {
    if (isLastSlide) {
      if (fromProfile) {
        navigate("/profile");
      } else {
        navigate("/dashboard-loading");
      }

      return;
    }

    setCurrentSlide((prev) => prev + 1);
  }

  function goBack() {
    setCurrentSlide((prev) => Math.max(prev - 1, 0));
  }

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#2d0850] px-4 py-5 text-white">
      <ResultBackground />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-[430px] flex-col">
        <Header />

        <section className="flex flex-1 flex-col justify-center py-6">
          <ResultCard
            slide={slide}
            currentSlide={currentSlide}
            totalSlides={slides.length}
            isLastSlide={isLastSlide}
            fromProfile={fromProfile}
            onSelectSlide={setCurrentSlide}
            onNext={goNext}
            onBack={goBack}
          />
        </section>
      </div>
    </main>
  );
}

// ===========================================================================
// CRIAÇÃO DOS SLIDES
// ===========================================================================

type ResultSlide = {
  eyebrow?: string;
  title: string;
  description: string;
  icon?: ElementType;
  content: React.ReactNode;
};

function createResultSlides(
  result: (typeof results)[ChronotypeResultKey],
  resultKey: ChronotypeResultKey,
  ResultIcon: ElementType
): ResultSlide[] {
  const firstFocusBlock = result.focusBlocks[0];
  const secondFocusBlock = result.focusBlocks[1];

  return [
    {
      eyebrow: result.label,
      title: `Seu cronotipo é ${resultKey}`,
      description:
        result.subtitle ||
        "Este resultado mostra como seu ritmo tende a se comportar ao longo do dia.",
      icon: ResultIcon,
      content: (
        <div className="space-y-2.5">
          {result.profileTags.slice(0, 3).map((tag) => (
            <MiniInsight key={tag} text={tag} />
          ))}
        </div>
      ),
    },
    {
      eyebrow: "Interpretação",
      title: "O que esse resultado significa?",
      description:
        result.summary ||
        "O Axon usa esse perfil para entender seus horários de maior energia, foco e recuperação.",
      content: (
        <HighlightBox>
          Esse resultado ajuda a organizar sua rotina com base no seu ritmo real,
          não em um modelo genérico de produtividade.
        </HighlightBox>
      ),
    },
    {
      eyebrow: "Seu melhor momento",
      title: "Sua rotina fica melhor quando respeita sua energia.",
      description:
        "Algumas tarefas exigem mais foco, outras funcionam melhor em horários de menor pressão. O Axon usa essas janelas para orientar seu planejamento.",
      content: (
        <div className="space-y-2.5">
          <MetricRow
            icon={Zap}
            title="Pico de energia"
            value={result.energyPeak}
          />

          <MetricRow
            icon={Target}
            title="Melhor foco"
            value={result.focusWindow}
          />

          <MetricRow
            icon={Clock3}
            title="Queda de energia"
            value={result.lowEnergy}
          />
        </div>
      ),
    },
    {
      eyebrow: "Primeiros ajustes",
      title: "Como começar com mais clareza.",
      description:
        "Antes de mudar toda a rotina, comece pelos ajustes que tendem a gerar mais impacto no seu dia.",
      content: (
        <div className="space-y-2.5">
          {firstFocusBlock && (
            <MiniInsight
              title={firstFocusBlock.title}
              text={`${firstFocusBlock.period} · ${firstFocusBlock.description}`}
            />
          )}

          {secondFocusBlock && (
            <MiniInsight
              title={secondFocusBlock.title}
              text={`${secondFocusBlock.period} · ${secondFocusBlock.description}`}
            />
          )}

          {result.routineTips[0] && <MiniInsight text={result.routineTips[0]} />}
        </div>
      ),
    },
    {
      eyebrow: "Próximo passo",
      title: "Seu resultado é apenas o começo.",
      description:
        "Agora o Axon pode montar uma experiência inicial com base no seu cronotipo, seus horários e seus padrões de energia.",
      content: (
        <div className="space-y-2.5">
          {result.axonSetup.slice(0, 3).map((item, index) => (
            <NumberedInsight key={item} index={index + 1} text={item} />
          ))}
        </div>
      ),
    },
  ];
}

// ===========================================================================
// COMPONENTES VISUAIS
// ===========================================================================

function Header() {
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

      <ThemeSwitchButton />
    </header>
  );
}

// ---------------------------------------------------------------------------
// ALTERNADOR DE TEMA — APOIO DE DESIGN (PROVISÓRIO)
// ---------------------------------------------------------------------------
// Botão só para comparar o visual claro e o escuro durante os ajustes desta
// tela. Usa o mesmo ThemeProvider do resto do app, então a escolha fica salva
// em localStorage e vale para as outras telas. Pode ser removido quando o
// design estiver fechado (mesmo papel do botão na tela de introdução).

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

function ResultCard({
  slide,
  currentSlide,
  totalSlides,
  isLastSlide,
  fromProfile,
  onSelectSlide,
  onNext,
  onBack,
}: {
  slide: ResultSlide;
  currentSlide: number;
  totalSlides: number;
  isLastSlide: boolean;
  fromProfile: boolean;
  onSelectSlide: (index: number) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const Icon = slide.icon;

  return (
    <div className="relative mx-auto w-full max-w-[350px]">
      <DecorativeStack />

      <div className="relative z-10 overflow-hidden rounded-[2.2rem] border border-white/90 bg-white px-5 pb-4 pt-5 text-center text-[#4c1d95] shadow-[0_28px_90px_rgba(0,0,0,0.24)] dark:border-white/10 dark:bg-[#11101a]/94 dark:text-white dark:shadow-[0_28px_90px_rgba(0,0,0,0.48)]">
        <SlideDots
          total={totalSlides}
          currentSlide={currentSlide}
          onSelect={onSelectSlide}
        />

        <AnimatePresence mode="wait">
          <motion.div
            key={slide.title}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="flex min-h-[500px] flex-col"
          >
            {/*
              Bloco central: ícone, texto e conteúdo ficam centralizados
              verticalmente no espaço acima dos botões, em vez de colados no
              topo. Com a altura padronizada, a sobra se divide entre o topo e
              a base do card em vez de ficar toda embaixo.
            */}
            <div className="flex flex-1 flex-col justify-center">
              {/* Só o primeiro slide traz ícone — o do cronotipo identificado. */}
              {Icon && (
                <div className="mx-auto mt-2 flex h-20 w-20 items-center justify-center rounded-[1.8rem] border border-[#7b2cbf]/16 bg-[#7b2cbf]/10 text-[#7b2cbf] dark:border-white/10 dark:bg-[#191722] dark:text-white/78">
                  <Icon className="h-9 w-9" />
                </div>
              )}

              {/* Sem ícone não existe o que separar, e a margem só desalinharia
                  o bloco centralizado. */}
              <div className={Icon ? "mt-5" : ""}>
                {slide.eyebrow && (
                  <p className="mb-3 text-[0.62rem] font-black uppercase tracking-[0.12em] text-[#7b2cbf]/72 dark:text-white/48">
                    {slide.eyebrow}
                  </p>
                )}

                <h1 className="mx-auto max-w-[17rem] text-[1.35rem] font-black leading-[0.98] tracking-[-0.045em] text-[#4c1d95] dark:text-white">
                  {slide.title}
                </h1>

                <p className="mx-auto mt-4 max-w-[17.5rem] text-[0.72rem] font-medium leading-5 text-[#6d28d9]/66 dark:text-white/62">
                  {slide.description}
                </p>
              </div>

              <div className="mt-4">{slide.content}</div>
            </div>

            <ResultActions
              currentSlide={currentSlide}
              isLastSlide={isLastSlide}
              fromProfile={fromProfile}
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
}: {
  total: number;
  currentSlide: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="mb-3 flex justify-center gap-2">
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

function ResultActions({
  currentSlide,
  isLastSlide,
  fromProfile,
  onNext,
  onBack,
}: {
  currentSlide: number;
  isLastSlide: boolean;
  fromProfile: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <footer className="mt-auto flex items-center justify-between pt-4">
      {currentSlide > 0 ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar card"
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
        aria-label={isLastSlide ? "Finalizar resultado" : "Avançar card"}
        className={`group flex h-11 shrink-0 items-center justify-center rounded-2xl bg-[#7b2cbf] text-white shadow-[0_18px_42px_rgba(123,44,191,0.22)] transition hover:-translate-y-0.5 hover:bg-[#8d31dd] hover:shadow-[0_22px_48px_rgba(123,44,191,0.28)] active:scale-[0.96] dark:bg-[#a855f7] dark:hover:bg-[#b968ff] ${
          isLastSlide ? "w-[11rem] px-4 text-xs font-semibold" : "w-11"
        }`}
      >
        {isLastSlide ? (
          fromProfile ? (
            "Voltar ao perfil"
          ) : (
            "Montar Dashboard"
          )
        ) : (
          <ChevronRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
        )}
      </button>
    </footer>
  );
}

// ===========================================================================
// COMPONENTES INTERNOS
// ===========================================================================

function MiniInsight({
  title,
  text,
}: {
  title?: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-[#7b2cbf]/18 bg-[#fbf8ff] px-3 py-2.5 text-center dark:border-[#a855f7]/28 dark:bg-[#a855f7]/10">
      {title && (
        <p className="mb-1 text-[0.66rem] font-black leading-4 text-[#4c1d95] dark:text-[#e9d5ff]">
          {title}
        </p>
      )}

      <p className="text-[0.68rem] font-medium leading-4 text-[#6d28d9]/68 dark:text-[#d8b4fe]/88">
        {text}
      </p>
    </div>
  );
}

function NumberedInsight({
  index,
  text,
}: {
  index: number;
  text: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#7b2cbf]/18 bg-[#fbf8ff] px-3 py-2.5 text-left dark:border-[#a855f7]/28 dark:bg-[#a855f7]/10">
      {/*
        leading-none é o que centraliza de fato: sem ele a bolinha herda um
        line-height maior que a fonte, e o flex centraliza a caixa de linha —
        que tem folga de descendente embaixo — em vez do próprio dígito, que
        acaba renderizando um pouco acima do centro.
      */}
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#7b2cbf] text-[0.58rem] font-black leading-none text-white dark:bg-[#a855f7]">
        {index}
      </div>

      <p className="text-[0.68rem] font-medium leading-4 text-[#6d28d9]/68 dark:text-[#d8b4fe]/88">
        {text}
      </p>
    </div>
  );
}

function MetricRow({
  icon: Icon,
  title,
  value,
}: {
  icon: ElementType;
  title: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#7b2cbf]/18 bg-[#fbf8ff] px-3 py-2.5 text-left dark:border-[#a855f7]/28 dark:bg-[#a855f7]/10">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#7b2cbf]/18 bg-white text-[#7b2cbf] dark:border-[#a855f7]/22 dark:bg-[#11101a] dark:text-[#d8b4fe]">
        <Icon className="h-4 w-4" />
      </div>

      <div>
        <p className="text-[0.66rem] font-black leading-4 text-[#4c1d95] dark:text-[#e9d5ff]">
          {title}
        </p>

        <p className="mt-0.5 text-[0.68rem] font-medium leading-4 text-[#6d28d9]/68 dark:text-[#d8b4fe]/88">
          {value}
        </p>
      </div>
    </div>
  );
}

function HighlightBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#7b2cbf]/18 bg-[#fbf8ff] px-4 py-3 text-center dark:border-[#a855f7]/28 dark:bg-[#a855f7]/10">
      <p className="text-[0.72rem] font-semibold leading-5 text-[#6d28d9]/70 dark:text-[#d8b4fe]/90">
        {children}
      </p>
    </div>
  );
}

// ===========================================================================
// HELPERS DO RESULTADO
// ===========================================================================

function getResultIcon(resultKey: ChronotypeResultKey) {
  if (resultKey === "Matutino") return Sun;
  if (resultKey === "Vespertino") return Sparkles;
  if (resultKey === "Noturno") return Moon;
  if (resultKey === "Bimodal") return Zap;
  return BarChart3;
}

// ===========================================================================
// ELEMENTOS VISUAIS
// ===========================================================================

// Camadas que dão volume à pilha de cards. Todas giram para o mesmo lado, com
// rotação decrescente da mais distante para a mais próxima, para a leitura de
// uma pilha enfileirada e não de cartas espalhadas. A superfície acompanha a do
// card da frente (branco no claro, #11101a no escuro), apenas mais recuada.
// Ordem do array = ordem de pintura: do card mais distante para o mais próximo.
// Mantido em sincronia com QuestionnaireIntro.jsx e Questionnaire.tsx.
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

function ResultBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-14rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/60 blur-[120px]" />
      <div className="absolute bottom-[-18rem] left-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/32 blur-[120px]" />
      <div className="absolute bottom-[-16rem] right-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/22 blur-[120px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.1]" />
    </div>
  );
}