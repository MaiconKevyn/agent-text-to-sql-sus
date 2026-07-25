import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CollapsibleProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Abre e fecha animando até a altura do conteúdo, em CSS puro.
 *
 * O truque é a grade de uma linha indo de `0fr` a `1fr`: dá a transição suave
 * que `height: auto` não permite, sem medir nada em JavaScript. Escolha
 * deliberada — animar altura com JS deixa o conteúdo preso em `height: 0` se o
 * quadro de animação não rodar (aba em segundo plano, `rAF` suspenso), e aqui
 * o que está dentro é a resposta da consulta.
 */
export function Collapsible({ open, children, className }: CollapsibleProps) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-200 ease-out",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        className,
      )}
      aria-hidden={!open}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
