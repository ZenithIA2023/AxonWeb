import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

// ===========================================================================
// CTA FINAL — LANDING PAGE
// ===========================================================================
// Última chamada da landing em largura total, sem formato de "balão".
// Mantém o mesmo limite interno de conteúdo das outras seções.

const ctaMetrics = [
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

export default function LandingFinalCTA() {
  return (
    <section className="relative overflow-hidden rounded-t-[1.75rem] bg-[#2d0850] px-4 py-14 text-white sm:px-6 sm:py-18 lg:rounded-t-[2.4rem] lg:px-10 lg:py-24 xl:px-14">
      <CTABackground />

      <div className="relative z-10 mx-auto flex max-w-[1120px] flex-col items-center text-center">
        {/* Branco fixo, sem variante dark: esta seção é roxa nos dois temas. */}
        <h2 className="landing-section-title-md mx-auto max-w-[42rem] text-white">
          Hoje você conhece o AXON.
          {/* No mobile a frase flui junto (3 linhas); a partir de `sm` volta a
              começar numa linha própria. */}
          <span className="inline font-black sm:block">
            Agora é a vez dele conhecer você.
          </span>
        </h2>

        <p className="mt-6 max-w-[22rem] text-sm font-medium leading-6 text-white/72 sm:max-w-[38rem] sm:text-base sm:leading-7">
          Em poucos minutos, o AXON começa a entender sua rotina, seus hábitos
          e a forma como você trabalha. Quanto mais ele aprende sobre você,
          mais inteligente se torna a experiência.
        </p>

        <div className="mt-8 grid w-full max-w-[25rem] grid-cols-3 divide-x divide-white/45 sm:mt-10 sm:max-w-[32rem]">
          {ctaMetrics.map((metric) => (
            <div key={metric.label} className="px-3 text-center first:pl-0 last:pr-0">
              <p className="text-sm font-black leading-none text-white sm:text-lg">
                {metric.value}
              </p>

              <p className="mx-auto mt-1 max-w-[5.8rem] text-[0.68rem] font-medium leading-4 text-white/68 sm:text-sm sm:leading-5">
                {metric.label}
              </p>
            </div>
          ))}
        </div>

        <Link
          to="/signup"
          className="mt-8 inline-flex min-h-12 w-full max-w-[21rem] items-center justify-center gap-2 rounded-full border border-white/80 bg-[#fbf8ff] px-6 text-sm font-black text-[#2d0850] transition hover:bg-white active:scale-[0.98] sm:mt-10 sm:max-w-[32rem] dark:bg-[#12001f] dark:text-white dark:hover:bg-[#1c0a33]"
        >
          Criar conta
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

// ===========================================================================
// FUNDO DO CTA
// ===========================================================================

function CTABackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-14rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/45 blur-[120px]" />
      <div className="absolute bottom-[-18rem] left-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/30 blur-[120px]" />
      <div className="absolute bottom-[-16rem] right-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/24 blur-[120px]" />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.1]" />

      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_38%)]" />
    </div>
  );
}