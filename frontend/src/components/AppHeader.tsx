import { Bookmark, Activity, Moon, PanelRight, Sun, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Theme } from "@/hooks/useTheme";

interface AppHeaderProps {
  theme: Theme;
  onToggleTheme: () => void;
  debug: boolean;
  onDebugChange: (v: boolean) => void;
  schemaOpen: boolean;
  onToggleSchema: () => void;
  hasMessages: boolean;
  onClear: () => void;
}

export function AppHeader({
  theme,
  onToggleTheme,
  debug,
  onDebugChange,
  schemaOpen,
  onToggleSchema,
  hasMessages,
  onClear,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-3 sm:px-5">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent"
        >
          <Activity className="h-4 w-4 text-accent-ink" strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-semibold leading-tight tracking-tight text-ink">
            Consulta SIH/SUS
          </h1>
          <p className="hidden truncate text-[11px] leading-tight text-ink-subtle sm:block">
            Internações hospitalares · DATASUS · 2007–2023
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {/* Um único controle: duplicar o checkbox para variar a descrição
              criaria dois alvos com o mesmo rótulo no DOM. A descrição some
              por CSS em telas estreitas. */}
          <Checkbox
            checked={debug}
            onCheckedChange={onDebugChange}
            label="Debug"
            description="mostra o trace"
            descriptionClassName="hidden sm:inline"
          />

          {hasMessages && (
            <Button
              size="icon"
              onClick={onClear}
              aria-label="Limpar conversa"
              title="Limpar conversa"
            >
              <Trash2 aria-hidden className="h-4 w-4" />
            </Button>
          )}

          <Button
            size="icon"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
          >
            {theme === "dark" ? (
              <Sun aria-hidden className="h-4 w-4" />
            ) : (
              <Moon aria-hidden className="h-4 w-4" />
            )}
          </Button>

          <Button
            size="icon"
            onClick={onToggleSchema}
            aria-label={schemaOpen ? "Ocultar estrutura do banco" : "Ver estrutura do banco"}
            aria-pressed={schemaOpen}
            title="Estrutura do banco"
            className={schemaOpen ? "text-accent" : undefined}
          >
            <PanelRight aria-hidden className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}<a
            href="?temas"
            title="Investigações salvas"
            aria-label="Investigações salvas"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
          >
            <Bookmark aria-hidden className="h-4 w-4" />
          </a>
          
