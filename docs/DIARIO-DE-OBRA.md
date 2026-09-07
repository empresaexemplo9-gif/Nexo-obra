# Diário de obra

O item 4 está disponível no menu **Diário de obra** (`/?module=diary`) e na aba **Diário e registros** da central de cada projeto. Não há preenchimento demonstrativo. É necessário cadastrar uma obra/projeto real antes do primeiro registro.

## Uso

1. Escolha a obra e crie um registro com data, clima, quantidade de pessoas e atividades realizadas.
2. Classifique e descreva ocorrências, quando houver. O autor e o horário de registro são definidos pelo servidor.
3. Após salvar, anexe até 12 fotos por registro, uma por envio, com legenda opcional. Aceita JPEG, PNG e WebP de até 5 MB por foto. Não aceita HEIC, SVG, vídeos ou documentos.
4. Corrija pelo botão **Corrigir registro**, informando o motivo. A versão anterior continua consultável no histórico. Não há exclusão ou substituição de fotos nesta entrega, para preservar o arquivo original e sua autoria.
5. Filtre obra, período, texto (busca da plataforma) ou registros com ocorrências e abra **Relatório / PDF**. O relatório autenticado contém até 31 registros, incluindo fotos, revisões atuais, IDs e horários; a opção de impressão do navegador permite salvar PDF. Reduza o período para relatórios maiores.

Cada colaborador que mantém a tela aberta recebe atualizações por consulta automática a cada 15 segundos. A consulta pausa em abas ocultas. Isso não é WebSocket, notificação push ou suporte offline; sem conexão, os envios não são confirmados e a tela informa a falha. Listagens têm 20 registros por página, e o histórico carrega 20 revisões por vez.

## Autorização

`diary.view` libera leitura, fotos e relatórios. `diary.edit` libera criação, correção e envio de fotos (edição implica leitura). O contratante configura essas caixinhas em **Equipe**. Proprietários têm acesso; o modelo de administrador inclui o módulo. Matrizes secundárias já personalizadas não recebem automaticamente acesso a esse novo módulo. Gestores, colaboradores, parceiros, prestadores, financeiro e contabilidade precisam da liberação explícita do administrador.

O administrador de manutenção acessa apenas sua organização interna; se já estava conectado antes desta atualização, deve sair e entrar novamente para atualizar sua matriz de administrador. O superadmin não recebe acesso aos diários das empresas contratantes.

O escopo desta entrega é a empresa: quem recebe permissão de Diário pode consultar os diários das obras dessa empresa. Não há ACL por obra ou acesso do cliente final nesta entrega. A lista de seleção do diário retorna somente ID, código e nome dos projetos, sem liberar orçamento, clientes ou dados financeiros para quem não possui essas permissões.

## Persistência e integridade

- `site_diary_entries`: conteúdo atual, empresa, projeto, autor, revisão e horários.
- `diary_revisions`: snapshots completos e imutáveis pela API, com autor da correção e motivo. A restrição única de registro/revisão impede sobrescrita concorrente. Conteúdo, revisão e auditoria usam uma transação D1. Registros anteriores à funcionalidade são preservados na primeira correção, sem migração destrutiva.
- `diary_photos`: empresa, registro, posição, legenda, autor, tipo, tamanho, chave privada e SHA-256. Os bytes originais ficam no R2 `FILES`; o servidor valida limite e assinatura de formato, além do MIME. Não se trata de varredura antivírus ou certificação do conteúdo.
- O identificador de criação e de envio é estável durante a tentativa: repetição de uma requisição confirmada não cria outro registro/foto. Payload diferente com a mesma chave é rejeitado. As fotos são enviadas após o texto; uma falha de upload não apaga o registro.
- Leitura de foto exige sessão, aceite dos termos, permissão e empresa compatível com o registro e o arquivo. Não há URL pública do bucket; respostas usam `private, no-store` e `nosniff`.
- O hash identifica os bytes arquivados. Autoria autenticada, histórico e hash não equivalem a assinatura digital certificada ou garantia de validade jurídica. Assinatura do cliente, retenção/exclusão administrada e antivírus continuam pendentes.

## API

| Rota | Operação |
| --- | --- |
| `GET /api/diary` | Lista por `projectId`, `from`, `to`, `q`, `occurrencesOnly`, `page` |
| `POST /api/diary` | Cria com UUID idempotente `id` e campos do registro |
| `GET /api/diary/projects` | Nomes/códigos das obras e fuso da empresa |
| `GET /api/diary/:entryId` | Conteúdo, fotos e revisões; `historyBefore` pagina o histórico |
| `PATCH /api/diary/:entryId` | Corrige com revisão esperada e motivo obrigatório |
| `POST /api/diary/:entryId/photos` | Multipart `id`, `photo`, `caption`; corpo com limite medido durante a leitura |
| `GET /api/diary/:entryId/photos/:photoId` | Original privado |
| `GET /api/diary/report` | HTML imprimível com os filtros da listagem, sem truncamento silencioso |

Os testes `tests/diary-api.test.mjs` executam as rotas reais, a autenticação e todas as migrações em SQLite em memória, com transporte D1/R2 substituído. Cobrem isolamento, caixinhas de leitura/edição, sessão/termos, idempotência, concorrência, rollback, fotos, histórico legado, paginação e escape do relatório. Não são uma homologação de carga ou teste visual em dispositivos reais.

Referências de implementação: [transações em batch do D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) e [API Workers do R2](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
