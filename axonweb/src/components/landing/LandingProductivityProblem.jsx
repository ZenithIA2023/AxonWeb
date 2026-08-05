import { Link } from "react-router-dom";
import {
  ArrowRight,
  Brain,
  Layers3,
  RefreshCcw,
  Target,
} from "lucide-react";

// ===========================================================================
// SEÇÃO CLARA — PROBLEMA DE PRODUTIVIDADE
// ===========================================================================
// Primeira seção depois do hero. Explica a dor central e apresenta os cards
// horizontais planejados para o redesign da landing.

const problemCards = [
  {
    icon: Layers3,
    title: "Organização sem contexto",
    description:
      "Suas tarefas ficam espalhadas em diferentes aplicativos, enquanto a visão do que realmente importa se perde.",
  },
  {
    icon: Target,
    title: "Prioridades confusas",
    description:
      "Nem sempre o que parece urgente é o que realmente merece sua atenção naquele momento.",
  },
  {
    icon: RefreshCcw,
    title: "Rotinas genéricas",
    description:
      "A maioria das ferramentas trata todas as pessoas da mesma forma, ignorando diferenças de rotina, energia e produtividade.",
  },
  {
    icon: Brain,
    title: "Sobrecarga mental",
    description:
      "Quanto mais decisões você precisa tomar durante o dia, menor tende a ser sua capacidade de manter o foco.",
  },
];

export default function LandingProductivityProblem() {
  return (
    <section className="relative -mt-px overflow-hidden bg-[#fbf8ff] px-4 py-14 text-[#2d0850] sm:px-6 sm:py-18 lg:px-10 lg:py-24 xl:px-14 dark:bg-[#08070d] dark:text-white">
      <LightBackground />

      <div className="relative z-10 mx-auto max-w-[1120px]">

        <ProblemBlock />

        <ProblemCardsRail />

        <div className="mx-auto mt-9 flex max-w-[22rem] justify-center">
            <Link
                to="/signup"
                className="relative z-10 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#2d0850] px-6 text-sm font-black text-white shadow-[0_18px_42px_rgba(45,8,80,0.18)] transition hover:bg-[#3d0b6d] active:scale-[0.98] sm:w-auto sm:min-w-[14rem] dark:bg-[#7b2cbf] dark:text-white dark:hover:bg-[#8d31dd]"
                style={{ color: "#ffffff" }}
                >
                <span className="relative z-10 text-white" style={{ color: "#ffffff" }}>
                    Criar conta
                </span>

                <ArrowRight className="relative z-10 h-4 w-4 text-white" />
            </Link>
        </div>

        <AdaptiveBlock />
      </div>
    </section>
  );
}

// ===========================================================================
// BLOCOS DE TEXTO
// ===========================================================================


function ProblemBlock() {
  return (
    <div className="mx-auto max-w-[44rem] text-center">
      <h2 className="landing-section-title-md mx-auto max-w-[42rem] text-[#2d0850] dark:text-white">
        Sua produtividade não deveria depender apenas de disciplina.
      </h2>

      <p className="mx-auto mt-5 max-w-[36rem] text-sm leading-6 text-[#2d0850]/62 sm:text-base sm:leading-7 dark:text-white/62">
        Talvez você já tenha tentado resolver isso com listas, metas, novos
        aplicativos ou rotinas cada vez mais rígidas. O problema é que a
        maioria das ferramentas não considera seu ritmo, sua energia e o
        contexto real do seu dia.
      </p>
    </div>
  );
}

function AdaptiveBlock() {
  return (
    <div className="mx-auto mt-14 max-w-[44rem] text-center sm:mt-18">
      <h2 className="landing-section-title-md mx-auto max-w-[42rem] text-[#2d0850] dark:text-white">
        E se a sua produtividade pudesse se adaptar a você?
      </h2>

      <p className="mx-auto mt-5 max-w-[36rem] text-sm leading-6 text-[#2d0850]/62 sm:text-base sm:leading-7 dark:text-white/62">
        Em vez de obrigar você a seguir um método pronto, o AXON aprende como sua
        rotina funciona e cria uma experiência mais alinhada ao seu ritmo.
      </p>

      <p className="mx-auto mt-4 max-w-[31rem] text-sm font-black leading-6 text-[#2d0850] sm:text-base sm:leading-7 dark:text-white">
        Porque produtividade não é seguir regras. É encontrar um sistema que
        funcione para você.
      </p>
    </div>
  );
}

// ===========================================================================
// CARDS HORIZONTAIS
// ===========================================================================

function ProblemCardsRail() {
  return (
    <div className="relative mt-10 sm:mt-12">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[16rem] w-[16rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b2cbf]/11 sm:h-[17rem] sm:w-[17rem] dark:bg-[#7b2cbf]/20" />

      <div className="relative -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-5 pt-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-auto md:grid md:max-w-[760px] md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 lg:max-w-[840px]">
        {problemCards.map((card) => (
          <ProblemCard key={card.title} card={card} />
        ))}
      </div>
    </div>
  );
}

function ProblemCard({ card }) {
  const Icon = card.icon;

  return (
    <article className="relative min-h-[13rem] min-w-[66%] snap-center overflow-hidden rounded-[1.45rem] border border-[#2d0850]/10 bg-white p-5 text-left sm:min-w-[17rem] md:min-w-0 dark:border-white/10 dark:bg-[#11101a]">
      <CornerAccents />

      <div className="relative z-10 flex h-full flex-col justify-center">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl border border-[#7b2cbf]/18 bg-[#7b2cbf]/10 text-[#7b2cbf] dark:border-white/10 dark:bg-white/10 dark:text-white">
          <Icon className="h-4.5 w-4.5" />
        </div>

        <h3 className="max-w-[12rem] text-base font-black leading-[1.05] tracking-[-0.025em] text-[#2d0850] dark:text-white">
          {card.title}
        </h3>

        <p className="mt-3 text-xs font-medium leading-5 text-[#2d0850]/64 sm:text-sm sm:leading-6 dark:text-white/62">
          {card.description}
        </p>
      </div>
    </article>
  );
}

function CornerAccents() {
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-px -top-px h-14 w-14 rounded-tr-[1.45rem] border-r-[4px] border-t-[4px] border-[#2d0850] dark:border-white/70"
      />

      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-px -left-px h-14 w-14 rounded-bl-[1.45rem] border-b-[4px] border-l-[4px] border-[#2d0850] dark:border-white/70"
      />
    </>
  );
}

// ===========================================================================
// FUNDO CLARO
// ===========================================================================

function LightBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[22rem] h-[18rem] w-[18rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/11 blur-3xl dark:bg-[#7b2cbf]/20" />
      <div className="absolute -right-24 top-[7rem] h-52 w-52 rounded-full bg-[#7b2cbf]/8 blur-3xl dark:bg-[#7b2cbf]/16" />
      <div className="absolute -left-24 bottom-[12rem] h-52 w-52 rounded-full bg-[#7b2cbf]/8 blur-3xl dark:bg-[#7b2cbf]/16" />
    </div>
  );
}