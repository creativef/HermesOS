"use client";

import { useEffect, useId, useRef, useState } from "react";

export function HelpTip({
  text,
  side = "top",
  className,
}: {
  text: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  function clearTimer() {
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  function show() {
    clearTimer();
    setOpen(true);
  }

  function hideSoon() {
    clearTimer();
    timeoutRef.current = window.setTimeout(() => setOpen(false), 180);
  }

  function toggle() {
    clearTimer();
    setOpen((v) => !v);
    // Auto-dismiss when opened via click.
    timeoutRef.current = window.setTimeout(() => setOpen(false), 4200);
  }

  useEffect(() => () => clearTimer(), []);

  const pos =
    side === "top"
      ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
      : side === "bottom"
        ? "top-full mt-2 left-1/2 -translate-x-1/2"
        : side === "right"
          ? "left-full ml-2 top-1/2 -translate-y-1/2"
          : "right-full mr-2 top-1/2 -translate-y-1/2";

  return (
    <span className={className ?? "relative inline-flex items-center"}>
      <button
        type="button"
        aria-label="Help"
        aria-describedby={open ? id : undefined}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--primary)] text-[11px] font-bold text-[color:var(--on-primary)] shadow-[var(--ring)_0_0_0_1px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(91,118,254,0.35)]"
        onClick={toggle}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>

      {open ? (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute z-50 ${pos} w-[260px] rounded-xl bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--app-text)] shadow-[var(--ring)_0_0_0_1px]`}
        >
          <span className="text-[color:var(--muted)]">{text}</span>
        </span>
      ) : null}
    </span>
  );
}

