# Lembretes diários e metas

Todo acesso da plataforma tem lembretes do dia: contratante, administrador, gestor,
colaborador, parceiro, prestador, financeiro, contabilidade, manutenção e superadmin.

## O que entra no lembrete

| Grupo | Origem | Quando aparece |
| --- | --- | --- |
| Cobrança | `financial_charge_requests` com situação `pending` ou `failed` | enquanto a Drap não confirma, ou quando falhou |
| Boleto | `financial_charge_requests` com vencimento | vencido, vence hoje ou vence em até 7 dias |
| Follow-up | `crm_opportunities.next_action_at`, fora de ganho e perdido | próximo passo marcado até 7 dias à frente |
| Tarefa | `tasks.due_at`, ainda não concluída | vencida, vence hoje ou em até 7 dias |
| Meta | `goals` do período em curso | enquanto o realizado estiver abaixo do alvo |

Nenhum lembrete é inventado: cada um aponta para um registro real e **some sozinho**
quando o registro deixa de estar pendente. Pagar o boleto, concluir a tarefa ou bater a
meta remove o lembrete sem nenhuma ação adicional.

## Quem recebe o quê

O conteúdo respeita a permissão do módulo de origem:

- cobrança e boleto exigem leitura em **Financeiro**;
- follow-up exige leitura em **Clientes e CRM**;
- tarefa exige leitura em **Tarefas** para ver as da empresa inteira — mas **a tarefa
  atribuída à própria pessoa sempre chega**, mesmo sem essa permissão, porque um lembrete
  do próprio trabalho não depende de acesso ao módulo;
- meta da empresa exige leitura em **Visão geral**; a meta com responsável definido sempre
  aparece para o responsável;
- meta em dinheiro exige, além disso, leitura em **Financeiro** ou **Orçamentos**.

Nada atravessa empresas: toda consulta filtra pelo `organization_id` resolvido no servidor.

## Dispensar

Dispensar um lembrete vale **só para aquele dia e só para quem dispensou**. O registro de
origem continua pendente no módulo dele, e o lembrete volta no dia seguinte se a pendência
continuar. Isso fica em `reminder_states`, que nunca altera o dado de origem.

## Metas

A meta tem nome, o que medir, alvo, período e um responsável opcional. **O alvo é digitado;
o realizado nunca é** — sai sempre da tabela dona do dado, recalculado a cada leitura:

| Medida | De onde vem o realizado |
| --- | --- |
| Tarefas concluídas | `tasks` concluídas no período |
| Clientes novos | `clients` cadastrados no período |
| Trabalhos entregues | `projects` com situação `done` no período |
| Oportunidades ganhas | `crm_opportunities` em `won` no período |
| Orçamentos aprovados (R$) | soma de `budget_versions.total_cents` aprovados no período |
| Cobranças emitidas (R$) | soma de `financial_charge_requests.amount_cents` do período |

Definir e encerrar meta é do contratante ou de um administrador com edição em Equipe.
Acompanhar é de todo mundo, dentro das regras de visibilidade acima. Encerrar **desativa**
a meta em vez de apagá-la, preservando quem definiu o alvo. Criação e encerramento entram
na auditoria da empresa.

## Onde aparece

No sino do cabeçalho, com a contagem do que está atrasado ou vence hoje, e no módulo
**Lembretes do dia**, agrupado por atrasado, hoje e próximos dias.

## Limite conhecido: não há envio por e-mail nem push

Os lembretes são entregues **dentro do produto**. Este repositório não tem tarefa agendada
(`scheduled`) configurada no Worker nem canal de e-mail ou push, então nada é disparado
para fora enquanto a pessoa não abre a plataforma.

A agenda já é calculada por dia e por acesso, com estado diário próprio, então um envio
externo pode ser ligado depois consumindo a mesma função `dailyReminders` — falta a tarefa
agendada e o provedor de envio, não o cálculo.
