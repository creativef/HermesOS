"use client";

import { useEffect, useState } from "react";
import { THEME_OPTIONS, type ThemeId, getTheme, setTheme } from "@/lib/theme";

export function ThemeSwitcher({ className }: { className?: string }) {
  const [theme, setThemeState] = useState<ThemeId>("light-1");

  useEffect(() => {
    const t = getTheme();
    setThemeState(t);
    document.documentElement.dataset.theme = t;
  }, []);

  return (
    <select
      className={
        className ??
        "h-8 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-2 text-xs text-[color:var(--app-text)]"
      }
      value={theme}
      onChange={(e) => {
        const next = e.target.value as ThemeId;
        setThemeState(next);
        setTheme(next);
      }}
      aria-label="Theme"
    >
      {THEME_OPTIONS.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

