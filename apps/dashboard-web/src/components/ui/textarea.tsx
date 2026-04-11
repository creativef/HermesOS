import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[120px] w-full rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--app-text)] placeholder:text-[color:var(--placeholder)] focus:outline-none focus:ring-2 focus:ring-[color:rgba(91,118,254,0.25)]",
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
