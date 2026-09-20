# Nexo-obra CAD

## Entrega inicial

- núcleo geométrico isolado em `packages/cad-core`;
- linha de comandos integrada à Prancheta (`L`, `C`, `M`, `CO`, `RO`, `SC`, `E`);
- coordenadas e dimensões em milímetros com precisão decimal;
- importação DXF e DWG por conversor isolado configurável;
- formato nativo `.nexo` versionado e validado;
- registro central de formatos e página pública `/formatos`;
- importação sem perda quando identificadores de elementos coincidem.

## Próximas fases

O produto existente não foi reestruturado artificialmente como monorepo. As próximas fases devem evoluir os pacotes de renderização, adaptadores 3D/BIM/GIS, colaboração e cobrança sem quebrar o SaaS já publicado.
