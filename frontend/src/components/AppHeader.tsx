import { cn } from "@/lib/utils";
import { SeletorDePaleta } from "@/components/SeletorDePaleta";
import { PanelLeft, Activity, PanelRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface AppHeaderProps {
  debug: boolean;
  onDebugChange: (v: boolean) => void;
  schemaOpen: boolean;
  onToggleSchema: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  hasMessages: boolean;
  onClear: () => void;
}

export function AppHeader({
  debug,
  onDebugChange,
  schemaOpen,
  onToggleSchema,
  sidebarOpen,
  onToggleSidebar,
  hasMessages,
  onClear,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="flex h-14 items-center">
        {/* Uma coluna da largura do trilho, FORA do contêiner centralizado: é o
            que põe o botão exatamente sobre a barra que ele recolhe. No grupo
            da direita, junto com Debug e o painel do banco, ele ficava no canto
            oposto ao que comanda. */}
        <div className="hidden w-12 shrink-0 items-center justify-center lg:flex">
          <Button
            size="icon"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "Recolher a barra lateral" : "Mostrar a barra lateral"}
            aria-pressed={sidebarOpen}
            title="Conversas e investigações"
            className={cn(sidebarOpen && "text-accent")}
          >
            <PanelLeft aria-hidden className="h-4 w-4" />
          </Button>
        </div>

        <div className="mx-auto flex h-14 min-w-0 max-w-[1400px] flex-1 items-center gap-3 px-3 sm:px-5">
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

          <SeletorDePaleta compacto />

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
      </div>
    </header>
  );
}
