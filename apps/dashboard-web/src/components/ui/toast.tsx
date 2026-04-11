"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type ToastInput = {
  title: string;
  description?: string;
  durationMs?: number;
};

type Toast = {
  id: string;
  title: string;
  description?: string;
};

type ToastContextValue = {
  toast: (t: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function makeId() {
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const remove = useCallback((id: string) => {
    setItems((cur) => cur.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (t: ToastInput) => {
      const id = makeId();
      const next: Toast = { id, title: String(t.title || "").trim() || "Notice", description: t.description };
      setItems((cur) => [...cur, next].slice(-4));

      const ms = Number.isFinite(Number(t.durationMs)) ? Number(t.durationMs) : 2600;
      const timeoutId = window.setTimeout(() => remove(id), Math.max(800, ms));
      timers.current.set(id, timeoutId);
    },
    [remove]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 shadow-[0_10px_28px_rgba(0,0,0,0.10)]"
            role="status"
            aria-live="polite"
          >
            <div className="text-sm font-medium text-[color:var(--app-text)]">{t.title}</div>
            {t.description ? <div className="mt-1 text-xs text-[color:var(--muted)]">{t.description}</div> : null}
            <div className="mt-2">
              <button
                className="text-xs text-[color:var(--muted)] hover:text-[color:var(--app-text)]"
                onClick={() => remove(t.id)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

