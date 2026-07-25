# Perfilagem do banco SIH-RD

Tudo aqui foi medido diretamente no arquivo
`/Users/maiconkevyn/PycharmProjects/databases/datasus/sihrd5.duckdb`
(15,4 GB, DuckDB, aberto em modo read-only). Reproduza com
`python -m eval.build_gold` e com as consultas citadas.

## 1. Estrutura

Star schema: uma tabela fato e 18 dimensões.

| Tabela | Linhas | Papel |
|---|---:|---|
| `internacoes` | 144.386.772 | **fato** — uma linha por AIH encerrada |
| `_staging_internacoes` | 39.622.048 | carga intermediária — **não usar** |
| `cid` | 14.253 | CID-10 com hierarquia capítulo→grupo→categoria |
| `municipios` | 5.590 | município, UF, região de saúde, lat/long |
| `tempo` | 5.844 | calendário |
| `procedimentos` | 5.394 | SIGTAP |
| `cbor` | 2.813 | ocupações CBO |
| `nacionalidade` | 333 | |
| `etnia` | 265 | etnias indígenas |
| `especialidade` | 39 | especialidade do leito |
| `marca_uti` | 17 | tipo de UTI |
| `contraceptivos` | 13 | |
| `car_int`, `raca_cor`, `vincprev` | 7 cada | |
| `instrucao` | 6 | |
| `complexidade` | 4 | |
| `sexo` | 4 | |
| **`hospital`** | **0** | **VAZIA** |
| **`socioeconomico`** | **0** | **VAZIA** |

## 2. Cobertura temporal

`DT_SAIDA` vai de **2007-08-01 a 2023-12-31**. `DT_INTER` chega a 1995-03-03
(internações longas iniciadas antes e encerradas dentro da janela).

2007 tem só ago-dez: **431.437** internações contra ~8,5-9,9 milhões por ano
completo. É ano parcial e não entra em comparações anuais.

O menor ano completo é **2020** (8.247.368) — queda de internações eletivas na
pandemia. O pico de óbitos é **2021** (579.717, +47,1% sobre 2019).

## 3. Integridade referencial

| Junção | Órfãos | % |
|---|---:|---:|
| `MUNIC_RES` → `municipios` | 0 | 0,000% |
| `SEXO`, `RACA_COR`, `CAR_INT`, `ESPEC`, `COMPLEX` → dims | 0 | 0,000% |
| `PROC_REA` → `procedimentos` | 370 | 0,000% |
| `DIAG_PRINC` → `cid` | 777 | 0,001% |
| `DT_SAIDA` → `tempo.data` | **431.437** | **0,299%** |

Os órfãos de CID são majoritariamente códigos `U04`, `U09`, `U10` (emergência
sanitária/COVID) e `N182`-`N185`.

`tempo` cobre apenas 2008-2023 — **um INNER JOIN com ela apaga 2007 sem erro**.

## 4. Achados de qualidade de dados

Estes quatro pontos são a razão de o chatbot precisar de um dicionário curado.
Sem eles, o LLM produz resultados errados que parecem certos.

### 4.1 `SEXO` — o valor 2 não existe no fato

A dimensão mapeia **dois** códigos para 'Feminino':

```
0 = Ignorado · 1 = Masculino · 2 = Feminino · 3 = Feminino
```

Mas o fato só contém `1` (58.967.743) e `3` (85.419.029). Escrever
`WHERE SEXO = 2` para "mulheres" retorna **zero linhas, sem erro**.
Use `SEXO IN (2,3)` ou junte com a dimensão.

O predomínio feminino vem da obstetrícia: o capítulo CID mais frequente é
"XV. Gravidez, parto e puerpério" (30.334.251) e o procedimento mais realizado é
`PARTO NORMAL` (13.399.545).

### 4.2 `GESTRISCO` está corrompida

`TRUE` em **143.764.198 de 144.386.772 linhas (99,6%)** — incluindo
**58.785.755 pacientes do sexo masculino**. A coluna é inutilizável.

### 4.3 `UTI_INT_TO` está zerada

Entre as 9.107.197 internações com `MARCA_UTI > 0`, **9.107.168 têm
`UTI_INT_TO = 0`**. Só 29 linhas em toda a base são não-nulas. Para intensidade
de UTI use `VAL_UTI` (18,3% do gasto total) ou `MARCA_UTI > 0`.

### 4.4 São Paulo e Tocantins estão ausentes

Volume por UF de residência (extrato):

| UF | Internações |
|---|---:|
| MG | 19.276.203 |
| BA | 13.272.355 |
| RJ | 10.926.128 |
| … | |
| RR | 598.101 |
| **SP** | **88.884** |
| **TO** | **38.425** |

São Paulo, o estado mais populoso do país, tem menos internações que Roraima —
e a lacuna é constante em todos os 17 anos (2.036 em 2008, 6.961 em 2023). Isso
é **falha de extração, não achado epidemiológico**. Qualquer ranking por UF
precisa dizer isso.

## 5. Convenções de codificação

- **CID sem ponto**: `J189`, não `J18.9`. Categorias têm 3 caracteres, subcategorias 4.
  Para a categoria inteira use `LIKE 'J18%'` (5.013.865) — `= 'J18'` pega só o
  código genérico.
- **Acentuação varia por tabela**: `municipios.NO_MUNICIPIO` **tem** acento
  (2.387 de 5.590: 'São Paulo', 'Ribeirão Preto'); `cid.DESCRICAO` praticamente
  não tem (41 de 14.253); `procedimentos.NOME_PROC` é maiúsculo sem acento, com
  109 nomes com lixo de codificação.
- **`PROC_REA`** é string de 10 dígitos com zeros à esquerda.
- **`RACA_COR`** é string de 2 dígitos; o código de desconhecido usado é `'99'`.
- **`INSTRU`** tem no fato os valores 5, 6 e 8, ausentes da dimensão → `LEFT JOIN`.
- **`ESPEC`** nunca traz os códigos de UTI (74-95); para UTI use `MARCA_UTI`.

## 6. Sanidade

- `IDADE` bate com `NASC`/`DT_INTER` em 100% de uma amostra de 5 milhões — está em anos completos, 0 a 130.
- Nenhum `DIAS_PERM` negativo; nenhuma `DT_SAIDA < DT_INTER`.
- Nenhum NULL em `DIAG_PRINC`, `MUNIC_RES`, `IDADE`, `RACA_COR`, `VAL_TOT`.
- `N_AIH` é quase-única: 599 números aparecem em mais de uma linha.
- 5.922 CNES distintos, 5.563 municípios de residência, 1.928 procedimentos, 11.612 CIDs.

## 7. Números de referência

| Métrica | Valor |
|---|---:|
| Internações | 144.386.772 |
| Óbitos | 5.877.536 |
| Taxa de mortalidade | 4,0707% |
| Gasto total | R$ 212.580.836.278,08 |
| Ticket médio | R$ 1.472,30 |
| Permanência média | 5,0631 dias |
| Internações com UTI | 9.107.197 (6,3%) |
| Mortalidade com UTI | 23,0454% |
| Mortalidade sem UTI | 2,7933% |
| UTI no gasto total | 18,2908% |
