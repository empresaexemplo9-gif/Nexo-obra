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

## Trabalhar como no AutoCAD

O editor segue o jeito do AutoCAD: cada botão é um comando, e todo comando também se
digita. A linha de comando fica embaixo do desenho, com o histórico em cima (F2 abre mais
linhas), o prompt do passo atual com as opções entre colchetes e o padrão entre `< >`.

- **Digitar em qualquer lugar** escreve na linha de comando. Enter ou Espaço confirmam;
  Enter ou Espaço sem nada repetem o último comando; Esc cancela e limpa a seleção. Setas
  para cima e para baixo trazem de volta o que foi digitado; Tab completa o nome.
- **Clique direito** rápido é Enter: conclui o passo ou repete o último comando.
- **Opções** do prompt (Fechar, Desfazer, Diâmetro, Cópia, Referência…) aceitam a letra, o
  nome inteiro ou o clique no botão ao lado do prompt.
- **Coordenadas** em mm: `x,y` absoluto, `@dx,dy` relativo ao último ponto, `d<a`
  distância e ângulo a partir do ponto base, `#x,y` e `#d<a` absolutos, e só a distância
  (`3000`) na direção do cursor. `END`, `MID`, `CEN`, `INT`, `PER`, `QUA`, `TAN` e `NEA`
  forçam um encaixe só para o próximo ponto.
- **Nomes em português e em inglês**: `LINHA` ou `L`/`LINE`, `APARAR` ou `TR`/`TRIM`, e
  assim por diante. A lista completa está em "Comandos e atalhos", embaixo do prompt.
- Uma linha inteira ainda vale como script (`L 0,0 3000,0`, `CO @100,100`, `RO 90 0,0`).

### Comandos

| Grupo | Comandos (atalho) |
| --- | --- |
| Desenho | LINHA (L), POLILINHA (PL), RETANGULO (REC), CIRCULO (C: centro e raio/diâmetro, 2P, 3P), ARCO (A: 3 pontos ou centro), POLIGONO (POL: inscrito, circunscrito, aresta), ELIPSE (EL), TEXTO (T/DT, várias linhas), COTA (DIM) |
| Modificar | MOVER (M), COPIAR (CO, várias cópias), ROTACIONAR (RO, cópia e referência), ESCALA (SC, cópia e referência), ESPELHAR (MI, apaga ou não a origem), DESLOCAMENTO (O, distância ou através), APARAR (TR), ESTENDER (EX), CONCORDAR (F, raio), CHANFRAR (CHA), QUEBRAR (BR), UNIR (J), ESTICAR (S), MATRIZ (AR, retangular e polar), EXPLODIR (X), APAGAR (E), FECHAR, PINCEL (MA) |
| Consulta e vista | DIST (DI), AREA (AA, por pontos ou objeto), ID, LISTAR (LI), ZOOM (Z: janela, extensão, anterior, `2x`), DESFAZER (U), REFAZER |
| Arquitetura | PAREDE, COMODO, PORTA, JANELA, PASSAGEM, SIMBOLO, MOVEL, IMAGEM, TRACOLIVRE |

Comando de edição usa a seleção feita antes dele; sem seleção, pede "Selecione objetos" e
Enter conclui. Aparar funciona no modo rápido: clica-se no pedaço que deve sumir, todo o
desenho visível é limite, e o que nada cruza é apagado. Esticar pede uma janela cruzada e
move só os vértices dentro dela.

### Seleção, alças e mouse

- Clique acrescenta à seleção; Shift+clique tira.
- Arrastar (ou clicar e clicar) no vazio abre uma janela. Da esquerda para a direita
  (azul) pega só o que está inteiro dentro; da direita para a esquerda (verde, tracejada)
  pega tudo que ela toca, pelo traço de verdade.
- Os objetos selecionados mostram alças azuis. Clique numa alça (ela fica vermelha) e
  clique no destino, ou arraste-a. Arrastar a seleção a move.
- Roda aproxima e afasta no cursor; botão do meio desloca a vista; duplo clique nele
  enquadra o desenho.
- Cursor em cruz, com a caixinha de seleção quando o clique escolhe objetos. O encaixe
  mostra o marcador do AutoCAD: quadrado no extremo, triângulo no meio, círculo no
  centro, losango no quadrante, xis na interseção, esquadro na perpendicular.

### Barra de status

Grade (F7), Malha (F9, encaixe na malha), Orto (F8), Polar (F10, direções a cada 45°, com
linha de rastreio), Encaixe (F3, liga e desliga o encaixe a objetos; os tipos ficam no
painel da esquerda) e Dinâmica (F12, prompt, medida e texto digitado ao lado do cursor).
Orto e Polar não andam juntos. Retângulo e janela de zoom ignoram a trava, como no AutoCAD.

Camadas: filtro por nome, mostrar/esconder todas, só as filtradas, isolar, cor, tipo de
linha, disciplina, renomear, selecionar tudo da camada e apagar camada vazia. Cada elemento
pode ter cor e tipo de linha próprios ("da camada" por padrão). Fundo escuro opcional.

## Desempenho

Planta com mais de 2 mil elementos visíveis é pintada em canvas, só o que está na tela e
com os traços da mesma aparência num caminho só; o SVG fica com seleção, cursor, alças e
prévias. O movimento do ponteiro e a roda do zoom são processados uma vez por quadro. O
encaixe usa um índice por elemento (os segmentos de cada um só são calculados quando o
cursor passa perto) e olha no máximo os 48 segmentos mais próximos. Cada edição valida só
o que mudou, e só o índice da versão atual fica na memória. Medido com uma planta de 26
mil elementos: colocar na prancha em 0,7 s, 60 s de uso contínuo sem pausa acima de 80 ms
e memória estável. A linha de comando, o cursor em cruz e os marcadores
ficam no SVG leve por cima; a prévia de um comando de edição mostra até 300 objetos.

## Gravar

Revisão otimista: quem grava declara a revisão que abriu, e o servidor recusa se outra aba
gravou antes. Desenho grande vai e volta comprimido em gzip (o teto de corpo das funções é
4,5 MB) e é guardado comprimido no banco. Ctrl+S grava de qualquer lugar do editor.
