# Frontend — Consulta SIH/SUS

Interface de conversa para o agente text-to-SQL. O usuário pergunta em
português, vê a consulta gerada, a tabela de resultados e — com o modo de
depuração ligado — todo o rastro entre a pergunta e a resposta.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm run typecheck
```

## Estado atual: sem backend

`src/mocks/api.ts` emite os mesmos eventos que o backend emitiria, na mesma
ordem. **Os dados não são inventados**: `traces.json` e `schema.json` foram
gerados rodando o agente Python contra o DuckDB de 144 milhões de linhas, então
o SQL, os tempos, os resultados e o contexto montado são reais.

Trocar o mock por um cliente HTTP/SSE não deve tocar em nenhum componente — a UI
consome o `AsyncGenerator<StreamEvent>` de `ask()` e nada além disso.

## Organização

```
src/
├── lib/types.ts          contrato entre dados e UI
├── mocks/                api mockada + traces e schema reais
├── hooks/
│   ├── useChat.ts        máquina de estados da conversa
│   ├── useTheme.ts       tema com persistência
│   └── useAutoScroll.ts  rolagem grudada no fim
└── components/
    ├── ui/               primitivas (button, badge, checkbox, collapsible…)
    ├── chat/             conversa, composer, etapas, sugestões
    ├── result/           SQL em accordion e tabela paginada
    ├── schema/           explorador da estrutura do banco
    └── debug/            trace do agente
```

Nenhum componente de UI contém regra de negócio: tudo que decide **o que**
acontece está em `hooks/` e `mocks/`; os componentes decidem apenas **como**
aquilo aparece.

## Modo de depuração

O checkbox no cabeçalho revela, sob cada resposta, o trace completo:

| Evento | Conteúdo |
|---|---|
| Pergunta recebida | texto exato enviado |
| Instruções do sistema | **o contexto montado** — schema, domínios e as 18 regras críticas (~22 mil caracteres) |
| Códigos encontrados | o que o value linker achou nas dimensões, ou por que não achou nada |
| Plano do modelo | JSON com `answerable`, `reasoning`, `sql` e `assumptions` |
| SQL enviado | consulta final, com o `LIMIT` de segurança já injetado |
| Instruções de redação | prompt usado para escrever a resposta |

Cada entrada abre individualmente e tem botão de copiar. O estado persiste em
`localStorage`.

## Animação: CSS onde a visibilidade depende dela

Entradas de conteúdo (mensagens, etapas, cards, accordions, painel lateral) são
animadas em **CSS**, não em JavaScript. O motivo é concreto: animação por JS
depende de `requestAnimationFrame`, e com a aba em segundo plano os quadros não
rodam — um `initial: { opacity: 0 }` deixaria a resposta da consulta invisível.
Com `animation-fill-mode: both` e transições declarativas, o estado final é
garantido mesmo que a animação nunca execute.

Accordions usam `grid-template-rows: 0fr → 1fr`, que anima até a altura do
conteúdo sem medir nada em JS.

Framer Motion ficou apenas onde a ausência de animação não esconde nada: o botão
flutuante "voltar ao fim" e o `MotionConfig` que respeita `prefers-reduced-motion`.

Duração de 150–250 ms, `ease-out`, só `transform` e `opacity`.

## Acessibilidade

- `role="log"` com `aria-live="polite"` na conversa; as etapas do agente têm um
  `aria-live` próprio, para o leitor de tela anunciar o progresso
- `aria-sort` nos cabeçalhos ordenáveis da tabela
- `aria-expanded` em todo accordion; `aria-pressed` nos botões de feedback
- foco visível por `:focus-visible` com anel de 2 px em toda a aplicação
- Esc fecha o bottom sheet no mobile
- contraste conferido para WCAG AA nos dois temas (ver comentários em
  `index.css`, que trazem a razão medida de cada par)

## Estados cobertos

Tela vazia · streaming com cursor · etapas em progresso · etapa pulada · recusa
(pergunta fora do alcance) · erro de rede · SQL que falhou · timeout · consulta
sem resultados · resposta longa com "ver mais".

Para exercitar os erros, inclua na pergunta `erro de rede`, `erro de sql` ou
`timeout`.
