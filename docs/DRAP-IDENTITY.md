# Identidade DRAP Backoffice

**DRAP Backoffice para Arquitetos** (nome curto: **DRAP Backoffice**; assinatura: “DRAP · Backoffice
para arquitetos”) é o serviço de backoffice da **DRAP Soluções Tecnológicas** para escritórios de
arquitetura e engenharia. A marca substituiu a H.OIKOS em outubro de 2026. O rebranding trocou
somente nome, logo e paleta: layout, tipografia, espaçamentos, ícones, fotos e componentes ficaram
como estavam.

## Paleta

As cores vêm da plataforma de referência da DRAP. Dela veio **somente a cor**: nenhuma fonte, foto,
desfoque ou ornamento.

| Token | Nome | HEX | Uso |
| --- | --- | --- | --- |
| `--drap-deep` | Abismo Nanquim | `#0D151F` | Menu lateral, telas de entrada, selo Superadmin, linhas grossas |
| `--drap-band` | Azul Cianótipo | `#204362` | Banner “O que move o trabalho hoje”, texto pequeno em destaque, links |
| `--drap-accent` | Azul Prancheta | `#27557B` | Botão principal, ícones, topo de cards, foco |
| `--drap-support` | Aço Escuro | `#24323B` | Bordas (30–35% em linha fina), item escuro do menu |
| `--drap-graphite` | Cinza Grafite | `#6F7678` | Cards escuros, numeração “01, 02” |
| `--drap-mist` | Cinza Névoa | `#99A1A6` | Cards secundários, “Próximas tarefas”, rótulos sobre fundo escuro |
| `--drap-fog` | Cinza Neblina | `#839099` | Hover e áreas de apoio |
| `--drap-stone` | Pedra Clara | `#B0ADA8` | Fundo da página |
| `--drap-paper` | Papel Cinza | `#B5B4B1` | Cards, barra superior, campos |
| `--drap-ink` | Tinta | `#090C12` | Texto sobre fundo claro |
| `--drap-white` | Branco | `#FFFFFF` | Texto sobre Abismo, Cianótipo, Prancheta e Grafite |

Status, sempre como chip ou ponto e com a palavra ao lado:

| Token | Status | Fundo | Texto |
| --- | --- | --- | --- |
| `--drap-success` | Sucesso / concluído / pago | `#2E7D52` | branco |
| `--drap-warning` | Atenção / em andamento / pausado | `#D9A441` | Tinta |
| `--drap-danger` | Erro / vencido / bloqueado / recusado | `#A83232` | branco |
| `--drap-info` | Informação / enviado / a fazer | `#27557B` | branco |

Regra de contraste: texto pequeno em destaque sobre fundo claro usa **Azul Cianótipo**; o Azul
Prancheta (3,5:1 sobre Pedra Clara) fica para botão, ícone e elemento grande. Todo tom da interface é
uma dessas cores ou uma mistura entre elas (`color-mix`); o teste `tests/product-contract.test.mjs`
falha se outro HEX entrar em `app/globals.css`.

A escala utilitária `drap-50` … `drap-950` continua existindo para os componentes e aponta para
esses tokens: `50` Papel Cinza, `100` superfície secundária, `200` borda, `300`/`400` Cinza Névoa,
`500` metadado legível, `600`–`800` Aço Escuro, `900` Abismo, `950` Tinta.

## Marca

O símbolo é o “D” cheio da DRAP com o corte diagonal fino, desenhado a partir da arte enviada pela
DRAP. O lettering “DRAP” e as linhas em caixa alta usam a mesma família da interface (Jost) e
estão **convertidos em contorno**, então não dependem de fonte instalada. Cinco aplicações, cada
uma em positivo (`-light`, Abismo `#0D151F`) e negativo (`-dark`, branco):

| Arquivo | Aplicação | Proporção |
| --- | --- | --- |
| `drap-symbol-*` | Só símbolo: menu recolhido, favicon, avatar | 360 × 320 |
| `drap-wordmark-*` | Lettering DRAP | 503 × 140 |
| `drap-signature-*` | DRAP + “BACKOFFICE PARA ARQUITETOS” | 815 × 216 |
| `drap-stacked-*` | Símbolo sobre a assinatura: telas de entrada | 815 × 540 |
| `drap-lockup-*` | Símbolo à esquerda de DRAP + “BACKOFFICE”: menu e cabeçalhos | 823 × 225 |

O lockup usa o nome curto porque a assinatura inteira ficaria ilegível nos 140 px do menu.
Versões PNG transparentes (1024 px de largura) ficam em `public/brand/png/`; o favicon existe em
`public/favicon.svg`, `public/favicon.ico` (16–64 px) e `public/apple-touch-icon.png`.

Regras que o código respeita:

- largura mínima de 150 px para lettering com assinatura e 120 px para o lockup — travada em `BrandLogo`;
- `object-fit: contain` e proporção intrínseca declarada, então a marca nunca achata nem estica;
- sem sombra, filtro, rotação ou recolorização; positivo em Abismo, negativo em branco;
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
declarados em `app/globals.css` como `Drap Sans` e `Drap Display`. Ao receber os `.woff2`
licenciados de Barium e Ador Hairline, basta trocar os `src` das quatro regras `@font-face`:
nenhum componente cita o nome da fonte diretamente.


Ritmo tipográfico aplicado, espelhando as páginas do manual:

- `.display-heading` — serifada, peso 500, para o `h1` de cada tela;
- `.eyebrow` — caixa alta, 11 px, entreletra `0.24em`, para rótulos acima do título;
- rótulos de grupo do menu lateral em caixa alta com entreletra `0.2em`;
- raio de canto de 4 px: geometria seca, coerente com a construção do símbolo.

## Escopo da alteração

Somente visual e de nomenclatura de produto. URLs, autenticação, permissões, dados, contratos de
API e a integração financeira Drap permanecem intactos. Ficaram com o nome antigo, de propósito,
identificadores técnicos já gravados ou trocados com outro sistema: o prefixo `hoikos:` das chaves
de idempotência e dos centros de custo enviados à Drap, o e-mail técnico do link de acesso e os
cabeçalhos internos `X-Hoikos-*` de compressão. Renomeá-los quebraria retry e vínculo com dado
já existente sem nenhum ganho para quem usa a plataforma. A variável `HOIKOS_PUBLIC_URL` virou
`APP_PUBLIC_URL`; o nome antigo continua aceito.

## Composição da área de trabalho

Fundo em Pedra Clara, cards e barra superior em Papel Cinza, menu em Abismo Nanquim com item ativo
branco. O banner da visão geral é Azul Cianótipo com a mesma foto; os indicadores ficam
transparentes sobre linha grossa em Abismo; “Primeiros passos” usa Papel Cinza com topo em Azul
Prancheta e numeração em Grafite; “Próximas tarefas” fica em Cinza Névoa. A navegação e os
formulários sobre fundo escuro têm contraste próprio; em celular, os painéis se empilham e os
indicadores usam duas colunas.
