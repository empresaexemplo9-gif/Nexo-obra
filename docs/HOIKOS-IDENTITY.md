# Identidade H.OIKOS

Fonte: “GUIA DA IDENTIDADE VISUAL — H.OIKOS.pdf”, enviado pelo proprietário da marca.
O manual completo não é publicado como asset; só as aplicações autorizadas ficam no repositório.

## Paleta oficial (página 15)

| Papel na interface | Nome | HEX |
| --- | --- | --- |
| Contraste extremo, alertas críticos | Preto | `#000000` |
| Cor principal, superfícies escuras, texto | Marrom profundo | `#38301B` |
| Apoio, bordas, metadados sobre fundo escuro | Acinzentado neutro | `#B5B19E` |
| Fundo geral, texto sobre fundo escuro | Off-white | `#F7F7F0` |
| Profundidade sem recorrer ao preto puro | Marrom quase preto | `#1C190F` |
| Superfície destacada sobre o fundo | Off-white quente | `#F4F2E9` |
| **Acento**: o que pede atenção — vencido, bloqueado, pausado | Dourado | `#846100` |

Todo tom da interface é uma dessas sete cores ou uma mistura entre elas (`color-mix`).

As três últimas saíram da leitura do arquivo do guia oficial e não tinham token antes, o
que prendia a interface a um marrom só — `hoikos-600` até `hoikos-900` são todos `#38301B`.

O dourado é a **única cor de matiz diferente em todo o guia** e por isso é acento, nunca
superfície nem texto corrido: em área grande brigaria com a sobriedade do resto da
identidade. Ele marca o que pede ação — conta vencida, tarefa bloqueada, projeto pausado.
O estado resolvido recua para o acinzentado, porque já não pede nada.
Nenhum gradiente decorativo. Estados continuam identificados por texto e ícone, não só por cor.
O teste `tests/product-contract.test.mjs` falha se qualquer outro HEX entrar em `app/globals.css`.

## Marca

As artes em `public/brand/` são os contornos originais da página 7 do manual, extraídos do PDF
como vetor — não são uma reconstrução tipográfica. Cinco aplicações, cada uma em positivo
(`-light`, marrom) e negativo (`-dark`, off-white):

| Arquivo | Aplicação | Proporção |
| --- | --- | --- |
| `hoikos-symbol-*` | Símbolo isolado: menu recolhido, favicon | 340 × 352 |
| `hoikos-wordmark-*` | Lettering H.OIKOS | 978 × 171 |
| `hoikos-signature-*` | Lettering + “ecossistema para arquitetos” | 978 × 269 |
| `hoikos-stacked-*` | Símbolo sobre a assinatura: telas de entrada | 978 × 724 |
| `hoikos-lockup-*` | Símbolo à esquerda do lettering: cabeçalhos | 1297 × 241 |

A proporção do lockup horizontal (símbolo com 1,404× a altura do lettering, respiro de 0,504×
essa altura, eixos centrados) foi medida nas variações da página 9.

Regras que o código respeita, conforme as páginas 8, 20 e 22 do manual:

- largura mínima de 150 px para qualquer aplicação com lettering — travada em `BrandLogo`;
- `object-fit: contain` e proporção intrínseca declarada, então a marca nunca achata nem estica;
- sem sombra, filtro, rotação, recorte ou recolorização; positivo em marrom, negativo em off-white;
- nada de aplicar a marca sobre foto ou vídeo sem fundo sólido da paleta.

Use sempre o componente `components/brand-logo.tsx`; não referencie os SVGs direto.

## Tipografia

O manual (página 18) define **Barium Regular** (sans geométrica) e **Ador Hairline** (serifada de
traço fino). As duas são comerciais e não vieram com licença web, então a interface serve as
equivalentes livres mais próximas em desenho e peso, hospedadas no próprio domínio:

| Papel | Fonte do manual | Fonte servida | Licença |
| --- | --- | --- | --- |
| Texto, rótulos, controles | Barium Regular | Jost (variável 300–700) | SIL OFL 1.1 |
| Títulos de página | **Ador Hairline** (licenciada, em uso) | Cormorant só como reserva | licença própria |

Os arquivos ficam em `public/fonts/` (subconjuntos latin e latin-ext, ~109 KB no total) e são
declarados em `app/globals.css` como `Hoikos Sans` e `Hoikos Display`. Ao receber os `.woff2`
licenciados de Barium e Ador Hairline, basta trocar os `src` das quatro regras `@font-face`:
nenhum componente cita o nome da fonte diretamente.

Nenhum subconjunto de fonte foi extraído do PDF. O lettering da logo é exato porque está
convertido em contornos, não tipografado.

Ritmo tipográfico aplicado, espelhando as páginas do manual:

- `.display-heading` — serifada, peso 500, para o `h1` de cada tela;
- `.eyebrow` — caixa alta, 11 px, entreletra `0.24em`, para rótulos acima do título;
- rótulos de grupo do menu lateral em caixa alta com entreletra `0.2em`;
- raio de canto de 4 px: geometria seca, coerente com a construção do símbolo.

## Escopo da alteração

Somente visual e de nomenclatura de produto. URLs, autenticação, permissões, dados, contratos de
API e a integração financeira Drap permanecem intactos. Identificadores técnicos, nomes de tabela
e códigos de erro não foram renomeados.
