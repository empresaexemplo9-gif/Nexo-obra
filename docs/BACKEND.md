# Backend do Nexo Obra

O backend roda no mesmo domínio da aplicação: `https://nexo-obra-jet.vercel.app`. A interface deve chamar somente caminhos relativos, como `/api/projects`.

## Identidade e isolamento

- O servidor lê `oai-authenticated-user-id` e `oai-authenticated-user-email` da requisição autenticada.
- O membro ativo é localizado no D1 por identificador estável ou e-mail verificado.
- O `organization_id` vem dessa associação; nunca é aceito do corpo, query string ou header criado pelo navegador.
- Toda consulta e toda escrita filtram a empresa ativa.
- `owner`, `admin`, `manager` e `member` operam o núcleo. Exclusões exigem `owner`, `admin` ou `manager`.
- Todas as criações, alterações e exclusões geram evento em `audit_events`.

## Rotas

| Método | Caminho | Uso |
| --- | --- | --- |
| `GET` | `/api/session` | Retorna pessoa, empresa ativa e todas as associações permitidas |
| `POST` | `/api/session` | Seleciona uma empresa após validar a associação no servidor |
| `POST` | `/api/onboarding` | Cria uma nova empresa e torna o usuário seu proprietário |
| `GET` | `/api/members` | Lista membros ativos da empresa |
| `GET`, `POST` | `/api/clients` | Lista, busca e cria clientes |
| `GET`, `PATCH`, `DELETE` | `/api/clients/:clientId` | Consulta, altera e exclui um cliente |
| `GET`, `POST` | `/api/projects` | Lista, filtra e cria projetos ou obras |
| `GET`, `PATCH`, `DELETE` | `/api/projects/:projectId` | Consulta, altera e exclui um projeto |
| `GET`, `POST` | `/api/tasks` | Lista, filtra e cria tarefas |
| `GET`, `PATCH`, `DELETE` | `/api/tasks/:taskId` | Consulta, altera e exclui uma tarefa |

## Respostas de erro

Erros usam o formato `{ "error": "mensagem", "code": "codigo" }`. Validações também devolvem `details` por campo. Os principais estados são `400` para entrada inválida, `401` para login necessário, `403` para associação ou papel insuficiente, `404` para registros fora da empresa e `409` para conflitos.

## Dados e segredos

Clientes, projetos, tarefas, membros e auditoria ficam no D1. Arquivos permanecem destinados ao R2. Credenciais da Drap são lidas somente no servidor e não aparecem nas respostas da API nem no código enviado ao navegador.

O identificador da empresa ativa fica em cookie `HttpOnly`, `Secure` e `SameSite=Lax`. Esse valor é apenas uma preferência: cada requisição confirma novamente que a pessoa autenticada pertence à empresa selecionada.
