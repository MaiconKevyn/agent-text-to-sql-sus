import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, type ButtonProps } from "./button";
import { cn } from "@/lib/utils";

interface CopyButtonProps extends Omit<ButtonProps, "children" | "onClick"> {
  value: string;
  label?: string;
  /** Mostra o rótulo ao lado do ícone. */
  showLabel?: boolean;
}

export function CopyButton({
  value,
  label = "Copiar",
  showLabel = false,
  className,
  size = "icon-sm",
  ...props
}: CopyButtonProps) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1600);
    return () => clearTimeout(t);
  }, [copiado]);

  return (
    <Button
      size={showLabel ? "sm" : size}
      className={cn(className)}
      aria-label={copiado ? "Copiado" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopiado(true);
        } catch {
          /* clipboard bloqueado: silencioso, o usuário pode selecionar à mão */
        }
      }}
      {...props}
    >
      {copiado ? (
        <Check className="h-3.5 w-3.5 text-positive" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {showLabel && <span>{copiado ? "Copiado" : label}</span>}
    </Button>
  );
}
