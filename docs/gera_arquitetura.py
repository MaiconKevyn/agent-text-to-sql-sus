"""Gera o diagrama de arquitetura do README, nas versões clara e escura.

Um script em vez de dois SVGs escritos à mão: as duas versões diferem só na
paleta, e mantê-las em sincronia manualmente é como as duas divergem.

    python3 docs/gera_arquitetura.py

As cores de série vêm da paleta validada em frontend/src/lib/chartTheme.ts,
aprovada nos seis testes do guia de dataviz nos dois modos.
"""

from __future__ import annotations

import html
from pathlib import Path

L = 1120  # largura da tela
A = 812  # altura


class Tema:
    def __init__(self, **kw):
        self.__dict__.update(kw)


CLARO = Tema(
    fundo="#ffffff",
    superficie="#f7f9fb",
    linha="#dde3ea",
    tinta="#1b2430",
    tinta_media="#556274",
    tinta_fraca="#78849a",
    acento="#0f8ba3",
    acento_suave="#e4f2f6",
    alerta="#eda100",
    alerta_suave="#fdf3dd",
    positivo="#1baf7a",
    positivo_suave="#e2f5ee",
    dado="#eb6834",
    dado_suave="#fdece5",
)

ESCURO = Tema(
    fundo="#0d131b",
    superficie="#141a24",
    linha="#293546",
    tinta="#f0f3f7",
    tinta_media="#a4b0c0",
    tinta_fraca="#7d8a9c",
    acento="#1f9fb8",
    acento_suave="#10303a",
    alerta="#c98500",
    alerta_suave="#2e2510",
    positivo="#199e70",
    positivo_suave="#0f2c23",
    dado="#d95926",
    dado_suave="#33190f",
)

FONTE = (
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,"
    "'Helvetica Neue',Arial,sans-serif"
)
MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace"


def esc(t: str) -> str:
    return html.escape(t, quote=False)


def texto(x, y, s, *, cor, tam=13, peso=400, ancora="start", fonte=FONTE, op=1.0):
    return (
        f'<text x="{x}" y="{y}" font-family="{fonte}" font-size="{tam}" '
        f'font-weight="{peso}" fill="{cor}" text-anchor="{ancora}" '
        f'opacity="{op}">{esc(s)}</text>'
    )


def caixa(x, y, w, h, *, preenche, borda, raio=10, largura=1):
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{raio}" '
        f'fill="{preenche}" stroke="{borda}" stroke-width="{largura}"/>'
    )


def seta(x1, y1, x2, y2, *, cor, marcador="fim", tracejado=False, largura=1.6):
    d = ' stroke-dasharray="5 4"' if tracejado else ""
    return (
        f'<path d="M{x1},{y1} L{x2},{y2}" stroke="{cor}" stroke-width="{largura}" '
        f'fill="none"{d} marker-end="url(#{marcador})"/>'
    )


def rotulo_aresta(x, y, s, *, t: Tema, ancora="middle"):
    """Rótulo com uma tarja do fundo atrás, para não brigar com a linha."""
    largura = len(s) * 6.0 + 12
    dx = {"middle": -largura / 2, "start": -6, "end": -largura + 6}[ancora]
    return (
        f'<rect x="{x + dx}" y="{y - 10}" width="{largura}" height="15" rx="3" '
        f'fill="{t.fundo}"/>'
        + texto(x, y + 1, s, cor=t.tinta_fraca, tam=10.5, ancora=ancora)
    )


def camada(x, y, w, h, titulo, subtitulo, *, t: Tema, cor, fundo, itens):
    """Uma faixa horizontal: título à esquerda, blocos de conteúdo à direita."""
    p = [caixa(x, y, w, h, preenche=fundo, borda=cor, raio=12)]
    p.append(f'<rect x="{x}" y="{y}" width="4" height="{h}" rx="2" fill="{cor}"/>')
    p.append(texto(x + 18, y + 25, titulo, cor=cor, tam=12, peso=700))
    p.append(texto(x + 18, y + 42, subtitulo, cor=t.tinta_fraca, tam=10.5))

    bx = x + 148
    disponivel = w - 148 - 18
    largura_item = (disponivel - 10 * (len(itens) - 1)) / len(itens)
    for i, (nome, detalhe) in enumerate(itens):
        ix = bx + i * (largura_item + 10)
        p.append(
            caixa(ix, y + 14, largura_item, h - 28, preenche=t.superficie, borda=t.linha, raio=8)
        )
        p.append(
            texto(ix + largura_item / 2, y + 36, nome, cor=t.tinta, tam=11.5, peso=600, ancora="middle")
        )
        if detalhe:
            p.append(
                texto(
                    ix + largura_item / 2, y + 52, detalhe, cor=t.tinta_fraca,
                    tam=10, ancora="middle", fonte=MONO,
                )
            )
    return "\n".join(p)


def desenha(t: Tema) -> str:
    p: list[str] = []
    p.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {L} {A}" '
        f'width="{L}" height="{A}" role="img" '
        f'aria-label="Arquitetura do agente text-to-SQL do SIH/SUS">'
    )
    p.append(
        f'<defs>'
        f'<marker id="fim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
        f'markerHeight="6" orient="auto-start-reverse">'
        f'<path d="M0,1 L9,5 L0,9 z" fill="{t.tinta_media}"/></marker>'
        f'<marker id="fim-acento" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
        f'markerHeight="6" orient="auto-start-reverse">'
        f'<path d="M0,1 L9,5 L0,9 z" fill="{t.acento}"/></marker>'
        f'<marker id="fim-alerta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
        f'markerHeight="6" orient="auto-start-reverse">'
        f'<path d="M0,1 L9,5 L0,9 z" fill="{t.alerta}"/></marker>'
        f'</defs>'
    )
    p.append(f'<rect width="{L}" height="{A}" fill="{t.fundo}"/>')

    p.append(texto(40, 42, "Arquitetura", cor=t.tinta, tam=20, peso=700))
    p.append(
        texto(
            40, 62,
            "Pergunta em português → SQL → DuckDB → resposta, gráfico e ressalvas",
            cor=t.tinta_media, tam=12,
        )
    )

    # ---- 1. Interface ----------------------------------------------------
    p.append(
        camada(
            40, 88, L - 80, 74, "INTERFACE", "React · TypeScript",
            t=t, cor=t.acento, fundo=t.acento_suave,
            itens=[
                ("Chat", "streaming"),
                ("Gráfico", "ECharts"),
                ("Relatório", "investigação"),
                ("Schema", "20 regras"),
                ("Debug", "trace"),
            ],
        )
    )

    p.append(seta(L / 2, 162, L / 2, 196, cor=t.acento, marcador="fim-acento"))
    p.append(rotulo_aresta(L / 2 + 96, 183, "Server-Sent Events", t=t))

    # ---- 2. API ----------------------------------------------------------
    p.append(
        camada(
            40, 198, L - 80, 74, "API", "FastAPI",
            t=t, cor=t.acento, fundo=t.acento_suave,
            itens=[
                ("/api/ask", "1 consulta"),
                ("/api/investigate", "N consultas"),
                ("/api/schema", "dicionário"),
            ],
        )
    )

    # ---- 3. Os dois modos ------------------------------------------------
    ly, lh = 308, 268
    VAO = 56  # entre as duas colunas: a seta de reuso mora aqui
    CALHA = 58  # dentro do AGENTE, à direita: o laço de reparo mora aqui
    lw = (L - 80 - VAO) / 2

    # -- agente (esquerda)
    ax = 40
    p.append(caixa(ax, ly, lw, lh, preenche=t.superficie, borda=t.linha, raio=12))
    p.append(f'<rect x="{ax}" y="{ly}" width="4" height="{lh}" rx="2" fill="{t.tinta_media}"/>')
    p.append(texto(ax + 18, ly + 26, "AGENTE", cor=t.tinta, tam=12, peso=700))
    p.append(texto(ax + 78, ly + 26, "uma hipótese analítica", cor=t.tinta_fraca, tam=10.5))

    passos = [
        ("1", "Value linking", "casa termos com códigos reais das dimensões"),
        ("2", "Geração de SQL", "saída estruturada: SQL + suposições + gráfico"),
        ("3", "Validação estática", "só SELECT · um statement · LIMIT · EXPLAIN"),
        ("4", "Execução", "DuckDB read-only, com timeout"),
        ("5", "Síntese", "texto com as ressalvas obrigatórias"),
    ]
    for i, (num, nome, det) in enumerate(passos):
        py = ly + 46 + i * 43
        p.append(caixa(ax + 18, py, lw - 36 - CALHA, 36, preenche=t.fundo, borda=t.linha, raio=7))
        p.append(f'<circle cx="{ax + 36}" cy="{py + 18}" r="10" fill="{t.acento}"/>')
        p.append(texto(ax + 36, py + 22, num, cor="#ffffff", tam=11, peso=700, ancora="middle"))
        p.append(texto(ax + 54, py + 15, nome, cor=t.tinta, tam=11.5, peso=600))
        p.append(texto(ax + 54, py + 29, det, cor=t.tinta_fraca, tam=9.5))

    # O laço de reparo vive na calha, com o rótulo na vertical: qualquer texto
    # horizontal aqui ou estoura a coluna ou cobre o passo ao lado.
    py4 = ly + 46 + 3 * 43       # topo do passo 4 (Execução)
    py3 = ly + 46 + 2 * 43       # topo do passo 3 (Validação)
    xl = ax + lw - CALHA - 12    # borda direita dos passos
    xc = ax + lw - 30            # eixo da curva, dentro da calha
    p.append(
        f'<path d="M{xl},{py4 + 18} L{xc},{py4 + 18} '
        f'C{xc + 12},{py4 + 18} {xc + 12},{py3 + 18} {xc},{py3 + 18} L{xl + 2},{py3 + 18}" '
        f'stroke="{t.alerta}" stroke-width="1.6" fill="none" stroke-dasharray="4 3" '
        f'marker-end="url(#fim-alerta)"/>'
    )
    p.append(
        f'<text x="{xc - 8}" y="{(py3 + py4) / 2 + 18}" font-family="{FONTE}" '
        f'font-size="9.5" fill="{t.alerta}" text-anchor="middle" '
        f'transform="rotate(-90 {xc - 8} {(py3 + py4) / 2 + 18})">'
        f'erro → auto-reparo 2×</text>'
    )

    # -- investigação (direita)
    ix = 40 + lw + VAO
    p.append(caixa(ix, ly, lw, lh, preenche=t.superficie, borda=t.linha, raio=12))
    p.append(f'<rect x="{ix}" y="{ly}" width="4" height="{lh}" rx="2" fill="{t.alerta}"/>')
    p.append(texto(ix + 18, ly + 26, "INVESTIGAÇÃO", cor=t.tinta, tam=12, peso=700))
    p.append(texto(ix + 122, ly + 26, "várias hipóteses", cor=t.tinta_fraca, tam=10.5))

    fases = [
        ("Planejar", "quebra em 2-6 etapas autocontidas", False),
        ("Executar", "em paralelo — cada etapa reusa o AGENTE", False),
        ("Refletir", "4 perguntas objetivas; o CÓDIGO decide", True),
        ("Aprofundar", "1 consulta por defeito encontrado", False),
        ("Sintetizar", "resposta, evidências e limitações", False),
    ]
    for i, (nome, det, destaque) in enumerate(fases):
        py = ly + 46 + i * 43
        cor_b = t.alerta if destaque else t.linha
        fundo_b = t.alerta_suave if destaque else t.fundo
        p.append(caixa(ix + 18, py, lw - 36, 36, preenche=fundo_b, borda=cor_b, raio=7))
        p.append(texto(ix + 34, py + 15, nome, cor=t.tinta, tam=11.5, peso=600))
        p.append(texto(ix + 34, py + 29, det, cor=t.tinta_fraca, tam=9.5))

    # Seta de reuso: mora no vão entre as colunas, sem rótulo. O texto do passo
    # ("cada etapa reusa o AGENTE") já diz o que ela significa, e um rótulo aqui
    # cobria a palavra "Executar" — foi o que a primeira versão fez.
    py_exec = ly + 46 + 43
    p.append(
        f'<path d="M{ix + 6},{py_exec + 18} L{ax + lw + 6},{py_exec + 18}" '
        f'stroke="{t.acento}" stroke-width="1.6" fill="none" stroke-dasharray="5 4" '
        f'marker-end="url(#fim-acento)"/>'
    )

    # ---- 4. Fundações ----------------------------------------------------
    fy = 600
    fw = (L - 80 - 32) / 3
    fundacoes = [
        (
            t.dado, t.dado_suave, "knowledge/schema.yaml",
            "DICIONÁRIO CURADO",
            ["20 regras · 8 críticas", "domínios, armadilhas e", "colunas inutilizáveis"],
        ),
        (
            t.acento, t.acento_suave, "OpenAI · saída estruturada",
            "MODELO",
            ["JSON Schema para o plano", "streaming para a resposta", "o modelo declara, o código executa"],
        ),
        (
            t.positivo, t.positivo_suave, "DuckDB · read-only",
            "DADOS",
            ["144.386.772 internações", "15,4 GB · 2007-2023", "SIH-RD do DATASUS"],
        ),
    ]
    for i, (cor, fundo, sub, titulo, linhas) in enumerate(fundacoes):
        x = 40 + i * (fw + 16)
        p.append(caixa(x, fy, fw, 132, preenche=fundo, borda=cor, raio=12))
        p.append(texto(x + 18, fy + 26, titulo, cor=cor, tam=11.5, peso=700))
        p.append(texto(x + 18, fy + 43, sub, cor=t.tinta_media, tam=10, fonte=MONO))
        for j, linha in enumerate(linhas):
            p.append(texto(x + 18, fy + 68 + j * 17, linha, cor=t.tinta_media, tam=10.5))

    # Um barramento horizontal em vez de três setas independentes: as três
    # fundações servem aos DOIS modos, e setas separadas sugeriam que cada uma
    # pertence à coluna acima dela.
    yb = 584
    xe, xd = 40 + fw / 2, L - 40 - fw / 2   # centros da primeira e da última fundação
    # o barramento cobre toda a largura das fundações…
    p.append(
        f'<path d="M{xe},{yb} L{xd},{yb}" stroke="{t.linha}" stroke-width="1.6" fill="none"/>'
    )
    # …e desce de cada uma das duas colunas até ele
    for xc in (ax + lw / 2, ix + lw / 2):
        p.append(
            f'<path d="M{xc},{ly + lh} L{xc},{yb}" stroke="{t.linha}" '
            f'stroke-width="1.6" fill="none"/>'
        )
    for i, cor in enumerate((t.dado, t.tinta_media, t.positivo)):
        x = 40 + i * (fw + 16) + fw / 2
        p.append(f'<circle cx="{x}" cy="{yb}" r="3.5" fill="{cor}"/>')
        p.append(seta(x, yb, x, fy - 4, cor=cor, marcador="fim"))

    p.append(
        texto(
            L / 2, A - 18,
            "O dicionário entra no prompt · o SQL é validado antes de rodar · "
            "o gráfico é montado a partir das linhas que o banco devolveu",
            cor=t.tinta_fraca, tam=10, ancora="middle",
        )
    )

    p.append("</svg>")
    return "\n".join(p)


def main() -> None:
    destino = Path(__file__).resolve().parent / "img"
    destino.mkdir(parents=True, exist_ok=True)
    for nome, tema in (("arquitetura.svg", CLARO), ("arquitetura-dark.svg", ESCURO)):
        alvo = destino / nome
        alvo.write_text(desenha(tema), encoding="utf-8")
        print(f"→ docs/img/{nome}  ({alvo.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
