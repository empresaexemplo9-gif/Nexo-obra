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
