# Testes de interface

Os testes de API e de biblioteca cobrem regra de negócio, autorização e cálculo. Estes
cobrem a camada que faltava: **o que a pessoa vê e o que acontece quando ela clica**.

## Como funcionam

Os componentes são montados de verdade, com `react-dom/client`, dentro de um DOM criado
pelo `jsdom`. Os efeitos rodam, os cliques são despachados e a árvore é inspecionada como
um navegador faria. A API nunca é chamada: `stubFetch` responde com o que o teste definir,
então cada cenário é determinístico.

O suporte fica em `tests/dom-harness.mjs`. Os substitutos de `next/image` e `next/link`,
em `tests/stubs/`, existem porque esses dois dependem do runtime do Next, que não está
presente fora do servidor.

## O que está coberto

| Arquivo | O que verifica |
| --- | --- |
| `ui-workspace.test.mjs` | Menu por permissão, sino de lembretes, selos de superadmin e manutenção, plataforma sem empresa, ausência de sessão, bloqueio pelos termos |
| `ui-analysis.test.mjs` | Planilha vazia, o que falta marcar, sugestão de papéis aplicada só no clique, números na tela, margem alvo mudando a recomendação, somente-leitura, linha de totais, quadro de liberações |
| `ui-worksheets.test.mjs` | Galeria de modelos, criação por identificador de modelo, barra de edição, somente-leitura escondendo salvar, aba de acesso para quem governa, erro de carregamento |
| `ui-components.test.mjs` | Render estático das primitivas e do CSS gerado |

Os cenários de permissão repetem de propósito o que já é testado na API. Não é duplicação
inútil: o servidor decide, mas uma tela que mostra um botão proibido induz a pessoa ao
erro e expõe a existência de algo que ela não deveria conhecer.

## O que estes testes não cobrem

São honestos sobre o próprio alcance:

- **não são um navegador real**: CSS, layout, rolagem, foco visual e responsividade não
  são verificados — `jsdom` não calcula estilo nem posiciona nada;
- **não testam o servidor de verdade**: a API é respondida em teste. A integração real
  está coberta pelos testes de rota, que executam os handlers contra SQLite com as
  migrações reais;
- **não medem desempenho** nem detectam regressão visual.

Para essas três lacunas seria preciso um navegador dirigido com a aplicação no ar. É um
trabalho maior e de manutenção mais cara; o ambiente já tem Chromium disponível se um dia
valer a pena.

## Dependência nova

`jsdom`, em desenvolvimento. É a única forma de montar um componente React, rodar seus
efeitos e despachar um clique fora de um navegador: o Node não traz DOM. Sem ela, os
testes de interface ficariam limitados ao render estático, que não pega nenhuma das
regressões acima.
