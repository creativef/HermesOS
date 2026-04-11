import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-[color:var(--surface)] p-5 shadow-[var(--ring)_0_0_0_1px]",
        className
      )}
      {...props}
    />
  );
}
