import { Globe, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { pinBlock, searchStatus, searchWeb } from "@/lib/api";
import type { SearchCandidate } from "@/lib/types";

interface Props {
  temaId: string;
  onAdicionou: () => void;
}

/**
 * Acrescenta uma fonte externa ao tema, colada à mão.
 *
 * O campo central é o TRECHO LITERAL, não um resumo. Um resumo não é
 * conferível: quem lê o relatório daqui a um mês não consegue distinguir o que
 * a fonte disse do que alguém entendeu que ela disse. Com o trecho e a URL, dá
 * para abrir e comparar.
 *
 * Esta é a mesma forma que a busca automática vai preencher — trocar a origem
 * do conteúdo não muda o bloco nem o relatório.
 */
export function AddSource({ temaId, onAdicionou }: Props) {
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [url, setUrl] = useState("");
  const [trecho, setTrecho] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Busca: traz CANDIDATOS, nunca fixa nada. Quem escolhe é o usuário, e o
  // escolhido preenche este mesmo formulário — mesmo padrão do painel de
  // definição e do plano de investigação.
  const [buscaAtiva, setBuscaAtiva] = useState(false);
  const [dominios, setDominios] = useState<string[]>([]);
  const [termoBusca, setTermoBusca] = useState("");
  const [candidatos, setCandidatos] = useState<SearchCandidate[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);

  useEffect(() => {
    void searchStatus()
      .then((s) => {
        setBuscaAtiva(s.available);
        setDominios(s.domains);
      })
      .catch(() => setBuscaAtiva(false));
  }, []);

  async function buscar() {
    const t = termoBusca.trim();
    if (t.length < 3 || buscando) return;
    setBuscando(true);
    setErroBusca(null);
    try {
      setCandidatos((await searchWeb(t)).candidates);
    } catch (e) {
      setErroBusca(String(e));
      setCandidatos(null);
    } finally {
      setBuscando(false);
    }
  }

  /** O candidato escolhido preenche o formulário; salvar continua sendo um ato. */
  function escolher(c: SearchCandidate) {
    setTitulo(c.title);
    setUrl(c.url);
    setTrecho(c.excerpt);
    setCandidatos(null);
  }

  const urlValida = !url.trim() || /^https?:\/\/.+\..+/i.test(url.trim());
  const podeSalvar = trecho.trim().length > 10 && urlValida && !salvando;

  async function salvar() {
    if (!podeSalvar) return;
    setSalvando(true);
    try {
      await pinBlock(temaId, {
        kind: "nota",
        // Sem URL o servidor rebaixa para "usuario": não é fonte externa
        // conferível, é anotação de quem investiga. Os dois são legítimos; o
        // que não pode é um passar pelo outro.
        provenance: url.trim() ? "web" : "usuario",
        title: titulo.trim() || trecho.trim().slice(0, 60),
        text: trecho.trim(),
        sourceUrl: url.trim(),
        sourceTitle: titulo.trim(),
      });
      setTitulo("");
      setUrl("");
      setTrecho("");
      setAberto(false);
      onAdicionou();
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-accent"
      >
        <Plus aria-hidden className="h-4 w-4" />
        Acrescentar uma fonte externa
      </button>
    );
  }

  return (
    <section className="rounded-xl border border-caution/25 bg-caution-soft px-4 py-3">
      <header className="mb-2.5 flex items-center gap-2">
        <Globe aria-hidden className="h-4 w-4 shrink-0 text-caution" />
        <h3 className="flex-1 text-[12.5px] font-semibold text-ink">Fonte externa</h3>
        <button
          onClick={() => setAberto(false)}
          aria-label="Cancelar"
          className="rounded p-0.5 text-ink-subtle hover:text-ink"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </header>

      {buscaAtiva && (
        <div className="mb-3 space-y-2 border-b border-caution/20 pb-3">
          <div className="flex gap-2">
            <input
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void buscar()}
              placeholder="Procurar em fontes confiáveis…"
              aria-label="Termo de busca"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:border-accent"
            />
            <button
              onClick={() => void buscar()}
              disabled={termoBusca.trim().length < 3 || buscando}
              aria-label="Buscar"
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-white transition-opacity duration-150 disabled:opacity-40"
            >
              {buscando ? (
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search aria-hidden className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* Os domínios ficam à vista: quem lê o relatório depois precisa
              saber onde se buscou, e quem busca precisa saber onde NÃO se
              buscou. */}
          <p className="text-[10.5px] leading-snug text-ink-muted">
            Busca restrita a {dominios.length} domínios: {dominios.slice(0, 4).join(", ")}
            {dominios.length > 4 && ` e mais ${dominios.length - 4}`}
          </p>

          {erroBusca && <p className="text-[11px] text-critical">{erroBusca}</p>}

          {candidatos?.length === 0 && (
            <p className="text-[11.5px] text-ink-muted">
              Nada encontrado nesses domínios. Você ainda pode colar a fonte à mão abaixo.
            </p>
          )}

          {candidatos && candidatos.length > 0 && (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {candidatos.map((c) => (
                <li key={c.url}>
                  <button
                    onClick={() => escolher(c)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors duration-150 hover:border-accent/40"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                        {c.title}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-ink-subtle">{c.domain}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-ink-muted">
                      {c.excerpt}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-2">
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Título — ex.: Nota técnica SIH/SUS sobre CID_MORTE"
          aria-label="Título da fonte"
          className="block w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:border-accent"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… (sem URL, vira anotação sua)"
          aria-label="Endereço da fonte"
          className={
            "block w-full rounded-lg border bg-surface px-3 py-1.5 text-[12.5px] text-ink outline-none " +
            "transition-colors duration-150 placeholder:text-ink-subtle focus:border-accent " +
            (urlValida ? "border-line" : "border-critical")
          }
        />
        {!urlValida && (
          <p className="text-[11px] text-critical">
            Endereço inválido. Precisa começar com http:// ou https://
          </p>
        )}
        <textarea
          value={trecho}
          onChange={(e) => setTrecho(e.target.value)}
          rows={4}
          placeholder="Cole o TRECHO LITERAL da fonte — não um resumo."
          aria-label="Trecho literal citado"
          className="block w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-ink outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:border-accent"
        />
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Trecho literal, não resumo: é o que permite conferir depois. Nenhum número
          desta fonte entra em gráfico ou tabela do tema — ela é citação, com origem ao lado.
        </p>
        <button
          onClick={() => void salvar()}
          disabled={!podeSalvar}
          className="w-full rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white transition-opacity duration-150 disabled:opacity-40"
        >
          {salvando ? (
            <Loader2 aria-hidden className="mx-auto h-4 w-4 animate-spin" />
          ) : (
            "Acrescentar ao tema"
          )}
        </button>
      </div>
    </section>
  );
}
