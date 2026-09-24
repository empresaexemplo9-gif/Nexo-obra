# Editor CAD

Desenho técnico em camadas dentro da H.OIKOS. Menu **Editor CAD**; cada prancha abre em
outra aba (`/prancheta/[id]`). Permissão: módulo `studio` (ver para abrir, editar para
desenhar, importar e gravar). Tudo é da empresa da sessão — a prancha, o arquivo importado
da biblioteca e as imagens.

## Abrir um DWG ou DXF

- **Importar DWG ou DXF** na lista de pranchas: o arquivo vai para a biblioteca da
  Prancheta (em partes cifradas), uma prancha nova é criada e o editor abre lendo o arquivo.
- **Editar no Editor CAD** num DWG ou DXF aberto na Prancheta faz o mesmo sem reenviar.
- **Importar CAD** dentro do editor junta o arquivo à prancha aberta. Até 3,5 MB vai no
  próprio pedido; maior que isso passa pela biblioteca.

O DWG é convertido em DXF no servidor (LibreDWG em WebAssembly) e lido pelo mesmo leitor
do DXF. Antes de entrar, a importação mostra quantos elementos e camadas vieram, a unidade
(que pode ser trocada e relida) e o que ficou de fora.

### O que entra

- Todas as camadas da tabela do arquivo, inclusive vazias, com cor (índice do AutoCAD ou
  RGB), tipo de linha (contínua, tracejada, traço e ponto, pontilhada) e estado: desligada
  ou congelada entra escondida; travada entra travada. Arquivo com todas as camadas
  desenhadas desligadas entra visível, com aviso.
- Linhas, polilinhas (novas e antigas, com arcos por bulge), círculos, arcos, elipses,
  splines, pontos, sólidos, faces, hachuras (contornos com furos; sólida pintada, com
  padrão em tom), chamadas (LEADER), linhas múltiplas (MLINE), textos com alinhamento,
  MTEXT em várias linhas (acentos, Ø, °, ±, frações), atributos visíveis, cotas e tabelas
  (pelo bloco que o arquivo desenha).
- Blocos com escala, giro, espelhamento, matriz (MINSERT) e aninhamento; o que está na
  camada 0 herda a camada do bloco; cor "por bloco" herda a cor do bloco.
- Sistema de coordenadas do objeto (extrusão), então arco espelhado no AutoCAD entra do
  lado certo.

Fica de fora, com contagem no relatório: espaço de papel (carimbo e folhas), sólidos e
superfícies 3D, imagens raster, regiões, linhas infinitas e chamadas múltiplas (MLEADER).
Limites: 80 mil elementos e 1.000 camadas por prancha; a importação corta em 60 mil e diz.

### Conversor DWG

O LibreDWG em WebAssembly tem um estouro de memória ao ler DWG de 2007 em diante: com o
heap no tamanho inicial, o DXF saía corrompido. O servidor reserva folga de memória antes
da primeira conversão, e toda saída é conferida — DXF com cabeçalho ou nomes de entidade
ilegíveis é recusado com mensagem, nunca repassado.

## Ferramentas

Seleção (clique, Shift, janela), linha, polilinha, retângulo, parede, cômodo, porta, janela,
passagem, símbolos elétricos e de iluminação, mobília, imagem, texto, cota, traço livre,
círculo, arco, espelhar, aparar e estender; comandos digitados (`L`, `PL`, `C`, `A`, `REC`,
`EL`, `POL`, `DIM`, `T`, `M`, `CO`, `RO`, `SC`, `MI`, `O`, `AR`, `AP`, `E`, `J`, `TR`,
`EX`) desenham na camada escolhida.

- **Aparar**: clique no pedaço que deve sumir. Ele é cortado entre as duas linhas que o
  cruzam mais perto do clique (ou até a ponta). Polilinha cortada no meio vira duas; círculo
  cortado em dois pontos vira arco. Todo o desenho visível serve de limite.
- **Estender**: clique perto da ponta; ela cresce até a primeira linha no caminho.
- **Espelhar**: cópia refletida; texto continua legível.
- **Encaixe**: extremo, interseção, perpendicular, meio, centro, quadrante, tangente e mais
  próximo, consultados num índice espacial (o desenho não é varrido a cada movimento).

Camadas: filtro por nome, mostrar/esconder todas, só as filtradas, isolar, cor, tipo de
linha, disciplina, renomear, selecionar tudo da camada e apagar camada vazia. Cada elemento
pode ter cor e tipo de linha próprios ("da camada" por padrão). Fundo escuro opcional.

## Gravar

Revisão otimista: quem grava declara a revisão que abriu, e o servidor recusa se outra aba
gravou antes. Desenho grande vai e volta comprimido em gzip (o teto de corpo das funções é
4,5 MB) e é guardado comprimido no banco. Ctrl+S grava de qualquer lugar do editor.
