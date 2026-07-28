import { useCallback, useEffect, useRef, useState } from "react";

/** Quantos pedidos cabem esperando. Acima disso, a caixa recusa e diz por quê. */
export const MAX_FILA = 10;

/**
 * Quantos rodam ao mesmo tempo.
 *
 * Três, e não "todos": cada pedido custa uma ou duas chamadas de modelo e uma
 * varredura sobre 144 milhões de linhas, e o DuckDB serializa as consultas num
 * lock. Disparar dez de uma vez não os deixaria dez vezes mais rápidos — só
 * encheria a fila do servidor, e o primeiro pedido, que é o que a pessoa está
 * esperando, chegaria depois.
 */
export const MAX_SIMULTANEAS = 3;

export type EstadoTarefa = "na-fila" | "rodando" | "pronta" | "recusada" | "falhou";

export interface Tarefa {
  id: string;
  pedido: string;
  estado: EstadoTarefa;
  /** Recusa ou erro, quando houver. É o que a pessoa precisa LER. */
  mensagem: string;
  /** O que o pedido virou, quando deu certo. */
  tipo?: "widget" | "filtro";
}

/** O que a fila faz com um pedido. Devolve o resultado ou lança. */
export type Executor = (pedido: string) => Promise<{ tipo: "widget" | "filtro"; recusa: string }>;

let seq = 0;

/**
 * A fila de pedidos do painel.
 *
 * Existe porque montar um widget leva de dez a quarenta segundos, e a versão
 * anterior travava a caixa nesse tempo. Quem sabe o que quer — "óbitos por ano",
 * "internações por UF", "filtro por sexo" — tinha de digitar, esperar, digitar,
 * esperar. Agora despeja os três e olha a fila.
 *
 * A tarefa que DEU CERTO some sozinha depois de alguns segundos: o widget
 * apareceu na tela, e o cartão só repetiria o que já se vê. A que foi RECUSADA
 * fica até alguém fechar — ela carrega o motivo, e é a única coisa naquele
 * cartão que não está visível em nenhum outro lugar.
 */
export function useFilaDePedidos(executar: Executor, aoConcluir: () => void) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  // Espelho síncrono da lista. A checagem do limite NÃO pode viver dentro do
  // updater do setState: ele roda depois, e `enfileirar` já teria devolvido
  // string vazia — a recusa nunca chegaria a quem chamou, e o 11º pedido
  // entraria como se houvesse vaga. Foi exatamente o que aconteceu.
  const agora = useRef<Tarefa[]>([]);
  useEffect(() => {
    agora.current = tarefas;
  }, [tarefas]);
  // Ids já disparados. Sem isto, o StrictMode monta o efeito duas vezes e o
  // mesmo pedido vira dois widgets iguais.
  const disparadas = useRef(new Set<string>());
  const executarRef = useRef(executar);
  const concluirRef = useRef(aoConcluir);
  useEffect(() => {
    executarRef.current = executar;
    concluirRef.current = aoConcluir;
  });

  const atualiza = useCallback((id: string, mudanca: Partial<Tarefa>) => {
    setTarefas((ts) => ts.map((t) => (t.id === id ? { ...t, ...mudanca } : t)));
  }, []);

  /** Enfileira. Devolve o motivo da recusa, ou string vazia se entrou. */
  const enfileirar = useCallback((pedido: string): string => {
    const texto = pedido.trim();
    if (texto.length < 3) return "Pedido muito curto.";

    const esperando = agora.current.filter(
      (t) => t.estado === "na-fila" || t.estado === "rodando",
    ).length;
    if (esperando >= MAX_FILA) {
      return `A fila está cheia (${MAX_FILA} pedidos). Espere alguma terminar.`;
    }

    const nova: Tarefa = { id: `tar_${++seq}`, pedido: texto, estado: "na-fila", mensagem: "" };
    // O espelho é atualizado ANTES do setState, para dois envios no mesmo tique
    // se enxergarem: sem isso, dez cliques rápidos passariam todos pela
    // checagem lendo a mesma lista vazia.
    agora.current = [...agora.current, nova];
    setTarefas(agora.current);
    return "";
  }, []);

  const dispensar = useCallback((id: string) => {
    setTarefas((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const limparConcluidas = useCallback(() => {
    setTarefas((ts) => ts.filter((t) => t.estado === "na-fila" || t.estado === "rodando"));
  }, []);

  // O motor: enquanto houver vaga e alguém na fila, começa o próximo.
  useEffect(() => {
    const rodando = tarefas.filter((t) => t.estado === "rodando").length;
    const proxima = tarefas.find((t) => t.estado === "na-fila" && !disparadas.current.has(t.id));
    if (rodando >= MAX_SIMULTANEAS || !proxima) return;

    disparadas.current.add(proxima.id);
    atualiza(proxima.id, { estado: "rodando" });

    executarRef
      .current(proxima.pedido)
      .then((r) => {
        if (r.recusa) {
          atualiza(proxima.id, { estado: "recusada", mensagem: r.recusa, tipo: r.tipo });
          return;
        }
        atualiza(proxima.id, { estado: "pronta", tipo: r.tipo });
        concluirRef.current();
        // Some sozinha: o resultado já está na tela, e o cartão só repetiria.
        setTimeout(() => dispensar(proxima.id), 4000);
      })
      .catch((e) => {
        atualiza(proxima.id, { estado: "falhou", mensagem: String(e).slice(0, 300) });
      });
  }, [tarefas, atualiza, dispensar]);

  const emCurso = tarefas.filter((t) => t.estado === "na-fila" || t.estado === "rodando").length;
  return { tarefas, enfileirar, dispensar, limparConcluidas, emCurso };
}
