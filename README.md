# Nexo Obra

Plataforma operacional para escritórios de arquitetura, engenharia, reformas e construção civil. A primeira tela prioriza decisões que afetam prazo, caixa e dependências; os módulos mantêm o contexto do cliente e do projeto.

## Estado atual

- painel responsivo com prioridades, trabalhos ativos, funil e resumo financeiro;
- navegação funcional entre projetos, obras, orçamento, cronograma, CRM, financeiro, tarefas, equipe e arquivos;
- criação rápida de projeto na interface demonstrativa;
- modelo relacional multiempresa em D1 com clientes, projetos, tarefas, arquivos e auditoria;
- endpoint de projetos com autenticação, autorização e isolamento por organização;
- limite de integração Drap somente no servidor e fallback de demonstração explícito;
- R2 reservado para arquivos, com metadados relacionais no D1.

## Desenvolvimento

Requer Node.js 22.13 ou superior e pnpm.

```bash
pnpm install
pnpm dev
pnpm build
pnpm db:generate
```

Consulte `docs/ARCHITECTURE.md` antes de adicionar um módulo e `docs/DRAP-INTEGRATION.md` antes de alterar o conector financeiro.
