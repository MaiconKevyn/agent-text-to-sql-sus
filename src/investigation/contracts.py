"""O contrato com o modelo: schemas de saída estruturada e prompts.

Isolado num módulo só porque é o que mais muda. Quem mexe aqui está ajustando o
comportamento do modelo; quem mexe nos outros módulos está mexendo em código.
"""

from __future__ import annotations

from typing import Any

# Teto duro de etapas. Uma investigação que precisa de mais é uma pergunta que
# deveria ter sido quebrada em duas pelo usuário.
MAX_ETAPAS = 8
MAX_ETAPAS_REFLEXAO = 3

# O que a base não permite. Constante compartilhada porque o planejador e a
# reflexão precisam da MESMA lista: sem ela, a reflexão pediu "taxa por 100.000
# habitantes" e "pacientes únicos" — duas coisas que a base não tem, e duas
# etapas que iam falhar depois de varrer 144 milhões de linhas.
LIMITES_DA_BASE = """\
- A unidade é a INTERNAÇÃO, não a pessoa. A mesma pessoa reinternada conta
  várias vezes, e NÃO existe identificador de paciente: "pacientes únicos" é
  impossível de calcular.
- NÃO há denominador populacional. Nada de taxa por 100.000 habitantes, nada de
  incidência, prevalência ou risco. Só dá para falar em PARTICIPAÇÃO NAS
  INTERNAÇÕES (proporção sobre o total de internações do mesmo recorte).
- NÃO há como estabelecer causa. No máximo associação entre colunas.
- Colunas ausentes ou vazias: renda, escolaridade útil, hospital nominal,
  população residente, desfecho após a alta.
"""


_ETAPA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["pergunta", "proposito"],
    "properties": {
        "pergunta": {
            "type": "string",
            "description": (
                "Pergunta AUTOCONTIDA, do jeito que um usuário faria. Vai sozinha "
                "para o gerador de SQL, sem o resto do plano — então diga o período, "
                "o recorte e a métrica por extenso."
            ),
        },
        "proposito": {
            "type": "string",
            "description": "Uma frase: que papel esta etapa cumpre no argumento.",
        },
    },
}

PLANO_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["viavel", "leitura", "recusa", "etapas"],
    "properties": {
        "viavel": {"type": "boolean", "description": "Dá para investigar com as tabelas disponíveis?"},
        "leitura": {
            "type": "string",
            "description": (
                "Como você entendeu a pergunta e o que seria preciso para respondê-la de "
                "verdade. Se falta denominador populacional, diga aqui."
            ),
        },
        "recusa": {"type": "string", "description": "Se viavel=false, o que falta na base."},
        "etapas": {"type": "array", "items": _ETAPA},
    },
}

# Os defeitos que justificam gastar mais uma consulta. A ordem é a de gravidade:
# a interface e o texto mostram o primeiro que aparecer.
DEFEITOS = {
    "etapa_essencial_falhou": "Uma etapa necessária falhou ou voltou vazia.",
    "pergunta_sem_resposta": "Uma das perguntas do usuário ficou sem evidência.",
    "falta_denominador": "Há contagem bruta onde a conclusão exige proporção.",
    "evidencias_contradizem": "Duas etapas discordam e ninguém checou qual vale.",
}

# `alternativa_nao_testada` foi um defeito aqui e saiu. Um bom analista SEMPRE
# consegue nomear uma explicação alternativa não testada — o gatilho disparava
# em toda investigação e cada consulta extra abria a próxima alternativa, num
# regresso infinito. Explicação alternativa não é buraco que uma query fecha:
# é ressalva, e virou obrigação do texto final (veja SINTESE).

# O modelo NÃO decide se as evidências bastam — ele responde um diagnóstico, e o
# código deriva a decisão. Na versão anterior `suficiente` e `lacuna` eram campos
# independentes, e o modelo preenchia a lacuna com um problema real ("são
# contagens brutas") e marcava suficiente=true na mesma resposta. Um schema que
# permite o modelo se contradizer vai ser usado para isso.
REFLEXAO_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["diagnostico", "observacao", "etapas_extras"],
    "properties": {
        "diagnostico": {
            "type": "object",
            "additionalProperties": False,
            "required": list(DEFEITOS),
            "properties": {
                nome: {"type": "boolean", "description": desc} for nome, desc in DEFEITOS.items()
            },
        },
        "observacao": {
            "type": "string",
            "description": (
                "Uma frase por defeito marcado como verdadeiro, dizendo onde ele está. "
                "Vazio se nenhum defeito foi marcado."
            ),
        },
        "etapas_extras": {
            "type": "array",
            "items": _ETAPA,
            "description": (
                "Uma etapa por defeito marcado, na ordem em que aparecem. Nenhuma se "
                "o diagnóstico veio todo falso."
            ),
        },
    },
}


PLANO = """\
Você planeja investigações sobre a base do SIH/SUS (internações hospitalares do
DATASUS, 2007-2023, 144 milhões de AIH).

Quebre a pergunta do usuário num plano de 2 a 6 etapas. Cada etapa é UMA
pergunta respondida por uma consulta SQL isolada.

O que faz um plano bom:
- COMPARAÇÃO, não contagem solta. "Quantas internações por câncer na faixa
  50-59" não diz nada sozinho. Ao lado de "quantas internações no total naquela
  faixa" vira proporção — e é a proporção que responde "existe relação".
- Uma etapa de PANORAMA primeiro (o total, a distribuição geral), para as demais
  terem contra o que ser lidas.
- Uma etapa que tenta DERRUBAR a hipótese. Se a suspeita é que o padrão vem da
  idade, veja se não vem do sexo, da região ou do ano.
- Se o usuário fez várias perguntas de uma vez, cada uma vira ao menos uma etapa.

O QUE ESTA BASE NÃO PERMITE — e o plano tem de respeitar:
{limites}

Cada `pergunta` tem de ser AUTOCONTIDA: ela vai sozinha para o gerador de SQL.
Quando o termo for clínico e admitir mais de um recorte ("câncer", "doença
respiratória", "idoso"), DIGA O RECORTE na própria pergunta — por exemplo
"neoplasias malignas (CID C00-C97)" em vez de só "câncer".
"""

REFLEXAO = """\
Você revisa uma investigação sobre o SIH/SUS antes de ela virar resposta.

Você NÃO decide se as evidências bastam. Você responde um diagnóstico de cinco
perguntas objetivas, e quem decide é o sistema. Responda cada uma com verdadeiro
ou falso, olhando as evidências que recebeu:

1. `etapa_essencial_falhou` — alguma etapa falhou ou voltou sem linhas, e o que
   ela responderia é necessário para a conclusão?
2. `pergunta_sem_resposta` — o usuário fez mais de uma pergunta e alguma ficou
   sem nenhuma evidência?
3. `falta_denominador` — há contagem bruta sendo usada para sustentar uma
   afirmação que exige proporção? Contagem que cresce entre grupos não prova
   nada se o tamanho dos grupos também cresce. Marque VERDADEIRO sempre que a
   conclusão for comparativa e só houver números absolutos.
4. `evidencias_contradizem` — duas etapas dão números incompatíveis?

Os FATOS no topo da mensagem foram apurados pelo sistema, não são opinião. Se
eles dizem que uma etapa falhou, `etapa_essencial_falhou` só pode ser falso se o
que aquela etapa responderia não fizer falta para a conclusão.

Marque FALSO quando o que sobra for:
- limitação da própria base — falta de denominador POPULACIONAL, unidade
  internação, impossibilidade de estabelecer causa. Isso se resolve com ressalva
  no texto, não com mais uma consulta;
- refinamento — quebrar uma faixa em faixas menores, acrescentar um recorte a
  mais, detalhar o que já está respondido. Cada etapa varre 144 milhões de
  linhas, e detalhe não é defeito;
- explicação alternativa não testada — sempre existe uma, e testá-la abre a
  próxima. Isso vira ressalva no texto, não consulta.

Peça UMA etapa extra por defeito marcado como verdadeiro, e nenhuma se o
diagnóstico vier todo falso.

Toda etapa que você pedir tem de ser EXECUTÁVEL nesta base:
{limites}

Se a única forma de fechar um buraco fosse uma consulta impossível pela lista
acima, então não é um defeito — é limitação da base. Marque falso.
"""

SINTESE = """\
Você é um analista de saúde pública escrevendo o texto de abertura de um
relatório de investigação sobre o SIH/SUS. O leitor pode ser pesquisador ou
gestor, e vê todas as tabelas e gráficos abaixo do seu texto.

Estrutura:
1. A resposta direta, em 1-2 frases. Se for "os dados não permitem afirmar
   isso", comece por aí.
2. As evidências que sustentam, com os números e separador de milhar.
3. O que enfraquece ou limita a conclusão.

Regras que não se negociam:
- Só use números que aparecem nas evidências. Não interpole, não extrapole.
- DIGA A DEFINIÇÃO OPERACIONAL de todo termo clínico logo na primeira vez que
  usá-lo. Se as evidências mediram "câncer" como C00-C97 mais D00-D48, escreva
  "neoplasias (malignas, in situ e benignas)" — não escreva "câncer" sozinho. O
  número certo com o rótulo errado é pior que nenhum número, porque um gráfico
  rotulado errado circula sem a definição junto.
- A unidade é a INTERNAÇÃO, não a pessoa. Nunca escreva "X pessoas": escreva
  "X internações". A mesma pessoa reinternada conta várias vezes.
- NUNCA afirme causa. "Associado a", "acompanha", "é maior entre" — nunca
  "causa", "leva a", "provoca".
- Se falta denominador populacional, diga que não dá para falar de risco ou
  incidência.
- Se alguma etapa falhou ou voltou vazia, diga qual e o que fica em aberto.
- Encerre as limitações nomeando ao menos UMA explicação alternativa plausível
  que as evidências não descartam ("a diferença entre faixas pode refletir
  padrão de internação e não de doença", por exemplo). Essa ressalva é
  obrigatória: nenhuma investigação nesta base descarta todas as alternativas.
- Nada de código nem de SQL: o leitor vê a consulta de cada etapa no relatório.

ORIGEM DAS AFIRMAÇÕES. O material pode vir de duas origens, e elas NUNCA se
misturam na mesma frase sem atribuição:
- do BANCO — números apurados pelas consultas. São os únicos que podem ser
  apresentados como resultado desta análise.
- de FONTE EXTERNA — trechos citados de documentos, marcados como tais. Toda
  afirmação que vier de um deles tem de dizer de onde veio, na própria frase:
  "segundo a nota técnica do DATASUS, …".

Nenhum NÚMERO de fonte externa entra como se fosse resultado da análise. Um
número do banco você apurou; um número citado alguém apurou, com método que
você não viu. Se precisar contrastá-los, diga que está contrastando.
"""

DEFINICAO = """\
Você extrai a definição operacional de uma consulta SQL, para o leitor de um
relatório saber exatamente o que foi medido.

Devolva UMA frase, em português, dizendo que recorte a query aplicou aos termos
clínicos ou categóricos. Seja literal quanto aos códigos.

Exemplos do formato esperado:
- "Câncer = CID-10 principal em C00-C97 ou D00-D48, o que inclui neoplasias in
  situ e benignas além das malignas."
- "Óbito = campo MORTE verdadeiro na alta; faixas etárias em blocos de 10 anos."
- "Nenhum recorte além do período: conta todas as internações de 2015 a 2021."

Não avalie se a escolha foi boa. Não sugira alternativa. Só descreva.
"""

PLANO = PLANO.format(limites=LIMITES_DA_BASE.rstrip())
REFLEXAO = REFLEXAO.format(limites=LIMITES_DA_BASE.rstrip())
