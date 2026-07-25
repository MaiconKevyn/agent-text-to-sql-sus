import { useEffect, useState } from "react";
import { fetchSchema } from "@/lib/api";
import type { DatabaseSchema } from "@/lib/types";

type Estado =
  | { status: "carregando" }
  | { status: "pronto"; schema: DatabaseSchema }
  | { status: "erro"; message: string };

/**
 * Estrutura do banco, vinda de `GET /api/schema`.
 *
 * Busca uma vez e guarda em módulo: o conteúdo é estático enquanto o servidor
 * roda, e reabrir o painel não deve custar uma requisição.
 */
let cache: DatabaseSchema | null = null;

export function useSchema() {
  const [estado, setEstado] = useState<Estado>(
    cache ? { status: "pronto", schema: cache } : { status: "carregando" },
  );

  useEffect(() => {
    if (cache) return;
    const ctrl = new AbortController();
    fetchSchema(ctrl.signal)
      .then((s) => {
        cache = s;
        setEstado({ status: "pronto", schema: s });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setEstado({
          status: "erro",
          message: e instanceof Error ? e.message : "não foi possível carregar",
        });
      });
    return () => ctrl.abort();
  }, []);

  return estado;
}
