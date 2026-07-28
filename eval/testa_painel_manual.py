"""Exercita o catálogo inteiro contra o banco de verdade.

O menu manual não tem modelo no caminho, então não há nenhuma etapa em que
alguém leia o SQL antes de ele rodar. A prova de que ele está certo tem de vir
daqui: TODO campo, com TODO tipo de controle que ele oferece, e uma amostra
larga de gráficos — cada um montado, validado e executado sobre as 144 milhões
de linhas.

    python eval/testa_painel_manual.py           # rápido: filtros + amostra
    python eval/testa_painel_manual.py --tudo    # todo campo × toda medida

Um campo que passa aqui não pode produzir gráfico quebrado na tela, porque é
literalmente o mesmo caminho de código.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.db import Database  # noqa: E402
from src.paineis import catalogo as cat  # noqa: E402
from src.paineis import montar  # noqa: E402
from src.paineis.filtros import TOKEN, aplicar  # noqa: E402

TUDO = "--tudo" in sys.argv

VERDE, VERMELHO, CINZA, FIM = "\033[32m", "\033[31m", "\033[90m", "\033[0m"


def main() -> int:
    db = Database()
    falhas: list[str] = []
    inicio = time.time()

    print(f"\n{CINZA}FILTROS — todo campo, todo controle que ele oferece{FIM}")
    filtros_ok = []
    for c in cat.CAMPOS:
        for tipo in c.filtros:
            t = time.time()
            r = montar.filtro(c.id, tipo, db)
            dt = time.time() - t
            if r.recusa or r.filtro is None:
                falhas.append(f"filtro {c.id}/{tipo}: {r.recusa}")
                print(f"  {VERMELHO}✗{FIM} {c.id:<18} {tipo:<9} {r.recusa[:80]}")
                continue
            f = r.filtro
            filtros_ok.append(f)
            detalhe = (
                f"{f.minimo}–{f.maximo}"
                if tipo == cat.FAIXA
                else f"{len(f.opcoes)} opções · {f.opcoes[0].rotulo[:22]}"
            )
            print(f"  {VERDE}✓{FIM} {c.id:<18} {tipo:<9} {detalhe:<40} {dt:5.1f}s")

    # Um filtro que não recorta nada é um filtro que mente. Cada um tem de
    # mudar a contagem quando alguém seleciona parte do domínio.
    print(f"\n{CINZA}RECORTE — o filtro muda mesmo a contagem?{FIM}")
    total = db.run("SELECT COUNT(*) FROM internacoes i WHERE 1=1").rows[0][0]
    for f in filtros_ok:
        if f.tipo == cat.FAIXA:
            meio = (f.minimo or 0) + ((f.maximo or 0) - (f.minimo or 0)) // 2
            f.selecao = [f.minimo, meio]
        else:
            f.selecao = [f.opcoes[0].valor]
        sql, params = aplicar(f"SELECT COUNT(*) FROM internacoes i WHERE 1=1 {TOKEN}", [f])
        n = db.run(sql, params=params).rows[0][0]
        if not f.ativo:
            falhas.append(f"{f.rotulo}: seleção parcial não deixou o filtro ativo")
            print(f"  {VERMELHO}✗{FIM} {f.rotulo:<28} seleção parcial não ativou o filtro")
        elif n >= total or n == 0:
            falhas.append(f"{f.rotulo}: recorte devolveu {n} de {total}")
            print(f"  {VERMELHO}✗{FIM} {f.rotulo:<28} {n:>15,} de {total:,}")
        else:
            print(f"  {VERDE}✓{FIM} {f.rotulo:<28} {n:>15,} de {total:,} ({100*n/total:5.2f}%)")

    print(f"\n{CINZA}GRÁFICOS{FIM}")
    combos = _combinacoes()
    for p in combos:
        t = time.time()
        r = montar.widget(p, db)
        dt = time.time() - t
        nome = f"{p.medida} × {p.campo or '—'}" + (f" / {p.serie}" if p.serie else "")
        if r.recusa or r.widget is None:
            falhas.append(f"widget {nome}: {r.recusa}")
            print(f"  {VERMELHO}✗{FIM} {nome:<44} {r.recusa[:70]}")
            continue
        w = r.widget
        # O gráfico aponta para colunas que o SELECT devolve? Um `x` que não
        # existe no resultado faz o gráfico sumir sem erro nenhum.
        cols = db.run(w.sql.replace(TOKEN, ""), max_rows=1).columns
        if w.chart and (w.chart["x"] not in cols or w.chart["y"] not in cols):
            falhas.append(f"widget {nome}: chart aponta para coluna inexistente {w.chart}")
            print(f"  {VERMELHO}✗{FIM} {nome:<44} chart fora do SELECT: {cols}")
            continue
        print(f"  {VERDE}✓{FIM} {nome:<44} {w.formato:<10} {dt:5.1f}s")

    # O filtro tem de valer para o widget manual também — é o token que garante.
    print(f"\n{CINZA}TOKEN — o widget manual responde a filtro?{FIM}")
    p = montar.Pedido(medida="internacoes", campo="uf", limite=5)
    w = montar.widget(p, db).widget
    assert w is not None
    f = montar.filtro("sexo", cat.MULTIPLA, db).filtro
    assert f is not None
    f.selecao = [f.opcoes[0].valor]
    sem = db.run(w.sql.replace(TOKEN, "")).rows[0][1]
    sql, params = aplicar(w.sql, [f])
    com = db.run(sql, params=params).rows[0][1]
    if com >= sem:
        falhas.append(f"o filtro não recortou o widget manual: {com} >= {sem}")
        print(f"  {VERMELHO}✗{FIM} sem filtro {sem:,} · com filtro {com:,}")
    else:
        print(f"  {VERDE}✓{FIM} sem filtro {sem:,} · com filtro de sexo {com:,}")

    print()
    if falhas:
        print(f"{VERMELHO}{len(falhas)} falha(s){FIM}")
        for f_ in falhas:
            print(f"  · {f_}")
        return 1
    print(f"{VERDE}tudo passou{FIM} · {time.time() - inicio:.0f}s")
    return 0


def _combinacoes() -> list[montar.Pedido]:
    """Os gráficos a testar. Com --tudo, o produto cartesiano."""
    if TUDO:
        agrupaveis = [c for c in cat.CAMPOS]
        return [
            montar.Pedido(medida=m.id, campo=c.id, limite=8)
            for m in cat.MEDIDAS
            for c in agrupaveis
        ] + [montar.Pedido(medida=m.id) for m in cat.MEDIDAS]

    p = montar.Pedido
    return [
        # Indicadores: uma medida, nenhum eixo.
        p(medida="internacoes"),
        p(medida="obitos"),
        p(medida="taxa_obito"),
        p(medida="valor_total"),
        # Um de cada grupo do catálogo, com formas diferentes.
        p(medida="internacoes", campo="ano", forma="linha"),
        p(medida="obitos", campo="ano_mes", forma="linha", limite=60),
        p(medida="internacoes", campo="mes", forma="barra"),
        p(medida="taxa_obito", campo="uf", forma="barra_horizontal"),
        p(medida="internacoes", campo="regiao", forma="pizza"),
        p(medida="internacoes", campo="municipio", forma="barra_horizontal", limite=10),
        p(medida="obitos", campo="faixa_etaria", forma="barra"),
        p(medida="internacoes", campo="sexo", forma="pizza"),
        p(medida="internacoes", campo="raca_cor", forma="barra_horizontal"),
        p(medida="taxa_obito", campo="cid_capitulo", forma="barra_horizontal"),
        p(medida="internacoes", campo="diag_categoria", forma="barra_horizontal", limite=10),
        p(medida="dias_medios", campo="procedimento", forma="barra_horizontal", limite=10),
        p(medida="internacoes", campo="especialidade", forma="barra"),
        p(medida="taxa_uti", campo="uti", forma="barra"),
        p(medida="internacoes", campo="tipo_uti", forma="barra_horizontal"),
        p(medida="internacoes", campo="car_int", forma="pizza"),
        p(medida="valor_medio", campo="complexidade", forma="barra"),
        p(medida="internacoes", campo="morte", forma="pizza"),
        p(medida="idade_media", campo="uf", forma="barra_horizontal"),
        # Com série: empilhada e mapa de calor.
        p(medida="internacoes", campo="ano", serie="sexo", forma="empilhada_100"),
        p(medida="taxa_obito", campo="faixa_etaria", serie="sexo", forma="barra"),
        p(medida="internacoes", campo="regiao", serie="raca_cor", forma="empilhada_100"),
        p(medida="obitos", campo="mes", serie="regiao", forma="heatmap"),
        # Ordens.
        p(medida="internacoes", campo="uf", ordem="valor_asc"),
        p(medida="internacoes", campo="uf", ordem="categoria_asc"),
        p(medida="internacoes", campo="uf", ordem="categoria_desc"),
    ]


if __name__ == "__main__":
    raise SystemExit(main())
