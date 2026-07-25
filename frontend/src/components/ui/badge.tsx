import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "caution" | "critical" | "positive";

const TONES: Record<Tone, string> = {
  neutral: "bg-raised text-ink-muted border-line",
  accent: "bg-accent-soft text-accent border-accent/25",
  caution: "bg-caution-soft text-caution border-caution/25",
  critical: "bg-critical-soft text-critical border-critical/25",
  positive: "bg-accent-soft text-positive border-positive/25",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: ReactNode;
}

export function Badge({ tone = "neutral", icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5",
        "text-[11px] font-medium leading-5 tracking-tight",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}
