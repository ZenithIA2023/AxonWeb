// ===========================================================================
// SEÇÃO — EXPERIÊNCIA CONSTRUÍDA AO REDOR DO USUÁRIO
// ===========================================================================
// Seção clara para reforçar que o AXON aprende com o uso e, no futuro,
// poderá se conectar a outras ferramentas do dia a dia.

export default function LandingPersonalExperience() {
  return (
    <section className="relative overflow-hidden bg-[#fbf8ff] px-4 py-14 text-[#2d0850] sm:px-6 sm:py-18 lg:px-10 lg:py-24 xl:px-14 dark:bg-[#08070d] dark:text-white">
      <ExperienceBackground />

      <div className="relative z-10 mx-auto max-w-[1120px]">
        <header className="mx-auto max-w-[42rem] text-center">
          <h2 className="landing-section-title-md mx-auto max-w-[42rem] text-[#2d0850] dark:text-white">
            Um assistente que aprende junto com você
          </h2>

          <p className="mx-auto mt-4 max-w-[21rem] text-sm font-medium leading-6 text-[#2d0850]/64 sm:max-w-[36rem] sm:text-base sm:leading-7 dark:text-white/64">
            Quanto mais você utiliza o AXON, mais ele entende seus hábitos, sua
            rotina e a forma como você trabalha. Assim, as recomendações deixam
            de ser genéricas e passam a fazer sentido para a sua realidade.
          </p>
        </header>

        <ExperienceOrbit />
      </div>
    </section>
  );
}

// ===========================================================================
// COMPOSIÇÃO CENTRAL
// ===========================================================================

function ExperienceOrbit() {
  return (
    <div className="relative mx-auto mt-8 h-[360px] max-w-[23rem] sm:h-[430px] sm:max-w-[35rem] lg:mt-12 lg:h-[520px] lg:max-w-[760px]">
      <div className="absolute left-1/2 top-1/2 h-[17rem] w-[17rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b2cbf]/8 blur-3xl sm:h-[25rem] sm:w-[25rem] dark:bg-[#7b2cbf]/18" />

      <div className="absolute left-1/2 top-1/2 h-[17.6rem] w-[17.6rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#7b2cbf]/10 bg-white/35 sm:h-[24.2rem] sm:w-[24.2rem] dark:border-white/10 dark:bg-white/[0.035]" />

      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
        {/* O texto é todo maiúsculo (sem descendentes), então a tinta fica acima
            do centro da caixa de linha. O `top` compensa isso, proporcional ao
            tamanho da fonte em cada breakpoint. */}
        <p className="relative top-[3px] mx-auto max-w-[17rem] text-[2rem] font-black uppercase leading-[1.1] tracking-[-0.065em] text-[#2d0850] sm:top-[7px] sm:max-w-[26rem] sm:text-[3.25rem] lg:top-[7px] lg:max-w-[34rem] lg:text-[4rem] dark:text-white">
          É uma experiência construída ao redor de você
        </p>
      </div>
    </div>
  );
}

// ===========================================================================
// FUNDO
// ===========================================================================

function ExperienceBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[18%] h-[22rem] w-[22rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/7 blur-3xl dark:bg-[#7b2cbf]/18" />
      <div className="absolute -left-24 bottom-[8rem] h-52 w-52 rounded-full bg-[#7b2cbf]/8 blur-3xl dark:bg-[#7b2cbf]/14" />
      <div className="absolute -right-24 top-[8rem] h-52 w-52 rounded-full bg-[#7b2cbf]/8 blur-3xl dark:bg-[#7b2cbf]/14" />
    </div>
  );
}