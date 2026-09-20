# Nexo-obra CAD

## Entrega inicial

- núcleo geométrico isolado em `packages/cad-core`;
- linha de comandos integrada à Prancheta;
- comandos suportados por alias e nome completo: `L/LINE`, `PL/PLINE/POLYLINE`, `C/CIRCLE`, `M/MOVE`, `CO/COPY`, `RO/ROTATE`, `SC/SCALE`, `O/OFFSET`, `MI/MIRROR`, `TR/TRIM`, `EX/EXTEND`, `DIM/DIMENSION` e `E/ERASE`;
- coordenadas e dimensões em milímetros com precisão decimal;
- importação DXF e DWG por conversor isolado configurável;
- formato nativo `.nexo` versionado e validado;
- registro central de formatos e página pública `/formatos`;
- importação sem perda quando identificadores de elementos coincidem;
- validação de camada bloqueada e limites geométricos antes da persistência;
- viewport com zoom e enquadramento auxiliares testados.

## Referência rápida de comandos

| Comando | Exemplo | Ação |
| --- | --- | --- |
| `L` / `LINE` | `L 0,0 3000,0` | Cria parede/linha |
| `PL` / `PLINE` | `PL 0,0 1000,0 1000,1000` | Cria polilinha |
| `C` / `CIRCLE` | `C 1500,1500 500` | Cria círculo |
| `M` / `MOVE` | `M 500,0` | Move a seleção |
| `CO` / `COPY` | `CO 1000,0` | Copia a seleção |
| `RO` / `ROTATE` | `RO 0,0 90` | Gira a seleção |
| `SC` / `SCALE` | `SC 0,0 2` | Escala a seleção |
| `O` / `OFFSET` | `O 150` | Cria paralela |
| `MI` / `MIRROR` | `MI 0,0 0,3000` | Cria cópia espelhada |
| `TR` / `TRIM` | `TR 2000,-1000 2000,1000 3000,0` | Apara até o limite |
| `EX` / `EXTEND` | `EX 4000,-1000 4000,1000 3000,0` | Estende até o limite |
| `DIM` / `DIMENSION` | `DIM 0,0 3000,0 400` | Cria cota |
| `E` / `ERASE` | `E` | Cancela seleção |

## Próximas fases

O produto existente não foi reestruturado artificialmente como monorepo. As próximas fases devem evoluir os pacotes de renderização, adaptadores 3D/BIM/GIS, colaboração e cobrança sem quebrar o núcleo multiempresa da plataforma.

A publicação é feita pelo pipeline já configurado no repositório: alterações na branch principal podem iniciar automaticamente o deploy configurado no provedor de hospedagem. A confirmação final deve ser feita no painel de deploy e no endpoint público da aplicação.
