# Comandos CAD

Use o campo **Comando CAD** na Prancheta. Coordenadas em milímetros, x para a direita e y para cima. Casas decimais usam ponto nos pares; `@` indica deslocamento relativo ao ponto anterior.

| Comando | Exemplo | Ação |
|---|---|---|
| L / LINE | `L 0,0 3000,0` | Linha |
| PL / PLINE | `PL 0,0 @3000,0 @0,2000` | Polilinha |
| C / CIRCLE | `C 1000,1000 500` | Círculo |
| DIM / DIMENSION | `DIM 0,0 3000,0 500` | Cota linear |
| M / MOVE | `M @1000,500` | Mover seleção |
| CO / COPY | `CO @1000,500` | Copiar seleção |
| RO / ROTATE | `RO 90 0,0` | Girar ao redor do ponto informado |
| SC / SCALE | `SC 2 0,0` | Escalar ao redor do ponto informado |
| MI / MIRROR | `MI 0,0 0,1000` | Espelhar seleção pelo eixo |
| O / OFFSET | `O 200` | Criar paralela |
| T / TEXT | `T 0,0 200 Sala` | Inserir texto |
| U / UNDO | `U` | Desfazer |
| REDO | `REDO` | Refazer |

Exemplo polar: `PL 0,0 3000<90 @2000,0`. Os comandos M/CO/RO/SC/MI/O usam o elemento selecionado na tela. Camadas bloqueadas são protegidas. Os atalhos de ferramenta existentes fora do campo não mudam.

| Comando adicional | Exemplo | Ação |
|---|---|---|
| REC | `REC 0,0 4000,3000` | Retângulo |
| A | `A 0,0 1000 0 90` | Arco |
| EL | `EL 0,0 2000 1000` | Elipse aproximada por polilinha |
| POL | `POL 6 0,0 1000` | Polígono regular |
| AR | `AR 3 2 1000 1000` | Matriz retangular |
| AP | `AP 6 0,0 360` | Matriz polar |
| E | `E` | Apagar seleção |
| J | `J` | Fechar polilinha |
| TR | `TR 2500,-1000 2500,1000 3800,0` | Aparar pelo limite |
| EX | `EX 6000,-1000 6000,1000 3900,0` | Estender até limite |
| Z | `Z` | Enquadrar desenho |

## Edição na tela

- **F**: linha; **W**: polilinha (Enter conclui); **Q**: retângulo; **B**: seleção por janela de contenção.
- **Shift+clique**: adicionar/remover da seleção; **Ctrl/Cmd+A**: todos os visíveis destravados.
- **Ctrl/Cmd+Z**: desfazer; **Ctrl/Cmd+Shift+Z** ou **Ctrl/Cmd+Y**: refazer; **Delete**: apagar seleção.
- O painel Seleção permite deslocamento X/Y, pivô, ângulo e fator de escala para um ou vários elementos. Os comandos M, CO, RO, SC, MI, O, AR, AP e E usam a seleção inteira. TR/EX exigem um único elemento.
- Paralela tem campo próprio de distância. Na malha, **Livre (sem malha)** mantém coordenadas fracionárias.
- As coordenadas seguem X à direita e Y para cima; ponto decimal nos pares X,Y.
