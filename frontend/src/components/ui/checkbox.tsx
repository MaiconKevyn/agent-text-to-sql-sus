import { Check } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  description?: string;
  className?: string;
  /** Permite esconder só a descrição em telas estreitas. */
  descriptionClassName?: string;
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  className,
  descriptionClassName,
}: CheckboxProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "group inline-flex cursor-pointer select-none items-center gap-2",
        "rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-raised",
        className,
      )}
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded border border-line-strong bg-surface transition-colors duration-150 ease-out checked:border-accent checked:bg-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        />
        <Check
          aria-hidden
          className="pointer-events-none relative h-3 w-3 scale-75 text-accent-ink opacity-0 transition-[opacity,transform] duration-150 ease-out peer-checked:scale-100 peer-checked:opacity-100"
          strokeWidth={3}
        />
      </span>
      <span className="text-[13px] font-medium text-ink-muted transition-colors duration-150 group-hover:text-ink">
        {label}
        {description && (
          <span className={cn("ml-1.5 font-normal text-ink-subtle", descriptionClassName)}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
