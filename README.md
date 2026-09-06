# Nexo Obra

> Nome provisório. Um SaaS objetivo para escritórios de arquitetura, engenharia, reformas e construção civil.

A identidade visual oficial usa a marca Drap Architector em `public/drap-architector-logo.png`.

Este repositório contém uma fundação executável do produto: interface responsiva, criação e seleção de empresas, dados persistentes com isolamento multiempresa e integração financeira remota com a Drap.

O objetivo não é copiar a Vobi. O objetivo é reunir o ciclo do negócio em um fluxo menor, mais claro e mais previsível:

```mermaid
flowchart TD
    A["Lead e cliente"] --> B["Proposta e orçamento"]
    B --> C["Projeto ou obra"]
    C --> D["Tarefas, prazo e arquivos"]
    C --> E["Custos, cobrança e resultado"]
    E <--> F["Drap · fonte financeira"]
```

## O que já está no código

- Painel “Visão geral” com prioridades, trabalhos ativos, funil e resumo financeiro.
- Áreas navegáveis de projetos, obras, orçamentos, cronograma, CRM, financeiro, equipe, tarefas e arquivos.
- Central própria de cada projeto/obra, com resumo, planejamento, tarefas, custos e registros no mesmo contexto.
- Orçamentos reais com versões por projeto, BDI, margem, itens em lote e biblioteca própria da empresa.
- Financeiro contextual por obra, com centros de custo, contas, cobranças confirmadas pela Drap, lembretes e relatórios CSV.
- Interface responsiva, com menu recolhível e busca.
- Fluxo de criação rápida preparado para virar formulários reais.
- Interface conectada somente a dados reais da empresa ativa, com estados vazios explícitos.
- Esquema relacional multiempresa em `db/schema.ts`.
- Backend multiempresa para sessão, onboarding, membros e CRUD de clientes, projetos e tarefas.
- Acesso superadmin próprio, protegido por hash, sessão assinada e bloqueio de tentativas repetidas.
- Convite principal do superadmin para o contratante e convites secundários administrados dentro de cada empresa.
- Perfis para administrador, gestor, colaborador, parceiro, prestador, financeiro e contabilidade, com matriz de leitura/edição por módulo.
- Termos de Uso versionados, aceite eletrônico registrado e bloqueio do produto até a versão vigente ser aceita.
- Painel do superadmin limitado a metadados e indicadores agregados, sem abrir o conteúdo sigiloso dos ambientes contratantes.
- Acesso de administrador de manutenção em `/manutencao`, com credenciais próprias e ambiente empresarial vazio e isolado.
- Identidade e organização resolvidas no servidor pelos cabeçalhos autenticados da plataforma.
- Permissões por papel e trilha de auditoria para todas as escritas do núcleo operacional.
- Adaptador financeiro exclusivamente no servidor em `lib/integrations/drap.ts`.
- Endpoint financeiro sem fallback fictício: ausência ou falha da Drap aparece como indisponibilidade.
- Adaptador SINAPI exclusivamente no servidor, sem preços demonstrativos quando a fonte oficial não está configurada.
- Webhook Drap com verificação HMAC SHA-256, identificação da empresa e idempotência pelo ID do evento.
- Instruções permanentes para o Claude Code em `CLAUDE.md`.

## Princípios do produto

1. **A primeira tela é uma fila de decisões.** Mostrar o que venceu, bloqueia prazo, afeta caixa ou depende do usuário.
2. **Uma informação tem um único dono.** A Drap é a fonte financeira; esta aplicação é a fonte de projetos, obras, tarefas e documentos.
3. **Contexto antes de módulo.** O usuário entra em um projeto e encontra escopo, cronograma, orçamento, documentos, horas e financeiro relacionados.
4. **Exceção antes de relatório.** O sistema destaca desvios e deixa o detalhamento a um clique.
5. **Cadastro progressivo.** Pedir apenas o necessário em cada etapa; campos avançados aparecem quando passam a ser úteis.
6. **Nenhuma tela sem ação clara.** Cada página deve responder “o que devo fazer agora?”.
7. **Sem conteúdo ornamental.** Nada de cards redundantes, textos de apresentação dentro do produto ou menus criados apenas para parecer completo.

## Módulos e escopo

| Módulo | Fluxo principal | Primeira entrega real |
| --- | --- | --- |
| Visão geral | Entender o dia e agir | Prioridades, desvios, próximos marcos e caixa |
| CRM e clientes | Lead até fechamento | Funil, histórico, próximo contato e conversão em projeto |
| Orçamentos | Custo até aceite | Composições, BDI, margem, versões, proposta e aprovação |
| Projetos | Briefing até entrega | Etapas, entregáveis, horas, responsáveis e resultado |
| Obras | Planejamento até encerramento | Diário, fotos, compras, medições, ocorrências e avanço |
| Cronograma | Planejar e recalcular | Gantt, dependências, responsáveis e previsto x realizado |
| Tarefas | Executar sem perder contexto | Prioridade, checklist, dependência, prazo e apontamento |
| Equipe | Distribuir capacidade | Papéis, permissões, carga e horas planejadas x realizadas |
| Arquivos | Encontrar a versão certa | Pastas por projeto, revisão, metadados e acesso do cliente |
| Financeiro | Ver resultado no contexto | Saldo, contas, caixa e resultado por projeto vindos da Drap |

## Stack escolhida

- TypeScript, React 19 e Next.js 16 compatível com Vinext.
- Tailwind CSS 4 e componentes acessíveis do catálogo Shadcn já incluído.
- Drizzle ORM com SQLite/D1 para os dados operacionais.
- R2 para arquivos binários e D1 para seus metadados.
- API REST interna com validação Zod.
- `fetch` no servidor para a integração remota com a Drap.
- Web Crypto para validação de webhooks.

A arquitetura pode ser adaptada pelo Claude Code para Postgres, Supabase, Neon ou outro provedor. O domínio e os limites entre módulos devem permanecer os mesmos.

## Como abrir no Claude Code

Pré-requisitos: Node.js 22.13 ou superior e npm.

```bash
cd nexo-obra
npm ci
cp .env.example .env
npm run dev
```

Depois, abra a pasta no Claude Code e use este primeiro comando:

```text
Leia CLAUDE.md e README.md por completo. Preserve a arquitetura multiempresa e o limite da integração Drap. Primeiro execute o build e corrija apenas erros reais. Depois implemente a Fase 1 do roadmap, começando pelo fluxo autenticado organização → cliente → projeto → tarefa. Faça mudanças pequenas, valide ao final de cada fatia e atualize o README quando o estado do produto mudar.
```

Comandos úteis:

```bash
npm run dev
npm run build
npm run lint
npm run db:generate
```

## Repositório e publicação

- O código-fonte oficial fica em [empresaexemplo9-gif/Nexo-obra](https://github.com/empresaexemplo9-gif/Nexo-obra).
- O domínio oficial é [nexo-obra-jet.vercel.app](https://nexo-obra-jet.vercel.app). O projeto `nexo-obra` no Vercel está vinculado a esse repositório e funciona como porta de entrada para o runtime Vinext; alterações integradas à branch `main` seguem para produção.
- O projeto também preserva o vínculo com o OpenAI Sites por meio do `project_id` em `.openai/hosting.json`.
- Tokens, chaves e segredos de produção devem ser configurados nos ambientes de publicação. Eles não pertencem ao Git nem ao arquivo de hosting.

## Configuração da Drap

Crie `.env` a partir de `.env.example`:

```dotenv
DRAP_API_URL=https://empresa.drap.app.br
DRAP_API_TOKEN=token_de_servico
DRAP_API_KEY_HEADER=
DRAP_SUMMARY_PATH=/api/v1/finance/summary
DRAP_TRANSACTIONS_PATH=
DRAP_CHARGES_PATH=
DRAP_WEBHOOK_SECRET=segredo_compartilhado
```

### Importante

O site público da Drap informa suporte a API REST e webhooks assinados, mas não expõe a documentação técnica nem confirma os caminhos de endpoint. Por isso:

- `/api/v1/finance/summary` é um contrato configurável de referência, não um endpoint confirmado;
- o token nunca é enviado ao navegador;
- o adaptador aceita nomes de campos comuns em português e inglês, mas deve ser ajustado ao JSON oficial;
- até as credenciais e o contrato real serem fornecidos, a tela informa que a integração está indisponível, sem fabricar valores;
- nenhuma escrita financeira deve ser liberada antes de testes em ambiente sandbox.

Para concluir a conexão real, obtenha da Drap:

1. URL base de API e ambiente sandbox.
2. Método de autenticação e rotação do token de serviço.
3. OpenAPI ou lista oficial de endpoints.
4. Identificador estável da empresa/tenant.
5. Eventos disponíveis e formato da assinatura dos webhooks.
6. Política de rate limit, paginação, erros e idempotência.
7. Campos necessários para centro de custo por projeto/obra.

Veja o contrato recomendado em `docs/DRAP-INTEGRATION.md`.

## Divisão de responsabilidade dos dados

| Dado | Fonte oficial | Uso na Nexo Obra |
| --- | --- | --- |
| Clientes | Nexo Obra, com ID remoto opcional | CRM, projeto, obra e proposta |
| Projetos e obras | Nexo Obra | Contexto central de operação |
| Tarefas, horas e cronograma | Nexo Obra | Planejamento e execução |
| Orçamentos técnicos e versões | Nexo Obra | Composição, BDI, margem e aceite |
| Arquivos e revisões | Nexo Obra | R2 + metadados no banco |
| Lançamentos, contas e saldo | Drap | Consulta remota e vínculo por centro de custo |
| Cobranças, PIX, boleto e nota | Drap | Acionamento remoto após confirmação |
| DRE e conciliação | Drap | Leitura e contextualização por projeto |

## Modelo multiempresa

Toda tabela operacional carrega `organization_id`. Nunca aceite o identificador de organização informado apenas pelo cliente. A API deve derivá-lo da sessão autenticada e verificar a associação do usuário no servidor.

As APIs não aceitam `organization_id` do navegador. A identidade autenticada é associada a um membro no servidor e todas as consultas recebem o `organization_id` dessa associação.

O administrador de manutenção utiliza uma organização interna reservada, criada vazia no primeiro login. A resolução de sessão força esse acesso exclusivamente à organização de manutenção, mesmo que o mesmo e-mail participe legitimamente de outra empresa. Ele não pode aceitar convites de clientes nem criar empresas contratantes.

O backend inicial está documentado em [`docs/BACKEND.md`](docs/BACKEND.md).

Papéis mínimos recomendados:

- `owner`: cobrança, integrações, segurança e acesso total;
- `admin`: equipe, configurações e operação total, sem propriedade da assinatura;
- `manager`: projetos, obras, orçamentos e relatórios;
- `member`: itens atribuídos e módulos liberados;
- `partner`: acesso limitado a projetos específicos;
- `service_provider`: execução operacional com escopo definido pelo contratante;
- `finance`: acesso financeiro configurável para a equipe responsável;
- `accounting`: prestação de contas com leitura ou edição explicitamente liberada;
- `client`: portal externo somente para leitura/aprovação/comentário.

Os papéis são apenas modelos iniciais. A autorização efetiva é a matriz `permissions_json` do membro, validada nas rotas do servidor. Marcar edição também concede a leitura necessária. Somente o `owner` ou um `admin` com permissão de edição em Equipe pode criar e revogar convites secundários.

O texto público vigente fica em `/termos`. Cada aceite grava a versão, data e evidências técnicas transformadas em hash, sem armazenar IP ou agente do navegador em formato bruto. Antes da cobrança comercial, o documento deve receber revisão jurídica e os dados legais do fornecedor, canal de privacidade e condições comerciais do plano.

## Estrutura do projeto

```text
app/
  api/
    clients/            # CRUD de clientes
    budget-library/     # produtos e serviços padronizados da empresa
    budgets/            # versões, composições e importação em lote
    integrations/drap/  # proxy financeiro e webhook
    members/            # equipe da empresa atual
    maintenance/        # sessão do administrador em ambiente isolado
    invitations/        # leitura e aceite de convite individual
    organization-invitations/ # convites secundários e permissões da empresa atual
    onboarding/         # criação segura da primeira empresa
    projects/           # CRUD de projetos e obras
    session/            # identidade e organização ativas
    superadmin/         # sessão, visão global e geração de convites
    tasks/              # CRUD de tarefas
    terms/              # aceite eletrônico da versão vigente
  layout.tsx
  page.tsx
  projetos/[projectId]/ # central contextual de cada projeto ou obra
  superadmin/           # painel global protegido
  convite/              # criação de acesso por link
  termos/               # Termos de Uso públicos e versionados
components/
  nexo-app.tsx          # protótipo funcional dos módulos
  ui/                   # primitivas acessíveis
db/
  index.ts              # acesso centralizado ao banco
  schema.ts             # modelo relacional multiempresa
docs/
  DRAP-INTEGRATION.md
  SINAPI-INTEGRATION.md
lib/
  integrations/drap.ts
  server/backend.ts       # identidade, organização, permissões e auditoria
build/
  sites-vite-plugin.ts
drizzle/
hooks/
public/
scripts/
tests/
vendor/
worker/
  index.ts
.openai/
  hosting.json
CLAUDE.md
```

## Roadmap de implementação

### Fase 1 — núcleo operacional

- Autenticação da plataforma e resolução segura da organização. **Concluído no backend.**
- Superadmin, convite do contratante e convites secundários com permissões granulares. **Concluído.**
- CRUD de clientes, projetos e tarefas. **Concluído no backend.**
- Permissões de leitura/edição por módulo no servidor e auditoria de escritas. **Concluído no backend.**
- Termos versionados e aceite eletrônico obrigatório. **Concluído; revisão jurídica pendente antes da monetização.**
- Interface conectada às queries reais. **Concluído.**
- Central do ciclo de cada projeto/obra. **Concluída para dados-base, tarefas e resumo financeiro da empresa; conexões detalhadas seguem nas fases seguintes.**
- Versões de orçamento, itens, cálculo, biblioteca e inclusão em lote. **Concluído.**
- Testes de isolamento entre duas organizações.

### Fase 2 — comercial e orçamento

- Funil configurável e histórico de atividades.
- Conversão de oportunidade em cliente e projeto sem recadastro.
- Biblioteca de serviços, insumos e composições. **Concluída para cadastro próprio.**
- BDI, margem e versões numeradas. **Concluído no núcleo; bloqueio imutável após envio ainda pendente.**
- PDF de proposta e aprovação digital.
- Importação SINAPI com adaptador pronto, condicionada à licença e às credenciais da fonte oficial escolhida.

### Fase 3 — planejamento e obra

- Etapas, dependências e recálculo do cronograma.
- Diário de obra com fotos, clima, equipe, ocorrências e assinatura.
- Medições, compras, fornecedores e previsto x realizado.
- Cronograma físico-financeiro e curva S.
- Portal enxuto do cliente.

### Fase 4 — financeiro remoto e automações

- Conector Drap homologado em sandbox.
- Vínculo de projeto com centro de custo remoto. **Concluído no produto; homologação Drap pendente.**
- Leitura de saldos e contas por projeto, com relatório CSV. **Concluída no produto; endpoint Drap pendente.**
- Criação remota de cobrança com idempotência e política de lembretes. **Concluída no produto; endpoint Drap pendente.**
- Processador assíncrono de webhook, reconciliação e tela de falhas.
- Alertas úteis: atraso, caixa negativo, margem baixa e tarefa bloqueadora.

## Critérios mínimos antes de produção

- Autenticação, autorização e isolamento multiempresa testados.
- Tokens e segredos somente no servidor e no gerenciador de segredos.
- Rate limiting em autenticação, uploads, criação e webhooks.
- Trilha de auditoria sem dados sensíveis desnecessários.
- Backup, restauração e exportação da conta validados.
- Webhooks com assinatura, idempotência, reprocessamento e dead-letter queue.
- Uploads com limite de tamanho, MIME permitido e varredura de segurança.
- LGPD: base legal, retenção, exclusão, portabilidade e registro de consentimento.
- Monitoramento de erro, latência, sincronização e saúde da integração.
- Teste de acessibilidade e uso real em celular no canteiro.

## Referências funcionais

O recorte funcional foi elaborado a partir das páginas públicas informadas no briefing:

- [Gestão de projetos](https://www.vobi.com.br/funcionalidades/gestao-de-projetos)
- [Gestão de obras](https://www.vobi.com.br/funcionalidades/gestao-de-obras)
- [Orçamento de obra](https://www.vobi.com.br/funcionalidades/orcamento-de-obra)
- [Gestão financeira](https://www.vobi.com.br/funcionalidades/gestao-financeira)
- [Gestão de vendas](https://www.vobi.com.br/funcionalidades/gestao-de-vendas)
- [Gestão de equipes](https://www.vobi.com.br/funcionalidades/gestao-de-equipes)
- [Gestão de arquivos](https://www.vobi.com.br/funcionalidades/gestao-de-arquivos-arq)
- [Gestão de tarefas](https://www.vobi.com.br/funcionalidades/gestao-de-tarefas)
- [Planejamento de obras](https://www.vobi.com.br/funcionalidades/planejamento-de-obras)
- [Drap Empresa](https://empresa.drap.app.br/)

Essas páginas servem apenas como pesquisa de necessidades. O código, a arquitetura, os textos e a interface deste repositório são originais.
