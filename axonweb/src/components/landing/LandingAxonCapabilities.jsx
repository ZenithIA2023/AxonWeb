import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Lightbulb,
  RefreshCcw,
  TrendingUp,
} from "lucide-react";

import axonHappyWave from "../../assets/axon/axon-happy-wave.png";

// ===========================================================================
// SEÇÃO — O QUE O AXON FAZ
// ===========================================================================
// Mobile-first:
// - No mobile, o AXON fica como elemento principal.
// - Os recursos viram cards scrolláveis para não poluir a tela.
// - No desktop, mantemos a composição com recursos ao redor do mascote.

const capabilities = [
  {
    icon: ClipboardList,
    title: "Gestão inteligente de tarefas",
    description: "Organize o que precisa ser feito com mais clareza e contexto.",
  },
  {
    icon: Bot,
    title: "Assistente com IA",
    description: "Converse com o Axon para reorganizar seu dia e tirar dúvidas.",
  },
  {
    icon: CalendarDays,
    title: "Agenda integrada",
    description: "Visualize compromissos, tarefas e blocos importantes juntos.",
  },
  {
    icon: CheckCircle2,
    title: "Organização de hábitos",
    description: "Acompanhe hábitos e rotinas de forma simples e consistente.",
  },
  {
    icon: BarChart3,
    title: "Dashboard completo",
    description: "Veja seu dia, progresso, foco e próximas ações em um só lugar.",
  },
  {
    icon: Lightbulb,
    title: "Insights personalizados",
    description: "Entenda padrões da sua rotina e descubra melhores horários.",
  },
  {
    icon: RefreshCcw,
    title: "Planejamento diário",
    description: "Transforme tarefas soltas em um plano prático para o dia.",
  },
  {
    icon: TrendingUp,
    title: "Acompanhamento da evolução",
    description: "Perceba sua melhora ao longo do tempo com dados simples.",
  },
];

const leftCapabilities = capabilities.slice(0, 4);
const rightCapabilities = capabilities.slice(4);

// ===========================================================================
// COMPONENTE PRINCIPAL
// ===========================================================================

export default function LandingAxonCapabilities() {
  return (
    <section className="relative overflow-hidden bg-white px-4 py-14 text-[#2d0850] sm:px-6 sm:py-18 lg:px-10 lg:py-24 xl:px-14 dark:bg-[#08070d] dark:text-white">
      <CapabilitiesBackground />

      <div className="relative z-10 mx-auto max-w-[1120px]">
        <SectionHeader />

        <MobileCapabilities />

        <DesktopCapabilities />

        {/* mt maior no mobile: dá espaço para o padrão AXON, que agora bleeda
            um pouco abaixo do palco do robô (ver MobileCapabilities). */}
        <div className="mx-auto mt-[4.75rem] flex max-w-[22rem] justify-center lg:mt-9">
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
      </div>
    </section>
  );
}

// ===========================================================================
// CABEÇALHO
// ===========================================================================

function SectionHeader() {
  return (
    <header className="mx-auto max-w-[46rem] text-center">
      <h2 className="landing-section-title-md mx-auto max-w-[42rem] text-[#2d0850] dark:text-white">
        Descubra tudo que você pode fazer com AXON
      </h2>

      <p className="mx-auto mt-4 max-w-[20rem] text-sm font-medium leading-6 text-[#2d0850]/62 sm:max-w-[34rem] sm:text-base sm:leading-7 lg:hidden dark:text-white/62">
        Um assistente para organizar tarefas, rotina, hábitos e prioridades em
        um só lugar.
      </p>
    </header>
  );
}

// ===========================================================================
// MOBILE
// ===========================================================================

function MobileCapabilities() {
  return (
    <div className="mt-8 lg:hidden">
      <MobileCardsRail />

      {/* Wrapper sem overflow-hidden e sem altura fixa: o padrão AXON precisa
          de mais altura do que o palco (340px) para não cortar a última linha
          de texto, então ele vive aqui fora, livre para bleedar um pouco
          abaixo do palco. O respiro extra antes do botão "Criar conta"
          (mt-[4.75rem] mais abaixo) existe por causa disso. */}
      <div className="relative mx-auto max-w-[23rem]">
        {/* Primeiro filho: como os irmãos são todos absolutos e sem z-index, a
            ordem do DOM define a pintura — então o padrão fica atrás do
            cilindro e do robô. */}
        <MobilePattern />

        {/* Os dois brilhos ficam fora da caixa recortada (overflow-hidden)
            abaixo: um blur precisa de bem mais espaço para esvanecer do que
            o tamanho do próprio elemento, e a caixa de 340px cortava o
            desfoque no meio do caminho — sobrava uma borda dura em vez de um
            brilho suave. Aqui, sem clipping, ele esvanece por completo. */}
        <div className="absolute left-1/2 top-[56%] h-[18rem] w-[13rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b2cbf]/35 blur-2xl dark:bg-[#7b2cbf]/40" />

        <div className="absolute left-1/2 top-[58%] h-[16.5rem] w-[10rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2d0850]/12 blur-[28px] dark:bg-black/28" />

        {/* Sem overflow-hidden: a drop-shadow roxa do robô precisa de ~100px
            de folga além da própria caixa dele para esvanecer (offset 30px +
            blur 48px). Com o recorte, ela era cortada em reta no topo e na
            base — bem visível no tema claro, onde é roxa sobre branco.
            O recorte do robô já é feito pela máscara na imagem, então a caixa
            não precisa recortar nada. */}
        <div className="relative flex h-[340px] items-center justify-center">
          <div className="absolute left-1/2 top-[58%] h-[16rem] w-[10.5rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2d0850] dark:bg-[#7b2cbf]" />

          {/* Contorno externo: mesmo centro do cilindro, porém maior, o que cria
              o espaçamento uniforme entre o cilindro e a linha. */}
          <div className="absolute left-1/2 top-[58%] h-[17.5rem] w-[12rem] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[#2d0850]/60 dark:border-[#7b2cbf]/60" />

          {/* O AXON é maior que o cilindro: a cabeça passa por cima, os braços
              pelos lados e o corpo desce até a base. O translate-y compensa a
              centralização do flex, mantendo a cabeça na mesma altura enquanto a
              imagem cresce só para baixo.
              A máscara garante que a base termine exatamente junto com o cilindro:
              até 80% da altura mostra tudo (preservando os braços, que ficam fora
              do cilindro); daí para baixo mostra apenas o que estiver dentro do
              arco inferior da cápsula. */}
          {/* A sombra fica no wrapper, e não na imagem: assim ela é gerada a
              partir da silhueta já mascarada e acompanha o contorno, em vez de
              ser cortada em linha reta pela máscara. */}
          <div className="relative z-10 translate-x-[8px] translate-y-[15px] drop-shadow-[0_30px_48px_rgba(45,8,80,0.82)] dark:drop-shadow-[0_34px_56px_rgba(0,0,0,0.34)]">
            <img
              src={axonHappyWave}
              alt="Mascote Axon acenando"
              className="h-[367px] w-auto max-w-none object-contain"
              style={{
                WebkitMaskImage:
                  "linear-gradient(#000 0 80%, transparent 80%), radial-gradient(circle 84px at calc(50% - 8px) 65.3%, #000 99%, transparent 100%)",
                maskImage:
                  "linear-gradient(#000 0 80%, transparent 80%), radial-gradient(circle 84px at calc(50% - 8px) 65.3%, #000 99%, transparent 100%)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileCardsRail() {
  const railRef = useRef(null);
  const [activeCard, setActiveCard] = useState(0);

  // Descobre qual card está em foco dividindo a rolagem pela largura de um
  // card mais o gap — mesmo cálculo usado na trilha da seção de evolução.
  function handleScroll() {
    const rail = railRef.current;
    if (!rail) return;

    const firstCard = rail.querySelector("[data-capability-card]");
    if (!firstCard) return;

    const cardWidth = firstCard.getBoundingClientRect().width;
    const gap = 12; // gap-3
    const nextIndex = Math.round(rail.scrollLeft / (cardWidth + gap));

    setActiveCard(Math.max(0, Math.min(capabilities.length - 1, nextIndex)));
  }

  return (
    <div className="relative mt-2 -mx-4">
      {/* Contador: uma bolinha por card, vazada com contorno na cor do cilindro.
          A do card atual fica maior e preenchida com o próprio roxo do
          contorno, ficando sólida em vez de vazada.
          Tamanhos herdados da trilha da seção "AXON evolui junto com você". */}
      <div className="mb-3 flex items-center justify-center gap-[10px]">
        {capabilities.map((item, index) => (
          // Cada bolinha mora numa célula de tamanho fixo (o tamanho da bolinha
          // ativa). Assim a linha nunca muda de altura nem de largura enquanto a
          // animação acontece — sem isso, arrastar rápido faz a régua encolher e
          // a página inteira balança abaixo dela.
          <span
            key={item.title}
            className="flex h-4 w-4 shrink-0 items-center justify-center"
          >
            <span
              className={`rounded-full border border-[#2d0850] transition-all duration-200 dark:border-[#7b2cbf] ${
                index === activeCard
                  ? "h-4 w-4 bg-[#2d0850] dark:bg-[#7b2cbf]"
                  : "h-2.5 w-2.5 bg-transparent"
              }`}
            />
          </span>
        ))}
      </div>

      <div
        ref={railRef}
        onScroll={handleScroll}
        className="flex snap-x gap-3 overflow-x-auto px-4 pb-4 pt-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {capabilities.map((item) => (
          <MobileCapabilityCard key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}

function MobileCapabilityCard({ item }) {
  const Icon = item.icon;

  return (
    <article
      data-capability-card
      className="min-w-[76%] snap-center rounded-[1.45rem] border border-[#2d0850]/10 bg-white p-4 dark:border-white/10 dark:bg-[#11101a]"
    >
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl border border-[#7b2cbf]/18 bg-[#7b2cbf]/10 text-[#7b2cbf] dark:border-white/10 dark:bg-white/10 dark:text-white">
        <Icon className="h-4.5 w-4.5" />
      </div>

      <h3 className="max-w-[12rem] text-base font-black leading-[1.05] tracking-[-0.025em] text-[#2d0850] dark:text-white">
        {item.title}
      </h3>

      <p className="mt-3 text-xs font-medium leading-5 text-[#2d0850]/64 dark:text-white/62">
        {item.description}
      </p>
    </article>
  );
}

// ===========================================================================
// DESKTOP
// ===========================================================================

function DesktopCapabilities() {
  return (
    // Coluna central com largura fixa (420px) em vez de `minmax`: o palco do
    // mascote é posicionado por porcentagem e precisa de uma caixa previsível.
    // O AXON tem 440px de largura e transborda 10px para cada lado — cabe
    // folgado dentro do gap de 40px, sem encostar nos recursos.
    <div className="relative mx-auto mt-12 hidden max-w-[960px] grid-cols-[minmax(0,1fr)_420px_minmax(0,1fr)] items-center gap-10 lg:grid">
      <DesktopPattern />

      {/* Cada coluna se alinha à sua borda externa: a da esquerda à esquerda, a
          da direita à direita. O `items-*` importa tanto quanto o `text-*` —
          como cada bloco tem largura de conteúdo, é ele que garante que os
          títulos e os riscos comecem todos na mesma vertical. */}
      <div className="relative z-20 flex flex-col items-start gap-6 text-left">
        {leftCapabilities.map((item) => (
          <DesktopCapabilityLine key={item.title} item={item} align="left" />
        ))}
      </div>

      <DesktopAxon />

      <div className="relative z-20 flex flex-col items-end gap-6 text-right">
        {rightCapabilities.map((item) => (
          <DesktopCapabilityLine key={item.title} item={item} align="right" />
        ))}
      </div>
    </div>
  );
}

// Mesma composição do mobile (o AXON saindo de dentro do cilindro), ampliada
// por 1.2 — a razão entre as alturas do mascote nos dois breakpoints
// (440px / 367px). Toda medida absoluta foi escalada por esse fator; as
// porcentagens são relativas ao palco e continuam idênticas.
function DesktopAxon() {
  return (
    // Altura fixa (o palco de 340px do mobile escalado) em vez de
    // `min-h` + `items-end`: o cilindro é posicionado por porcentagem, então
    // precisa de uma caixa de altura conhecida.
    // Sem overflow-hidden — pelos mesmos dois motivos descritos no mobile: os
    // brilhos precisam de espaço além da própria caixa para esvanecer, e a
    // drop-shadow do robô é cortada em reta se houver recorte. O recorte da
    // base do mascote é feito pela máscara na imagem.
    <div className="relative z-10 flex h-[408px] items-center justify-center">
      <div className="absolute left-1/2 top-[56%] h-[345px] w-[249px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b2cbf]/35 blur-[48px] dark:bg-[#7b2cbf]/40" />

      <div className="absolute left-1/2 top-[58%] h-[317px] w-[192px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2d0850]/12 blur-[34px] dark:bg-black/28" />

      {/* Cilindro. A largura (202px) é o dobro do raio do círculo da máscara
          abaixo — é isso que faz a base do mascote terminar exatamente no arco
          inferior da cápsula. Mexeu num, mexa no outro. */}
      <div className="absolute left-1/2 top-[58%] h-[307px] w-[202px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2d0850] dark:bg-[#7b2cbf]" />

      {/* Contorno externo: mesmo centro do cilindro, porém maior, o que cria o
          espaçamento uniforme entre o cilindro e a linha. */}
      <div className="absolute left-1/2 top-[58%] h-[336px] w-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[4px] border-[#2d0850]/60 dark:border-[#7b2cbf]/60" />

      {/* `shrink-0` + `max-w-none`: a imagem é quadrada (1080x1080), então com
          440px de altura ela também tem 440px de largura — mais que a coluna de
          420px. Sem os dois, o `max-width: 100%` do preflight a espremia e a
          altura pedida nunca acontecia (era esse o bug do desktop anterior).
          A sombra fica no wrapper, e não na imagem: assim ela é gerada a partir
          da silhueta já mascarada e acompanha o contorno. */}
      <div className="relative z-10 shrink-0 translate-x-[10px] translate-y-[18px] drop-shadow-[0_36px_58px_rgba(45,8,80,0.82)] dark:drop-shadow-[0_41px_67px_rgba(0,0,0,0.34)]">
        <img
          src={axonHappyWave}
          alt="Mascote Axon acenando"
          className="h-[440px] w-auto max-w-none object-contain"
          style={{
            WebkitMaskImage:
              "linear-gradient(#000 0 80%, transparent 80%), radial-gradient(circle 101px at calc(50% - 10px) 65.3%, #000 99%, transparent 100%)",
            maskImage:
              "linear-gradient(#000 0 80%, transparent 80%), radial-gradient(circle 101px at calc(50% - 10px) 65.3%, #000 99%, transparent 100%)",
          }}
        />
      </div>
    </div>
  );
}

function DesktopCapabilityLine({ item, align }) {
  const isRightAligned = align === "right";

  return (
    <div
      className={`relative max-w-[14rem] ${
        isRightAligned ? "text-right" : "text-left"
      }`}
    >
      <p className="text-base font-black leading-[1.08] tracking-[-0.025em] text-[#2d0850] dark:text-white">
        {item.title}
      </p>

      <div
        className={`mt-2 h-[2px] w-[11rem] rounded-full bg-[#2d0850]/78 dark:bg-white/75 ${
          isRightAligned ? "ml-auto" : "mr-auto"
        }`}
      />
    </div>
  );
}

// ===========================================================================
// FUNDO
// ===========================================================================

function CapabilitiesBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="absolute left-1/2 top-[24%] h-[18rem] w-[18rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/7 blur-3xl sm:h-[22rem] sm:w-[22rem] dark:bg-[#7b2cbf]/18" />
    </div>
  );
}

// Mesma ideia do DesktopPattern, com menos colunas e tipo menor para caber na
// largura do celular.
function MobilePattern() {
  return (
    // Sem "inset-0"/overflow-hidden: a altura fica livre para acompanhar o
    // conteúdo (a grade de texto), então nenhuma linha é cortada pela metade.
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 opacity-[0.055] dark:opacity-[0.04]"
    >
      <div className="grid grid-cols-4 gap-x-2 gap-y-1 text-center text-[2rem] font-black leading-none tracking-[-0.08em] text-[#2d0850] dark:text-white">
        {Array.from({ length: 44 }).map((_, index) => (
          <span key={index}>AXON</span>
        ))}
      </div>
    </div>
  );
}

function DesktopPattern() {
  return (
    // Mesma ideia do MobilePattern: sem `bottom-0`/`overflow-hidden`, a altura
    // acompanha o conteúdo e nenhuma linha é cortada pela metade. Antes a caixa
    // era recortada em 376px com 543px de texto dentro, e a 9ª linha aparecia
    // partida no rodapé.
    // Em vez de recortar, o número de linhas é que preenche o palco: 9 linhas
    // de 41.6px (text-[2.6rem] + leading-none) com gap-y-1 dão 406.4px, contra
    // os 408px do DesktopAxon — encaixa quase exato, e o `-translate-y-1/2`
    // centraliza a grade no palco. Mudou a altura do palco? Ajuste a contagem.
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-[-4rem] top-1/2 -translate-y-1/2 opacity-[0.055] dark:opacity-[0.04]"
    >
      <div className="grid grid-cols-8 gap-x-2 gap-y-1 text-center text-[2.6rem] font-black leading-none tracking-[-0.08em] text-[#2d0850] dark:text-white">
        {Array.from({ length: 72 }).map((_, index) => (
          <span key={index}>AXON</span>
        ))}
      </div>
    </div>
  );
}