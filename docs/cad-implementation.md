# Nexo Obra CAD — implementação incremental

Especificação de referência: `nexo-obra-cad-prompt.md`, fornecida pelo usuário em 19/09/2026.

## Entrega integrada

- Núcleo independente em `packages/cad-core`: pontos, matrizes, rotação, escala, projeção, tangentes, polar e histórico transacional.
- Linha de comando dentro da Prancheta existente: L, PL, C, DIM, M, CO, RO, SC, MI, O, T, REC, A, EL, POL, AR, AP, E, J, TR, EX, Z, U e REDO, com sugestões e exemplos.
- Coordenadas e medidas do esquema aceitam precisão dupla; documentos inteiros existentes permanecem válidos. Encaixes, entrada de medidas, vértices, paralelas, espelhamento e matriz preservam frações; a malha pode ser desligada no editor.
- Registro extensível de importadores com detecção por conteúdo, limites, validação e relatório.
- Documento nativo `.nexo` v1 em JSON; importa geometria/camadas e exporta o documento. Referências privadas de imagens não são aceitas na importação entre documentos: reinsira imagens pela biblioteca autorizada da organização.
- DXF ASCII utiliza o leitor existente. DWG agora chega ao conversor existente, em vez de ser rejeitado antes dele. A resposta do conversor tem limite durante a leitura do stream.
- Mesclagem atômica com identificadores novos para camadas e elementos, sem descartar geometria por colisão de IDs.
- Página `/formatos` apresenta suporte real e alternativas para toda a matriz solicitada.

- Exportação PNG de geometria vetorial, com resolução limitada a 4096 pixels; imagens privadas continuam na exportação SVG.
- Enquadramento e zoom corrigidos, seleção pela geometria e novos encaixes de quadrante, tangente e ponto mais próximo.

## Decisão de compatibilidade

O repositório é uma aplicação Next.js em produção, com organizações, permissões, Turso e Blob. Não é vazio nem descartável. Esta entrega acrescenta CAD à Prancheta sem substituir autenticação, dados ou implantação por outro sistema. Migração para monorepo completo, PostgreSQL, Fastify, Redis e S3 exige uma migração própria com preservação dos dados; não foi executada nesta entrega.

## Pendências da especificação

As onze fases **não estão concluídas**. Permanecem: scaffold completo pnpm/Turborepo; entidades geométricas restantes e índice espacial; comandos interativos avançados restantes; estilos, hachuras associativas, blocos/xrefs e layouts; renderização WebGL; PDF e importadores SVG/PDF, 3D, BIM, GIS e nuvens de pontos; parsers isolados, antivírus, filas/cache e corpus externo licenciado; histórico persistente de desenhos; colaboração Yjs; planos/cobrança; modelagem 3D; infraestrutura e testes de carga/backup da especificação.

O histórico gráfico existente continua limitado a 60 estados e permanece disponível depois de gravar. O núcleo transacional novo não impõe esse limite, mas ainda não substitui o histórico gráfico. Não foram demonstradas as metas de 50 MB/5 s, 500 mil entidades ou 200 usuários simultâneos.

## Verificação

`node --test --test-concurrency=1 tests/cad-foundation.test.mjs tests/prancheta.test.mjs tests/prancheta-cad.test.mjs`

`node node_modules/typescript/bin/tsc --noEmit`

`node node_modules/next/dist/bin/next build --webpack`

Os testes incluem comandos, camadas bloqueadas, precisão, histórico, ida/volta NEXO, conversão DWG, detecção DXF e entrada inválida. A conversão DWG real roda localmente no servidor com LibreDWG em WebAssembly; um serviço HTTP externo pode ser configurado, mas não é obrigatório.

## Revisão das ferramentas — 22/09/2026

- Linha, polilinha aberta/fechada e retângulo por cliques e entrada de medidas; círculos e arcos pelo mesmo fluxo de confirmação.
- Shift+clique adiciona/remove elementos. A ferramenta **Selecionar por janela (B)** contém elementos inteiros; Shift preserva a seleção anterior. Ctrl/Cmd+A seleciona todos os visíveis destravados. Arrastar o espaço vazio continua deslocando a vista.
- Mover, copiar, girar, escalar e apagar a seleção pelo painel; comandos de transformação, paralela e matrizes também atuam no grupo, em uma única etapa de desfazer. Erro em qualquer membro recusa a operação inteira.
- Campo próprio de distância para a paralela, inclusive valores fracionários. Campo de afastamento da cota.
- Alças nas pontas de paredes/cotas; mover a alça inicial de uma polilinha fechada mantém o fechamento.
- Arrasto relativo ao início do gesto, sem encaixe no próprio grupo e sem quantização adicional. Clique sem movimento não cria histórico. Círculos fecham exatamente e o encaixe mais próximo permanece no raio real.
- Criação e escolha de camada para desenho gráfico, transferência da seleção e histórico de visibilidade/bloqueio. Símbolos respeitam a camada luminotécnica efetiva. Camada oculta/travada recusa criação gráfica.
- Limites consideram giro de mobília/imagens e afastamento da cota; seleção de cômodos respeita o polígono real.
- Gravar preserva desfazer/refazer. Alterações realizadas durante uma gravação continuam pendentes; o próximo envio usa a revisão devolvida pelo servidor.

Y positivo nos campos de coordenadas sobe no desenho. Use ponto decimal nos pares X,Y e na linha de comando; o campo de distância da paralela também aceita `0,15m`.

Limites mantidos: 20 mil elementos, 60 camadas, 60 estados de histórico local. Esta revisão não implementa BIM/3D, colaboração simultânea, blocos/xrefs ou novos importadores. As pendências gerais acima continuam explícitas.

Testes adicionais: `tests/cad-editing.test.mjs` e `tests/ui-cad-editing.test.mjs`, incluindo permissão somente leitura, camada travada, operações atômicas, precisão, cliques reais no componente e gravação concorrente com edição local.
