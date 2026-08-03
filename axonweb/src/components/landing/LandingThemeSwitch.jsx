import { Moon, Sun } from "lucide-react";

import { useTheme } from "../theme/ThemeProvider";

// ===========================================================================
// ALTERNADOR DE TEMA — APOIO DE DESIGN
// ===========================================================================
// Botão no rodapé da landing só para comparar o visual claro e o escuro
// durante os ajustes. Usa o mesmo ThemeProvider do resto do app, então a
// escolha fica salva em localStorage e vale para as outras telas também.
// É um controle de apoio: pode ser removido quando o design estiver fechado.

export default function LandingThemeSwitch() {
  const { resolvedTheme, toggleTheme } = useTheme();

  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Ver tema claro" : "Ver tema escuro";

  return (
    <div className="flex justify-center px-4 py-7">
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={label}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#2d0850]/15 bg-white px-5 text-sm font-black text-[#2d0850] transition hover:bg-[#f3ecff] active:scale-[0.98] dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/16"
      >
        {isDark ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}

        {label}
      </button>
    </div>
  );
}
