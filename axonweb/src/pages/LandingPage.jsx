import { useEffect } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Star } from "lucide-react";

import { refreshSession, saveSession } from "../lib/api";
import LandingPurpleBackground from "../components/landing/LandingPurpleBackground";
import LandingProductivityProblem from "../components/landing/LandingProductivityProblem";
import LandingAxonCapabilities from "../components/landing/LandingAxonCapabilities";
import LandingAxonEvolution from "../components/landing/LandingAxonEvolution";
import LandingPersonalExperience from "../components/landing/LandingPersonalExperience";
import LandingFinalCTA from "../components/landing/LandingFinalCTA";
import LandingThemeSwitch from "../components/landing/LandingThemeSwitch";

import axonHappy from "../assets/axon/axon-happy.png";
import brainDecoration from "../assets/decorations/brain.svg";
import starDecoration from "../assets/decorations/star.svg";

// ===========================================================================
// LANDING PAGE — REDESIGN
// ===========================================================================
// Hero mobile-first com suporte real a light/dark mode.
// No light mode, a landing fica clara/lavanda.
// No dark mode, mantém o visual roxo escuro original.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const heroMetrics = [
  {
    value: "15 minutos",
    label: "para configurar",
  },
  {
    value: "100%",
    label: "personalizado para você",
  },
  {
    value: "24 horas",
    label: "com você",
  },
];

export default function LandingPage() {
  const navigate = useNavigate();

  // Mantém o comportamento atual: usuários logados não ficam presos na landing.
  useEffect(() => {
    const refreshToken = localStorage.getItem("axon_refresh_token");
    const lastActive = Number(localStorage.getItem("axon_last_active") ?? "0");

    if (!refreshToken) return;

    if (Date.now() - lastActive > SEVEN_DAYS_MS) {
      localStorage.removeItem("axon_token");
      localStorage.removeItem("axon_refresh_token");
      localStorage.removeItem("axon_user");
      localStorage.removeItem("axon_last_active");
      return;
    }

    refreshSession(refreshToken)
      .then((res) => {
        saveSession(res);
        navigate("/dashboard", { replace: true });
      })
      .catch(() => {
        localStorage.removeItem("axon_token");
        localStorage.removeItem("axon_refresh_token");
        localStorage.removeItem("axon_user");
        localStorage.removeItem("axon_last_active");
      });
  }, [navigate]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#fbf8ff] text-[#2d0850] dark:bg-[#12001f] dark:text-white">
      <LandingHero />
      <LandingIntroBlock />
      <LandingProductivityProblem />
      <LandingAxonCapabilities />
      <LandingAxonEvolution />
      <LandingPersonalExperience />
      <LandingFinalCTA />

      <LandingThemeSwitch />
    </main>
  );
}

// ===========================================================================
// HERO
// ===========================================================================

function LandingHero() {
  return (
    <div className="relative z-10">
      {/* Camadas empilhadas atrás do hero: cada uma aparecendo
          um pouco mais abaixo, com opacidade decrescente (100% / 75% / 50%). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-[-12px] h-24 rounded-b-[1.35rem] bg-[#7b2cbf]/75 lg:bottom-[-16px] lg:rounded-b-[1.9rem]"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-[-24px] h-24 rounded-b-[1rem] bg-[#7b2cbf]/50 lg:bottom-[-32px] lg:rounded-b-[1.45rem]"
      />

      {/* Sem `min-h` de viewport: com o bloco de introdução fora do hero, o
          conteúdo deixou de encher a tela e a altura forçada virava uma faixa
          vazia embaixo das métricas. Agora a altura é a do conteúdo.
          O enxugamento do hero vale só do `lg` para cima, que é onde ele vira
          duas colunas. No celular tudo continua como era: `min-h-[100svh]` para
          o hero ocupar a tela inteira e `pb-20` embaixo. O `lg:min-h-0` é o que
          cancela essa altura mínima no desktop, onde ela virava faixa vazia.
          O padding de baixo no desktop é metade do padrão das seções
          (`lg:pb-12` contra `lg:py-24`), por escolha de design: com o
          `lg:items-end` as métricas encostam na base da linha e os 96px cheios
          deixavam o hero com cara de inacabado.
          O de cima é menor nos dois, porque ali mora a barra com o logo. */}
      <section className="relative z-10 isolate min-h-[100svh] overflow-hidden rounded-b-[1.75rem] bg-[#fbf8ff] px-4 pb-20 pt-7 text-[#2d0850] sm:px-6 lg:flex lg:min-h-0 lg:items-start lg:rounded-b-[2.4rem] lg:px-10 lg:pb-12 lg:pt-8 xl:px-14 dark:bg-[#2d0850] dark:text-white">
        <LandingPurpleBackground intensity="strong" />

        {/* `lg:items-end`: a coluna de texto é mais baixa que a do mascote, e
            centralizada ela sobrava ~86px de folga embaixo das métricas antes
            do fim da linha. Alinhada pela base, as métricas terminam junto com
            o mascote e o único respiro até a borda do hero passa a ser o
            `pb-24` — o mesmo padding das outras seções. */}
        <div className="relative z-10 mx-auto flex w-full max-w-[1180px] flex-col lg:grid lg:grid-cols-[minmax(0,0.82fr)_minmax(420px,0.82fr)] lg:items-end lg:gap-10 lg:pt-10">
          <HeroTopBar />

          <HeroContent />

          <HeroRobotStage />

          <HeroIntroBlock />
        </div>
      </section>
    </div>
  );
}

// ===========================================================================
// INTRODUÇÃO — "NEM SEMPRE UM DIA CHEIO É UM DIA PRODUTIVO"
// ===========================================================================
// Este bloco tem dois lugares na página, um por breakpoint:
// - até o `lg`, dentro do hero, separado por um filete (HeroIntroBlock);
// - do `lg` para cima, como seção própria logo abaixo do hero, na mesma
//   composição do bloco "Sua produtividade não deveria depender apenas de
//   disciplina" (LandingIntroBlock).
// Como não dá para mover um nó de uma seção para outra só com CSS, os dois
// existem no HTML e cada um se esconde no breakpoint do outro. O texto mora
// nesta constante para não haver duas versões dele para manter.

const introCopy = {
  title: "Nem sempre um dia cheio é um dia produtivo",
  lead: "Você já terminou um dia inteiro ocupado, mas ainda sentiu que não avançou no que realmente importava?",
  body: "Essa sensação não nasce da falta de disciplina. Ela aparece quando sua rotina tenta seguir um modelo genérico, sem considerar seu ritmo, sua energia e a forma como você realmente funciona.",
};

function LandingIntroBlock() {
  return (
    // Só padding no topo: o espaço até o próximo bloco vem do `py` da seção
    // seguinte. Com padding embaixo aqui também, o intervalo dobraria.
    // Sem `bg` e sem `z-index` de propósito, para as camadas empilhadas que
    // saem da base do hero continuarem passando por cima desta faixa.
    <section className="relative hidden px-4 lg:block lg:px-10 lg:pt-24 xl:px-14">
      <div className="mx-auto max-w-[1120px]">
        <div className="mx-auto max-w-[44rem] text-center">
          <div className="mx-auto mb-5 h-1 w-20 rounded-full bg-[#2d0850] dark:bg-white" />

          <h2 className="landing-section-title-md mx-auto max-w-[42rem] text-[#2d0850] dark:text-white">
            {introCopy.title}
          </h2>

          <p className="mx-auto mt-5 max-w-[36rem] text-sm leading-6 text-[#2d0850]/62 sm:text-base sm:leading-7 dark:text-white/62">
            {introCopy.lead}
          </p>

          <p className="mx-auto mt-4 max-w-[36rem] text-sm leading-6 text-[#2d0850]/62 sm:text-base sm:leading-7 dark:text-white/62">
            {introCopy.body}
          </p>
        </div>
      </div>
    </section>
  );
}

// Versão de dentro do hero, só até o `lg`. Sem variantes `lg:` nas classes:
// no desktop este nó é `display: none` e some da grade do hero.
function HeroIntroBlock() {
  return (
    <div className="mx-auto mt-4 w-full max-w-[42rem] text-center lg:hidden">
      <div className="w-full border-t border-[#2d0850]/12 pt-8 dark:border-white/12">
        <h2 className="mx-auto max-w-[42rem] text-[1.85rem] font-black leading-[0.92] tracking-[-0.055em] text-[#2d0850] sm:text-[2.6rem] dark:text-white">
          {introCopy.title}
        </h2>

        <div className="mx-auto mt-4 max-w-[35rem]">
          <p className="text-sm font-medium leading-6 text-[#2d0850]/72 sm:text-base sm:leading-7 dark:text-white/72">
            {introCopy.lead}
          </p>

          <p className="mt-3 text-sm leading-6 text-[#2d0850]/62 sm:text-base sm:leading-7 dark:text-white/58">
            {introCopy.body}
          </p>
        </div>
      </div>
    </div>
  );
}

function HeroTopBar() {
  return (
    <header className="relative z-30 mb-7 flex items-center justify-center lg:absolute lg:left-0 lg:top-0 lg:mb-0 lg:w-full lg:justify-between">
      <HeroLogo />

      <nav className="hidden items-center gap-2 lg:flex">
        <HeroTopButton to="/signup" variant="outline">
          Criar
        </HeroTopButton>

        <HeroTopButton to="/login" variant="filled">
          Entrar
        </HeroTopButton>
      </nav>
    </header>
  );
}

function HeroContent() {
  return (
    <div className="relative z-20 mx-auto flex w-full max-w-[23rem] flex-col items-center text-center sm:max-w-[30rem] lg:mx-0 lg:max-w-[34rem] lg:items-start lg:text-left">
      <HeroStars />

      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.48, delay: 0.04 }}
        className="mt-3 max-w-[20rem] text-[2.35rem] font-black leading-[0.9] tracking-[-0.055em] text-[#2d0850] sm:max-w-[30rem] sm:text-[3.25rem] lg:mt-4 lg:max-w-[31rem] lg:text-[3.65rem] xl:text-[4.25rem] dark:text-white"
      >
        Seu assistente inteligente de produtividade
      </motion.h1>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.48, delay: 0.1 }}
        className="mt-4 max-w-[20.5rem] sm:max-w-[29rem] lg:max-w-[33rem] lg:border-l lg:border-[#2d0850]/25 lg:pl-4 dark:lg:border-white/35"
      >
        <p className="text-[0.93rem] font-medium leading-5 text-[#2d0850]/72 sm:text-[0.95rem] sm:leading-7 lg:text-base dark:text-white/72">
          O AXON aprende sua rotina, entende seus padrões de produtividade e
          ajuda você a organizar tarefas, hábitos e compromissos de forma
          personalizada, para que você tenha mais foco, clareza e equilíbrio
          todos os dias.
        </p>
      </motion.div>

      <HeroMobileActions />

      <HeroInfoStack />
    </div>
  );
}

function HeroLogo() {
  return (
    <Link
      to="/"
      className="inline-flex items-center justify-center gap-2 text-[#2d0850] dark:text-white"
      aria-label="Axon"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#8118ee] text-white shadow-[0_0_24px_rgba(123,44,191,0.18)] sm:h-8 sm:w-8 lg:h-9 lg:w-9 dark:bg-white dark:text-[#2d0850] dark:shadow-[0_0_24px_rgba(255,255,255,0.24)]">
        <img
          src="/axon-logo-inverted.svg"
          alt=""
          className="h-5 w-5 object-contain sm:h-6 sm:w-6 lg:h-7 lg:w-7 dark:hidden"
        />
        <img
          src="/axon-logo.svg"
          alt=""
          className="hidden h-5 w-5 object-contain sm:h-6 sm:w-6 lg:h-7 lg:w-7 dark:block"
        />
      </span>

      <span className="text-[0.78rem] font-black uppercase tracking-[0.16em] sm:text-sm lg:text-base">
        Axon
      </span>
    </Link>
  );
}

function HeroStars() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: 0.03 }}
      className="flex items-center justify-center gap-1 lg:justify-start"
      aria-label="Avaliação cinco estrelas"
    >
      {Array.from({ length: 5 }).map((_, index) => (
        <Star
          key={index}
          className="h-3.5 w-3.5 fill-[#f7d84a] text-[#f7d84a] drop-shadow-[0_0_8px_rgba(247,216,74,0.38)] sm:h-4 sm:w-4"
        />
      ))}
    </motion.div>
  );
}

function HeroMobileActions() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.48, delay: 0.16 }}
      className="relative z-30 mt-5 grid w-full max-w-[12.4rem] gap-2.5 sm:mt-6 sm:max-w-[20rem] sm:grid-cols-2 lg:hidden"
    >
      <HeroButton to="/login" variant="primary">
        Entrar
        <ArrowRight className="h-4 w-4" />
      </HeroButton>

      <HeroButton to="/signup" variant="secondary">
        Criar conta
      </HeroButton>
    </motion.div>
  );
}

function HeroInfoStack() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.48, delay: 0.22 }}
      className="mt-7 flex w-full max-w-[20rem] flex-col items-center sm:max-w-[26rem] lg:max-w-[25rem] lg:items-start"
    >
      <div className="order-1 lg:order-2">
        <HeroMetrics />
      </div>

      <div className="order-2 mt-5 lg:order-1 lg:mb-5 lg:mt-0">
        <PlayStoreSoon />
      </div>
    </motion.div>
  );
}

function HeroMetrics() {
  return (
    <div className="grid w-full grid-cols-3 divide-x divide-[#2d0850]/25 dark:divide-white/35">
      {heroMetrics.map((metric) => (
        <div
          key={metric.label}
          className="px-2 text-center first:pl-0 last:pr-0 lg:text-left"
        >
          <p className="text-[0.92rem] font-black leading-none text-[#2d0850] sm:text-base dark:text-white">
            {metric.value}
          </p>

          <p className="mx-auto mt-1 max-w-[5.4rem] text-[0.76rem] font-medium leading-3 text-[#2d0850]/62 sm:text-[0.68rem] sm:leading-4 lg:mx-0 dark:text-white/62">
            {metric.label}
          </p>
        </div>
      ))}
    </div>
  );
}

function PlayStoreSoon() {
  return (
    <div className="w-full max-w-[13.2rem] sm:max-w-[16rem] lg:max-w-[12.5rem]">
      <p className="mb-2 text-center text-[0.64rem] font-black text-[#2d0850] sm:text-xs lg:text-left dark:text-white">
        Em breve na
      </p>

      <div className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 text-[#2d0850] shadow-[0_16px_34px_rgba(45,8,80,0.14)] dark:shadow-[0_16px_34px_rgba(0,0,0,0.20)]">
        <PlayStoreIcon />
        <span className="text-[0.7rem] font-black sm:text-xs">
          Google Play
        </span>
      </div>
    </div>
  );
}

// Geometria do palco no desktop, toda derivada do asset (1080x1080): a cabeça
// do mascote começa em 8.8% da altura da imagem e a gola roxa termina em 55.6%.
//
// O palco é mais baixo que o mascote de propósito. Ele define só o quanto a
// coluna ocupa na linha do grid; o mascote transborda por baixo e é a própria
// seção (que tem `overflow-hidden` e `rounded-b`) que corta, dando o efeito de
// ele estar saindo de trás dos quadrados empilhados.
// A conta que amarra os dois: palco = 78% da altura do mascote - 40px (os 48px
// do `pb-12` da seção menos os 8px do `top-2` do mascote). Mexeu num, refaça a
// conta do outro, senão o corte sai do lugar — a base do corpo está em 89% da
// imagem, então acima disso revela o robô inteiro e muito abaixo corta o dorso.
//
// O `max-w-none` na imagem é obrigatório: ela é quadrada (1080x1080), então a
// 640px de altura tem 640px de largura, mais que a coluna — sem ele o
// `max-width: 100%` do preflight espremia a imagem e a altura pedida nunca
// acontecia. O transbordo é invisível: o robô ocupa só 22%–80% da largura da
// imagem, ou seja 373px de pixels visíveis dentro de uma coluna de 452px+.
// Como as colunas são `items-end`, isso vale mesmo se a coluna de texto crescer
// e esticar a linha: o corte é ancorado na base, não no topo.
function HeroRobotStage() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.65, delay: 0.22, ease: "easeOut" }}
      className="pointer-events-none relative mx-auto mt-8 h-[350px] w-full max-w-[23rem] sm:h-[440px] sm:max-w-[30rem] lg:mt-0 lg:h-[459px] lg:max-w-none xl:h-[506px]"
    >
      <div className="absolute left-1/2 top-[42%] h-[22.5rem] w-[22.5rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b2cbf]/28 blur-[80px] sm:top-[58%] sm:h-[24rem] sm:w-[24rem] lg:top-[46%] lg:h-[25rem] lg:w-[25rem] lg:blur-[110px] xl:h-[27rem] xl:w-[27rem] dark:bg-[#7b2cbf]/60" />

      {/* Círculo e contorno cobrem da cabeça até a gola, e só. Os 20rem são a
          distância entre 8.8% e 55.6% da imagem na altura de mascote do `lg`. */}
      <div className="absolute left-1/2 top-[47%] h-[18rem] w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b2cbf]/18 sm:top-[61%] sm:h-[22rem] sm:w-[22rem] lg:top-[40%] lg:h-[25rem] lg:w-[25rem] xl:h-[22rem] xl:w-[22rem] dark:bg-[#7b2cbf]/55" />

      <div className="absolute left-1/2 top-[47%] h-[18rem] w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#2d0850]/10 sm:top-[61%] sm:h-[22rem] sm:w-[22rem] lg:top-[40%] lg:h-[25rem] lg:w-[25rem] xl:h-[22rem] xl:w-[22rem] dark:border-white/10" />

      <span className="absolute left-1/2 top-[4%] h-3 w-3 -translate-x-1/2 rounded-full bg-[#7b2cbf] sm:top-[13%] sm:h-4 sm:w-4 lg:top-[-4%] dark:bg-white" />
      <span className="absolute bottom-[47%] right-[17%] h-3 w-3 rounded-full bg-[#7b2cbf] sm:bottom-[17%] sm:right-[21%] sm:h-4 sm:w-4 lg:bottom-[46%] lg:right-[15%] dark:bg-white" />

      <img
        src={brainDecoration}
        alt=""
        aria-hidden="true"
        className="absolute left-[12%] top-[13%] h-12 w-12 -rotate-12 opacity-70 invert sm:left-[15%] sm:top-[22%] sm:h-10 sm:w-10 lg:left-[14%] lg:top-[08%] lg:h-12 lg:w-12 dark:invert-0 dark:opacity-80"
      />

      <img
        src={starDecoration}
        alt=""
        aria-hidden="true"
        className="absolute right-[11%] top-[07%] h-16 w-16 rotate-4 opacity-80 invert sm:right-[15%] sm:top-[20%] sm:h-12 sm:w-12 lg:right-[12%] lg:top-[05%] lg:h-14 lg:w-14 dark:invert-0 dark:opacity-90"
      />

      <img
        src={starDecoration}
        alt=""
        aria-hidden="true"
        className="absolute bottom-[52%] left-[06%] h-8 w-8 -rotate-38 opacity-65 invert sm:bottom-[24%] sm:left-[12%] sm:h-10 sm:w-10 lg:bottom-[53%] lg:left-[8%] lg:h-12 lg:w-12 dark:invert-0 dark:opacity-75"
      />

      <img
        src={brainDecoration}
        alt=""
        aria-hidden="true"
        className="absolute bottom-[58%] right-[07%] h-10 w-10 rotate-38 opacity-35 invert sm:bottom-[31%] sm:right-[8%] sm:h-9 sm:w-9 lg:bottom-[67%] lg:right-[7%] lg:h-10 lg:w-10 dark:invert-0 dark:opacity-40"
      />

      <div className="relative z-10 top-[-27px] lg:translate-x-[-70px] mb-[-1.6rem] w-fit sm:top-14 lg:top-[-35px]">
        <motion.img
          src={axonHappy}
          alt="Mascote Axon feliz"
          animate={{ y: [-5, 5, -5] }}
          transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
          className="block h-[442px] w-auto object-contain drop-shadow-[0_34px_70px_rgba(0,0,0,0.38)] sm:h-[410px] lg:h-[640px] lg:max-w-none xl:h-[700px]"
        />
      </div>
    </motion.div>
  );
}

// ===========================================================================
// COMPONENTES MENORES
// ===========================================================================

function HeroButton({ children, to, variant = "primary" }) {
  const isPrimary = variant === "primary";

  return (
    <Link
      to={to}
      className={`relative z-30 inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 text-[0.72rem] font-black transition active:scale-[0.98] sm:min-h-11 sm:text-sm ${
        isPrimary
          ? "bg-[#8d31dd] text-white shadow-[0_14px_30px_rgba(0,0,0,0.2)] hover:bg-[#9b3bee]"
          : "border border-[#2d0850]/45 bg-transparent text-[#2d0850] hover:bg-[#2d0850]/5 dark:border-white/80 dark:text-white dark:hover:bg-white/10"
      }`}
    >
      {children}
    </Link>
  );
}

function HeroTopButton({ children, to, variant = "outline" }) {
  const isFilled = variant === "filled";

  return (
    <Link
      to={to}
      className={`relative z-30 inline-flex min-h-9 items-center justify-center rounded-full px-5 text-sm font-black transition active:scale-[0.98] ${
        isFilled
          ? "bg-[#8d31dd] text-white shadow-[0_14px_30px_rgba(0,0,0,0.2)] hover:bg-[#9b3bee]"
          : "border border-[#2d0850]/45 bg-transparent text-[#2d0850] hover:bg-[#2d0850]/5 dark:border-white/80 dark:text-white dark:hover:bg-white/10"
      }`}
    >
      {children}
    </Link>
  );
}

function PlayStoreIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 sm:h-5 sm:w-5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="#34A853"
        d="M4.4 3.2c-.2.3-.4.7-.4 1.2v15.2c0 .5.1.9.4 1.2l8.4-8.8-8.4-8.8Z"
      />
      <path
        fill="#4285F4"
        d="m13.7 11.1 2.7-2.8L6.2 2.5c-.7-.4-1.3-.3-1.8.1l9.3 8.5Z"
      />
      <path
        fill="#FBBC04"
        d="m13.7 12.9-9.3 8.5c.5.4 1.1.5 1.8.1l10.2-5.8-2.7-2.8Z"
      />
      <path
        fill="#EA4335"
        d="m20.2 10.6-3.8-2.2-2.9 3 2.9 3 3.8-2.2c.9-.5.9-1.1 0-1.6Z"
      />
    </svg>
  );
}