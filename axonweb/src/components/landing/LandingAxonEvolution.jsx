import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Brain,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Sparkles,
  TrendingUp,
} from "lucide-react";

// ===========================================================================
// SEÇÃO — AXON EVOLUI JUNTO COM VOCÊ
// ===========================================================================
// Seção em fundo roxo com uma trilha de cards scrolláveis e uma régua de
// passos clicável acima deles. A mesma composição vale no mobile e no desktop:
// só muda a largura dos cards (1 por vez no celular, 3 por vez no desktop).
// Mostra como a experiência melhora conforme o usuário usa o AXON.

const evolutionSteps = [
  {
    icon: Sparkles,
    eyebrow: "Primeiro passo",
    title: "Responda nosso questionário de identificação de cronotipo",
    description:
      "De acordo com suas respostas, o AXON consegue identificar seu cronotipo e adaptar a experiência ao seu ritmo.",
  },
  {
    icon: CalendarDays,
    eyebrow: "Dia 01",
    title: "Você começa organizando sua rotina",
    description:
      "Cadastre tarefas, hábitos, objetivos e compromissos. O AXON começa a conhecer sua forma de trabalhar.",
  },
  {
    icon: CheckCircle2,
    eyebrow: "Em uma semana",
    title: "Sua organização já fica mais natural",
    description:
      "Com tudo centralizado, fica mais fácil visualizar prioridades e manter uma rotina consistente.",
  },
  {
    icon: Clock3,
    eyebrow: "Em duas semanas",
    title: "Os primeiros padrões começam a aparecer",
    description:
      "O AXON identifica horários em que você produz melhor, momentos de foco e hábitos que precisam de consistência.",
  },
  {
    icon: BarChart3,
    eyebrow: "Em um mês",
    title: "Sua rotina começa a ganhar ritmo",
    description:
      "Você passa a entender melhor como distribui energia, tarefas e compromissos ao longo da semana.",
  },
  {
    icon: Brain,
    eyebrow: "Em três meses",
    title: "Você passa a entender melhor como funciona",
    description:
      "Os insights acumulados mostram sua evolução, hábitos consistentes e seus melhores momentos de desempenho.",
  },
  {
    icon: TrendingUp,
    eyebrow: "O futuro",
    title: "Quanto mais você usa, mais inteligente o AXON se torna",
    description:
      "Diferente de aplicativos tradicionais, o AXON evolui junto com você e deixa a experiência cada vez mais personalizada.",
  },
];

export default function LandingAxonEvolution() {
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] bg-[#2d0850] px-4 py-14 text-white sm:px-6 sm:py-18 lg:rounded-[2.4rem] lg:px-10 lg:py-24 xl:px-14">
      <EvolutionBackground />

      <div className="relative z-10 mx-auto max-w-[1120px]">
        <header className="mx-auto max-w-[42rem] text-center">
          {/* Branco fixo, sem variante dark: esta seção é roxa nos dois temas. */}
          <h2 className="landing-section-title-md mx-auto max-w-[42rem] text-white">
            AXON evolui junto com você
          </h2>

          <p className="mx-auto mt-4 max-w-[22rem] text-sm font-medium leading-6 text-white/64 sm:max-w-[34rem] sm:text-base sm:leading-7">
            Quanto mais você usa, mais o AXON entende seu ritmo, seus padrões e
            a melhor forma de ajudar você a se organizar.
          </p>
        </header>

        <EvolutionRail />
      </div>
    </section>
  );
}

// ===========================================================================
// TRILHA DE PASSOS
// ===========================================================================

// A régua e o rail de cards precisam ter exatamente a mesma geometria — mesma
// margem, padding, gap e largura útil —, senão as bolinhas param de cair no
// centro dos seus cards. Ficam nestas duas constantes justamente para não
// divergirem quando um dos dois for ajustado.
const RAIL_GEOMETRY = "-mx-4 flex gap-4 px-4 lg:mx-auto lg:max-w-[900px] lg:px-0";

// Largura de um card (e da célula da bolinha correspondente). As porcentagens
// deixam sempre um pedaço do próximo card à mostra, que é a pista de que dá
// para arrastar: ~1 card por vez no celular, ~3 no desktop.
// É `w-`, e não `min-w-`: a largura natural de um card (~272px) fica muito
// perto dos 30% do desktop (270px), então com mínimo o card passaria alguns
// pixels da sua célula na régua e as bolinhas iriam saindo de centro, somando
// erro a cada passo. Com largura fixa + shrink-0, card e célula são idênticos.
const RAIL_ITEM_WIDTH = "w-[78%] shrink-0 lg:w-[30%]";

const LAST_STEP_INDEX = evolutionSteps.length - 1;

// Largura do esvanecimento nas bordas da trilha, por tema.
// No escuro o card é #1c0a33 sobre o #2d0850 da seção: cores quase iguais, o
// degradê some e pode ser largo. No claro o card é branco puro sobre o mesmo
// roxo escuro, e o meio do degradê vira um cinza-lavanda — esticado por 44px
// ele lê como uma mancha ao lado do card, não como uma borda. Encurtando, o
// mesmo degradê volta a parecer só um recorte suave.
// Vai no wrapper da trilha: variável CSS herda, então o rail e a régua leem a
// mesma medida sem repetir a classe nos dois.
const RAIL_FADE_WIDTH = "[--rail-fade:1.25rem] dark:[--rail-fade:2.75rem]";

// Fração do card que precisa estar à vista para ele ficar totalmente opaco.
// Abaixo disso a opacidade acompanha o quanto sobrou aparecendo, então o card
// esmaece inteiro ao sair da janela e vai ganhando corpo ao entrar — em vez de
// aparecer de uma vez, já cortado, na borda.
// Mais alto = o card começa a esmaecer mais cedo. 1 faria a opacidade cheia só
// com o card 100% à vista.
const CARD_FADE_THRESHOLD = 0.85;

function EvolutionRail() {
  const railRef = useRef(null);
  const timelineRef = useRef(null);
  const [activeStep, setActiveStep] = useState(0);

  // Dados do arrasto num ref, e não em estado: eles mudam a cada pixel de
  // movimento e nada na tela depende deles diretamente — guardar em estado
  // renderizaria a seção inteira dezenas de vezes por segundo.
  const dragRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  // Quais bordas ainda têm card escondido além delas. Começa só com a direita:
  // a trilha nasce no primeiro passo, sem nada rolado para a esquerda.
  const [fadedEdges, setFadedEdges] = useState({ start: false, end: true });

  function clampIndex(index) {
    return Math.max(0, Math.min(LAST_STEP_INDEX, index));
  }

  // O quanto o rail consegue rolar de verdade: ele para quando o último card
  // encosta na borda direita, e não quando esse card chega à esquerda.
  function getScrollableWidth() {
    const rail = railRef.current;
    if (!rail) return 0;

    return rail.scrollWidth - rail.clientWidth;
  }

  // O passo ativo sai da fração já percorrida do trecho rolável, e não da
  // divisão pela largura de um card.
  // Dividir pela largura do card só funciona quando cabe ~1 card na tela. No
  // desktop cabem 3, então o rail para em 1086px enquanto o último card
  // exigiria 1716px: a divisão travava em 4 e as duas últimas bolinhas nunca
  // acendiam. Pela fração, o começo é sempre o passo 0 e o fim é sempre o
  // último, com qualquer quantidade de cards à vista.
  function getStepFromScroll() {
    const rail = railRef.current;
    const scrollable = getScrollableWidth();
    if (!rail || scrollable <= 0) return 0;

    return clampIndex(
      Math.round((rail.scrollLeft / scrollable) * LAST_STEP_INDEX)
    );
  }

  // Opacidade de cada card conforme o quanto dele está dentro da janela do
  // rail: cheia enquanto está à vista, caindo à medida que ele sai.
  // Escreve direto no DOM em vez de passar por estado porque isso roda a cada
  // pixel de rolagem — sete opacidades em estado renderizariam a seção inteira
  // a cada frame do arrasto. Como o JSX do card não tem prop `style`, o React
  // não mexe no que é escrito aqui.
  function updateCardFade() {
    const rail = railRef.current;
    if (!rail) return;

    const railBox = rail.getBoundingClientRect();

    rail.querySelectorAll("[data-evolution-card]").forEach((card) => {
      const cardBox = card.getBoundingClientRect();
      if (cardBox.width === 0) return;

      const visibleWidth =
        Math.min(cardBox.right, railBox.right) -
        Math.max(cardBox.left, railBox.left);

      const visibleRatio = Math.max(0, visibleWidth / cardBox.width);

      card.style.opacity = Math.min(
        1,
        visibleRatio / CARD_FADE_THRESHOLD
      ).toFixed(3);
    });
  }

  // Primeira pintura e mudanças de largura: sem isso o card que já nasce
  // espiando na borda apareceria opaco até a primeira rolagem.
  useEffect(() => {
    updateCardFade();

    window.addEventListener("resize", updateCardFade);
    return () => window.removeEventListener("resize", updateCardFade);
  }, []);

  function handleScroll() {
    const rail = railRef.current;
    if (!rail) return;

    // A régua de bolinhas acompanha o arrasto dos cards na mesma proporção.
    if (timelineRef.current) {
      timelineRef.current.scrollLeft = rail.scrollLeft;
    }

    updateCardFade();

    // 1px de tolerância: em telas com zoom ou densidade fracionária o
    // scrollLeft do fim não bate exatamente com o trecho rolável.
    setFadedEdges({
      start: rail.scrollLeft > 1,
      end: rail.scrollLeft < getScrollableWidth() - 1,
    });

    setActiveStep(getStepFromScroll());
  }

  // Inverso do getStepFromScroll, para clique e rolagem concordarem: se o
  // destino fosse a posição do card, clicar nas últimas bolinhas cairia no fim
  // da rolagem e a régua devolveria outro passo.
  function handleSelectStep(index) {
    const rail = railRef.current;
    const scrollable = getScrollableWidth();
    if (!rail || scrollable <= 0) return;

    rail.scrollTo({
      left: (index / LAST_STEP_INDEX) * scrollable,
      behavior: "smooth",
    });

    setActiveStep(index);
  }

  // -------------------------------------------------------------------------
  // ARRASTO COM O MOUSE
  // -------------------------------------------------------------------------
  // Só para ponteiro de mouse: toque e caneta já rolam o rail nativamente, e
  // duplicar o movimento aí deixaria o arrasto com o dobro da velocidade.

  function handlePointerDown(event) {
    const rail = railRef.current;
    if (!rail || event.pointerType !== "mouse" || event.button !== 0) return;

    // Impede o navegador de iniciar uma seleção de texto ao puxar o card.
    event.preventDefault();

    // Captura o ponteiro para o arrasto continuar mesmo se o cursor sair do
    // rail — sem isso, puxar rápido para fora "solta" o card no meio do gesto.
    rail.setPointerCapture(event.pointerId);

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: rail.scrollLeft,
      moved: false,
    };

    setIsDragging(true);
  }

  function handlePointerMove(event) {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag || event.pointerId !== drag.pointerId) return;

    const distance = event.clientX - drag.startX;

    // 3px de tolerância para não tratar o tremor de um clique como arrasto.
    if (!drag.moved && Math.abs(distance) > 3) {
      drag.moved = true;
    }

    rail.scrollLeft = drag.startScrollLeft - distance;
  }

  function handlePointerUp(event) {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag || event.pointerId !== drag.pointerId) return;

    if (rail.hasPointerCapture(drag.pointerId)) {
      rail.releasePointerCapture(drag.pointerId);
    }

    dragRef.current = null;
    setIsDragging(false);

    // Acomoda no passo mais próximo ao soltar. É o que o scroll-snap faria
    // sozinho no toque — aqui precisa ser explícito, porque durante o arrasto
    // o snap fica desligado (ver a classe do rail).
    if (drag.moved) {
      handleSelectStep(getStepFromScroll());
    }
  }

  // Esvanece a trilha nas bordas em vez de cortá-la em reta.
  // É máscara, e não um overlay com degradê para a cor de trás: o fundo desta
  // seção tem brilhos borrados e o padrão de pontinhos, então nenhuma cor
  // chapada acompanharia o que está atrás do card. A máscara apaga o card e
  // deixa o próprio fundo aparecer, seja ele qual for.
  // O degradê só entra do lado que ainda tem card escondido: sem isso, o
  // primeiro card já nasceria desbotado na borda esquerda.
  const railMask = `linear-gradient(to right, ${
    fadedEdges.start ? "transparent" : "#000"
  } 0, #000 var(--rail-fade), #000 calc(100% - var(--rail-fade)), ${
    fadedEdges.end ? "transparent" : "#000"
  } 100%)`;

  const railMaskStyle = { WebkitMaskImage: railMask, maskImage: railMask };

  return (
    <div className={`relative mt-9 lg:mt-14 ${RAIL_FADE_WIDTH}`}>
      {/* Brilho atrás dos cards, só no desktop. Fica fora do rail porque o
          `overflow-x-auto` recortaria o desfoque e o faria rolar junto. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[24rem] w-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b2cbf]/22 blur-[90px] lg:block" />

      <EvolutionTimeline
        trackRef={timelineRef}
        activeStep={activeStep}
        onSelectStep={handleSelectStep}
        maskStyle={railMaskStyle}
      />

      {/* `snap-none` enquanto arrasta: o scroll-snap disputaria com o
          scrollLeft que o arrasto escreve a cada movimento, e o card ficaria
          preso ao ponto de encaixe em vez de acompanhar o cursor. Ao soltar, o
          handlePointerUp acomoda no passo mais próximo.
          Desligado também no desktop (`lg:snap-none`): com 3 cards à vista, o
          ponto de encaixe do `snap-center` fica longe do destino calculado
          pelo handleSelectStep, e o encaixe puxaria a rolagem para outro passo
          logo depois do clique. No mobile, com ~1 card por tela, os dois
          coincidem, então lá o snap continua ligado. */}
      <div
        ref={railRef}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={railMaskStyle}
        className={`${RAIL_GEOMETRY} relative overflow-x-auto pb-5 pt-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          isDragging
            ? "cursor-grabbing snap-none select-none"
            : "cursor-grab snap-x lg:snap-none"
        }`}
      >
        {evolutionSteps.map((step) => (
          <EvolutionCard key={step.title} step={step} />
        ))}
      </div>
    </div>
  );
}

// Tracejado: traço de 3px + intervalo de 4px.
const DASH_BG =
  "bg-[repeating-linear-gradient(to_right,#fff_0_3px,transparent_3px_7px)]";

function EvolutionTimeline({ trackRef, activeStep, onSelectStep, maskStyle }) {
  return (
    // O scroll é espelhado do rail (ver handleScroll), nunca arrastado direto:
    // daí o overflow-x-hidden. A máscara é a mesma dos cards, para as bolinhas
    // e o tracejado sumirem junto com eles nas bordas.
    <div
      ref={trackRef}
      style={maskStyle}
      className={`${RAIL_GEOMETRY} relative overflow-x-hidden`}
    >
      {evolutionSteps.map((step, index) => {
        const isActive = index === activeStep;
        const isCompleted = index < activeStep;

        return (
          <div
            key={step.eyebrow}
            className={`relative flex h-6 items-center justify-center ${RAIL_ITEM_WIDTH}`}
          >
            {/* Um único segmento por intervalo (da borda desta bolinha até a
                borda da próxima), para o tracejado não ter emenda de fase.
                A largura atravessa o gap-4: 100% + 16px de gap - 2x 11px. */}
            {index < LAST_STEP_INDEX && (
              <span
                aria-hidden="true"
                className={`absolute left-[calc(50%+11px)] top-1/2 h-[3px] w-[calc(100%-6px)] -translate-y-1/2 transition-opacity duration-300 ${DASH_BG} ${
                  index < activeStep ? "opacity-[0.85]" : "opacity-[0.28]"
                }`}
              />
            )}

            <button
              type="button"
              onClick={() => onSelectStep(index)}
              aria-label={`Ir para ${step.eyebrow}`}
              className={`relative flex shrink-0 items-center justify-center rounded-full transition active:scale-[0.9] ${
                isActive
                  ? "h-4 w-4 bg-white shadow-[0_0_0_5px_rgba(255,255,255,0.12)]"
                  : isCompleted
                  ? "h-2.5 w-2.5 bg-white/90"
                  : "h-2.5 w-2.5 bg-white/28"
              }`}
            >
              {isActive && (
                <span className="h-[7px] w-[7px] rounded-full bg-[#7b2cbf]" />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// CARD
// ===========================================================================

function EvolutionCard({ step }) {
  const Icon = step.icon;

  // Card sem borda própria: a borda era clara (#2d0850/10 sobre branco) e,
  // contra o roxo escuro desta seção, aparecia como um fio entre o acento do
  // canto e o exterior. O overflow-hidden recorta no limite interno da borda,
  // então o acento não consegue cobri-la — tirar a borda é o que deixa este
  // card igual ao da seção "Sua produtividade".
  return (
    <article
      data-evolution-card
      className={`relative min-h-[15.2rem] snap-center overflow-hidden rounded-[1.45rem] bg-white p-5 text-left text-[#2d0850] lg:min-h-[15rem] dark:bg-[#1c0a33] ${RAIL_ITEM_WIDTH}`}
    >
      <CornerAccents />

      <div className="relative z-10 flex h-full flex-col justify-center">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl border border-[#7b2cbf]/18 bg-[#7b2cbf]/10 text-[#7b2cbf] dark:border-white/10 dark:bg-white/10 dark:text-white">
          <Icon className="h-4.5 w-4.5" />
        </div>

        <p className="text-[0.62rem] font-black uppercase tracking-[0.12em] text-[#7b2cbf]">
          {step.eyebrow}
        </p>

        <h3 className="mt-2 max-w-[13rem] text-base font-black leading-[1.05] tracking-[-0.025em] text-[#2d0850] dark:text-white">
          {step.title}
        </h3>

        <p className="mt-3 max-w-[14.5rem] text-xs font-medium leading-5 text-[#2d0850]/64 dark:text-white/62">
          {step.description}
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
// FUNDO
// ===========================================================================

function EvolutionBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-14rem] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/45 blur-[120px]" />
      <div className="absolute bottom-[-16rem] left-[-10rem] h-[28rem] w-[28rem] rounded-full bg-[#7b2cbf]/30 blur-[120px]" />
      <div className="absolute bottom-[10%] right-[-14rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/20 blur-[120px]" />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.1]" />
    </div>
  );
}