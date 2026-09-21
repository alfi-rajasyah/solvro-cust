import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  /** What the user picked. May be "system". */
  choice: ThemeChoice;
  /** What's actually applied right now after resolving "system". */
  resolved: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
  toggle: () => void;
}

const STORAGE_KEY = "solvro.theme";
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyClass(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    readStoredChoice() === "system"
      ? systemPrefersDark()
        ? "dark"
        : "light"
      : (readStoredChoice() as ResolvedTheme),
  );

  // Apply class whenever resolved theme changes.
  useEffect(() => {
    applyClass(resolved);
  }, [resolved]);

  // Recompute resolved when choice changes.
  useEffect(() => {
    if (choice === "system") {
      setResolved(systemPrefersDark() ? "dark" : "light");
    } else {
      setResolved(choice);
    }
  }, [choice]);

  // Listen for system preference changes when in "system" mode.
  useEffect(() => {
    if (choice !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      setResolved(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggle = useCallback(() => {
    setChoice(resolved === "dark" ? "light" : "dark");
  }, [resolved, setChoice]);

  const value = useMemo(
    () => ({ choice, resolved, setChoice, toggle }),
    [choice, resolved, setChoice, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
