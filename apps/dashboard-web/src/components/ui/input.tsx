import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 py-1 text-sm text-[color:var(--app-text)] placeholder:text-[color:var(--placeholder)] focus:outline-none focus:ring-2 focus:ring-[color:rgba(91,118,254,0.25)]",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";
