# Adicionar um formato CAD

1. Implemente `FormatAdapter` de `lib/cad-formats.ts` em um módulo próprio. `detect` recebe no máximo 64 KiB e retorna confiança de 0 a 1; nunca use apenas a extensão.
2. Converta somente dados. Não execute scripts embutidos nem busque URLs contidas no arquivo.
3. Retorne camadas, elementos validados, unidade, avisos, truncamento e `ImportReport`. Identifique perdas e aproximações explicitamente.
4. Registre o adaptador em `createFormatRegistry`. Atualize `FORMAT_SUPPORT` com o nível de suporte comprovado.
5. Cubra arquivo válido, vazio, corrompido, extensão incorreta, limites e dados maliciosos. Não declare suporte completo com base em um arquivo mínimo.

O pipeline atual roda no servidor para NEXO e DXF. DWG usa LibreDWG em WebAssembly, com diretório temporário exclusivo, limite de tempo e tamanho; opcionalmente pode usar um serviço HTTP externo. Antes de adicionar outros parsers pesados, mantenha o mesmo isolamento e limites. A interface atual ainda não oferece importação incremental nem fila.
