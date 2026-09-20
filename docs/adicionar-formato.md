# Adicionar um formato CAD

1. Registre capacidades, extensões e estratégia em `lib/cad-formats.ts`.
2. Faça a detecção por conteúdo antes de usar a extensão.
3. Converta o resultado para o `Documento` validado por `documentoSchema`.
4. Retorne avisos explícitos para toda entidade aproximada ou descartada.
5. Cubra arquivo válido, vazio, corrompido e renomeado em teste.
