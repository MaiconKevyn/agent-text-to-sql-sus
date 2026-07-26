import { Globe, Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { pinBlock } from "@/lib/api";

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
