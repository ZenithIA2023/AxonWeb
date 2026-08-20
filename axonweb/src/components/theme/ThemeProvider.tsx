import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Capacitor } from "@capacitor/core";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const THEME_STORAGE_KEY = "axon-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (
    storedTheme === "light" ||
    storedTheme === "dark" ||
    storedTheme === "system"
  ) {
    return storedTheme;
  }

  return "dark";
}

function applyThemeToDocument(resolvedTheme: ResolvedTheme) {
  const root = document.documentElement;

  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme);

  root.dataset.theme = resolvedTheme;

  syncNativeStatusBar(resolvedTheme);
}

/**
 * No app, a barra de status é do sistema e não muda sozinha com o tema — no
 * escuro, ícones pretos sobre fundo escuro ficam ilegíveis.
 *
 * `Style.Dark` significa "conteúdo claro para fundo escuro" (a nomenclatura do
 * plugin é pelo fundo, não pelos ícones), por isso a aparente inversão.
 * Import dinâmico para não carregar o plugin na web.
 */
function syncNativeStatusBar(resolvedTheme: ResolvedTheme) {
  if (!Capacitor.isNativePlatform()) return;

  void import("@capacitor/status-bar")
    .then(({ StatusBar, Style }) =>
      StatusBar.setStyle({ style: resolvedTheme === "dark" ? Style.Dark : Style.Light })
    )
    .catch(() => {
      // APK sem o plugin (build antigo): manter o tema funcionando é o que importa.
    });
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    getSystemTheme()
  );

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? systemTheme : theme;

  function setTheme(nextTheme: Theme) {
    setThemeState(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }

  function toggleTheme() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function handleSystemThemeChange() {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    }

    handleSystemThemeChange();

    mediaQuery.addEventListener("change", handleSystemThemeChange);

    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    };
  }, []);

  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
    }),
    [theme, resolvedTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme precisa ser usado dentro de ThemeProvider.");
  }

  return context;
}