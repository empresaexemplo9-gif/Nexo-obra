# Revisão da plataforma — 20/09/2026

Base: `de0696b`. Inventário de código, contratos de API, testes e diagnóstico público. O health de produção confirmou banco, sessão, superadmin e armazenamento `ok`, com 21 migrações aplicadas e nenhuma pendente. A sessão empresarial no navegador ainda não está autenticada; operação real dentro da conta não está homologada por esta revisão.

## Inventário por módulo, antes das correções

| Módulo | Existe | Falha ou complemento imediato | Ampliações que permanecem no produto |
| --- | --- | --- | --- |
| Visão geral/acesso | Sessão, seleção de empresa, indicadores e permissões | Carregamento pede membros para CRM sem permissão Equipe e tarefas para Cronograma sem permissão Tarefas; uma falha aborta todos os dados. Rever ações de escrita sem permissão na tela. | Recuperação de senha por canal verificado; procedimento de restauração testado. |
| CRM/clientes | CRUD na API, funil e conversão | Tela não oferece edição do cliente nem dos dados de uma oportunidade; responsável/seguimento ficam presos ao cadastro inicial. Conversão deve respeitar permissão Projetos. | Etapas configuráveis, histórico comercial visível e importação de contatos. |
| Projetos/obras | CRUD na API, central, tarefas/diário/portal contextualizados | Falta edição geral na interface; PATCH não valida ordem de datas contra o estado atual. | Entregáveis, medições, compras, fornecedores, encerramento e previsto x realizado. |
| Tarefas | CRUD, responsável, descrição, prioridade e prazo na API | Tela apenas conclui: falta editar/reabrir/filtrar. PATCH admite ciclos, dependência entre projetos e período invertido. | Checklists, apontamento de horas de trabalho e recorrência. |
| Cronograma | Datas e dependência única por tarefa | Validar dependências no servidor e acrescentar linha do tempo. | Recálculo persistente de rede completa, calendário útil, caminho crítico, curva S. |
| Orçamentos | Versões, biblioteca, itens, BDI/margem e bloqueio no servidor | Interface oferece aprovar rascunho, mas servidor exige enviado; após envio não oferece aprovação. Botões de adicionar permanecem visíveis em versão imutável. | Cópia de versão, impressão de proposta, edição de itens em rascunho; aceite de cliente integrado ao orçamento. |
| Arquivos | Upload privado cifrado, metadados, download e exclusão | `event.currentTarget.reset()` depois de await provoca falso erro após upload. Bloquear repetição durante upload/exclusão. | Pastas, cadeia explícita de revisões, busca por metadados e política de retenção. |
| Equipe | Perfis, convites e matriz de acesso | Não consultar convites quando não pode administrar; expor carga estimada quando tarefas estiverem autorizadas. | Edição de capacidade e membros ativos, planejamento de alocação e afastamentos. |
| Diário | Registros, correções, fotos privadas, relatório | Executar regressões de autorização, revisão e armazenamento. | Assinatura vinculada ao diário e envio programado de relatórios. |
| Portal | Convites, publicação seletiva, decisões e ajustes | Executar regressões de isolamento, expiração e decisão idempotente. | Documentos arbitrários e integração de aprovações com orçamento. |
| Financeiro/Drap | Adaptador, centro de custo, cobrança, webhook e conciliação de eventos | Homologação ao vivo depende de credencial/tenant, não apenas build. Nenhuma transação financeira será criada como teste de produção. | Completar fluxos apenas sobre contratos homologados do fornecedor. |
| SINAPI | Ingestão retomável e ativação com conferência | Validar fonte real e amostra de preços com superadmin; a declaração do README não comprova homologação atual. | Composições e cobertura adicional conforme fonte/licença disponível. |
| Planilhas/documentos | Fórmulas, modelos, CSV/colagem, receitas, validação, cores condicionais, resumo agrupado, gráficos de barras/linhas e XLSX de valores | Regressão de persistência, permissões, revisão, precisão e limites de arquivos. | XLSX com fórmulas executáveis/objetos/estilos completos, pivô multidimensional, novos tipos de gráfico e colaboração simultânea. |
| Prancheta | CAD 2D, NEXO/DXF/DWG, camadas, exportação e encaixes | Executar suíte geométrica e de interface, sem declarar compatibilidade não existente. | BIM/3D/GIS, colaboração, estilos/layouts avançados e demais itens de `cad-implementation.md`. |
| Lembretes/metas | Agenda por acesso, metas e ações | Regressões de permissão e cálculo; dependem dos dados reais disponíveis. | Notificações externas mediante canal configurado e consentimento. |
| Tempo de uso | Heartbeat, histórico por pessoa/empresa | Validar isolamento e medição no servidor. Tempo online não equivale a horas produtivas. | Apontamento de trabalho por atividade como recurso separado. |
| Superadmin/manutenção | Empresas, acesso, auditoria, migrações e diagnóstico | Validar poderes do superadmin e isolamento da manutenção. | Recuperação operacional/backup e homologação com empresa piloto. |

## Critério de entrega

Cada correção exige API real, autorização por empresa, teste de sucesso e erro quando afeta regra crítica, tipagem, lint, compilação e implantação do mesmo commit. Os complementos externos ou de grande porte permanecem explicitamente abertos; este relatório não certifica equivalência integral com Excel, CAD/BIM ou ERP.

## Execução

Inventário concluído e apresentado antes das alterações. Implementações desta revisão:

- **Acesso e visão geral:** cada consulta carrega independentemente. Uma falha aparece nos módulos que dependem daquele dado, sem impedir abrir os demais. A visão geral não apresenta zero como se uma consulta com erro tivesse retornado vazia. CRM não consulta membros sem permissão de Equipe.
- **Clientes e CRM:** cadastro/edição de contato e edição da oportunidade, incluindo valor, probabilidade, responsável, próximo passo e data. Etapas existentes e responsáveis fora da lista são preservados. Conversão exige permissão de Projetos.
- **Projetos e obras:** edição de nome, fase, situação, avanço e datas pela central do trabalho; criação e atualização recusam períodos invertidos. Ações de criação obedecem à permissão.
- **Tarefas:** edição e reabertura, busca e filtro de situação; servidor valida períodos, ciclos, vínculo no mesmo projeto e mudança de projeto com dependentes. Erros mantêm o formulário disponível para correção.
- **Cronograma:** linha do tempo recolhível e rota própria de leitura para usuários autorizados apenas ao cronograma. Não expõe descrições ou libera edição de tarefas por essa rota. Datas conflitantes são sinalizadas; não há recálculo automático.
- **Orçamentos:** corrigida a sequência rascunho → enviado → aprovação/recusa. Inclusão fica restrita a rascunhos. Cópia cria uma nova versão em rascunho, com novos IDs, hierarquia preservada, transação e auditoria; limite de 2.000 itens. Proposta para impressão/PDF contém preços e texto escapado, sem custos/margem internos. Falha ou troca rápida de versão não exibe itens de outra versão.
- **Arquivos:** envio guarda a referência do formulário antes de aguardar a resposta; conclusão limpa o formulário corretamente. Controles bloqueiam repetição durante envio/exclusão.
- **Equipe:** leitura não chama a rota restrita de convites. Carga estimada reúne tarefas abertas, estimativas ausentes e tarefas sem responsável, somente para quem pode ler tarefas. Não representa horas trabalhadas.
- **Prancheta e qualidade:** corrigido o link interno que bloqueava o lint global e o CI anterior. Comparação de migrações normaliza CRLF/LF, sem alterar SQL nem o banco.

## Evidências e limites

- Suíte global inicial: 718 testes, com 717 aprovados; a única falha foi a comparação de fim de linha do manifesto, corrigida e revalidada. Ela cobriu também diário, portal, mídia, permissões, planilhas, CAD, uso e integrações simuladas.
- Regressões desta revisão: 46 testes distintos aprovados nos grupos de prontidão, permissões, migrações e interface. Incluem recusa de ciclos, datas invertidas, isolamento de orçamento, acesso restrito, reabertura, hierarquia de cópia, conclusão de upload, falha de edição e falha no carregamento de itens.
- Tipagem e lint globais verificados localmente. Compilação de produção e suíte completa são exigidas novamente no GitHub antes da promoção para `main`; os resultados finais ficam nos checks do pull request.
- Conferência visual com componentes reais em prévia local, dados de teste e largura de 320 px: tarefas, formulário comercial, orçamento e edição de projeto; cronograma com agrupamento e dependências. Prévia removida antes do build de produção.
- Nenhuma migração nova, dependência nova ou dado de demonstração introduzido em produção. Não foram criadas cobranças, convites reais ou decisões de clientes como teste.
- O health de produção valida disponibilidade, não substitui homologação dos fluxos autenticados. Drap/Empresa exige credenciais e contrato homologados; SINAPI exige conferência de referência real; envio externo exige canal definido. Esses recursos não foram declarados homologados por testes simulados.
- As listas atuais mantêm seus limites existentes (até 100 projetos e 200 tarefas). Paginação global, colaboração simultânea, resolução de conflitos de edição e automações recorrentes de negócio continuam como trabalho de produto.

## Ordem de implementação restante

1. Planilhas: ampliar a compatibilidade XLSX além de valores, pivô multidimensional, colaboração e automações programadas com histórico de execução. As receitas atuais são selecionáveis e executadas manualmente.
2. Operação: entregáveis, checklists, horas por tarefa, capacidade editável, revisões de arquivos e paginação. Medições/compras/fornecedores exigem entidades e regras próprias, não apenas novas telas.
3. Comercial: etapas configuráveis, histórico de atividades e aceite do cliente associado a uma versão imutável de orçamento.
4. Planejamento: calendário útil, recálculo com prévia dos impactos, caminho crítico e curva S baseada em medições.
5. Homologação externa e operação: Drap/Empresa e SINAPI real, canais de notificação, recuperação de acesso e ensaio de restauração de backup.
6. CAD/BIM: seguir as lacunas do inventário especializado em `cad-implementation.md`, sem apresentar CAD 2D como BIM completo.

Esta entrega corrige as falhas imediatas e acrescenta os recursos acima. Os itens restantes não foram implantados e não estão contabilizados como concluídos.

## Ampliação de planilhas e segurança

- Validação por intervalo: lista selecionável, limites numéricos inclusivos, data real AAAA-MM-DD e preenchimento obrigatório. O painel lista erros; a grade os marca; API recusa gravação inválida sem mudar a revisão. Até 20 regras.
- Formatação condicional: maior/menor, igualdade, texto e vazio; quatro cores, última regra prevalece, até 20 regras. Usa resultados calculados.
- Tabelas dinâmicas de um agrupamento: soma, média, contagem, mínimo e máximo, até 10 resumos persistidos. Gráficos de barras e linhas com zero e valores negativos; tabela completa acessível e cópia dos resultados. Gráficos mostram os primeiros 40 grupos e informam esse limite; a tabela inclui todos. Erros de fórmula impedem um resumo enganoso.
- Regras e resumos acompanham inserção/exclusão de linhas/colunas e desfazer/refazer. Exclusão de toda a referência remove a regra; excluir a coluna de agrupamento/valor remove o resumo.
- XLSX de valores com prévia por aba, substituição local reversível e gravação posterior. API exige edição para importar e leitura para exportar, oculta planilhas não autorizadas e recusa exportação de revisão desatualizada. Limites, perdas de compatibilidade e resultados de fórmulas aparecem na interface. Sem macros nem vínculos externos. Valores textuais como 00123 e números em notação científica são preservados.
- ExcelJS 4.4.0 adicionado somente no servidor: o leitor seletivo SINAPI existente não cobre edição/exportação de arquivos XLSX. ZIP verifica tamanho real, CRC e limite total antes do parser; a exportação não executa fórmulas recebidas.
- Revisão de dependências: Next.js/eslint-config-next 16.3.5 e dependências transitivas corrigidas. Override de uuid 11.1.1 para a dependência ExcelJS, mantendo CommonJS e API v4 compatíveis. `npm audit --omit=dev` retornou zero vulnerabilidades conhecidas após a atualização.
- Esta fase não exige migração SQL. Configurações ficam no conteúdo versionado da planilha. Não foram inseridos dados fictícios em produção. A lista dos outros módulos e homologações continua aberta conforme o inventário acima.
