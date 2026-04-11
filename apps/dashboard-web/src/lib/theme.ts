const THEME_KEY = "DASHBOARD_THEME";

export type ThemeId = "light-1" | "light-2" | "light-3" | "dark-1" | "dark-2" | "dark-3";

export const THEME_OPTIONS: Array<{ id: ThemeId; label: string }> = [
  { id: "light-1", label: "Light 1 · Blue" },
  { id: "light-2", label: "Light 2 · Teal" },
  { id: "light-3", label: "Light 3 · Coral" },
  { id: "dark-1", label: "Dark 1 · Blue" },
  { id: "dark-2", label: "Dark 2 · Teal" },
  { id: "dark-3", label: "Dark 3 · Rose" },
];

export function getTheme(): ThemeId {
  if (typeof window === "undefined") return "light-1";
  const v = window.localStorage.getItem(THEME_KEY) as ThemeId | null;
  const ok = THEME_OPTIONS.some((o) => o.id === v);
  return ok && v ? v : "light-1";
}

export function setTheme(theme: ThemeId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_KEY, theme);
  document.documentElement.dataset.theme = theme;
}
