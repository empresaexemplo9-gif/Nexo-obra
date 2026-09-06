# Backend do Nexo Obra

O backend roda no mesmo domínio da aplicação: `https://nexo-obra-jet.vercel.app`. A interface deve chamar somente caminhos relativos, como `/api/projects`.

## Identidade e isolamento

- O servidor lê `oai-authenticated-user-id` e `oai-authenticated-user-email` da requisição autenticada.
- O membro ativo é localizado no D1 por identificador estável ou e-mail verificado.
- O `organization_id` vem dessa associação; nunca é aceito do corpo, query string ou header criado pelo navegador.
- Toda consulta e toda escrita filtram a empresa ativa.
- `owner`, `admin`, `manager` e `member` operam o núcleo. Exclusões exigem `owner`, `admin` ou `manager`.
- Todas as criações, alterações e exclusões geram evento em `audit_events`.

O superadmin usa uma sessão separada das contas das empresas. O e-mail configurado e o hash PBKDF2 da senha ficam exclusivamente no ambiente de produção. O cookie administrativo é assinado, `HttpOnly`, `Secure` e `SameSite=Strict`; cinco falhas dentro de 15 minutos bloqueiam novas tentativas temporariamente.

## Convites e criação de acesso

- O superadmin escolhe empresa, e-mail e perfil e recebe um link aleatório de uso único.
- O banco armazena somente o SHA-256 do token; o token original aparece apenas na resposta de criação para ser copiado.
- O convite expira em sete dias por padrão e pode ser revogado antes do aceite.
- O usuário precisa autenticar a identidade do mesmo e-mail informado no convite.
- No aceite, o backend cria ou atualiza o membro, registra a associação à empresa e seleciona essa empresa no cookie de sessão.
- Um convite nunca concede o papel `owner`; propriedade continua sendo criada somente no onboarding da empresa.

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
| `GET`, `POST`, `DELETE` | `/api/superadmin/session` | Consulta, cria ou encerra a sessão administrativa |
| `GET` | `/api/superadmin/overview` | Retorna os indicadores globais da plataforma |
| `GET`, `POST` | `/api/superadmin/invitations` | Lista e cria convites individuais |
| `DELETE` | `/api/superadmin/invitations/:invitationId` | Revoga um convite pendente |
| `GET` | `/api/invitations/:token` | Valida e apresenta os dados públicos mínimos do convite |
| `POST` | `/api/invitations/:token/accept` | Cria o acesso após validar identidade e e-mail |

## Respostas de erro

Erros usam o formato `{ "error": "mensagem", "code": "codigo" }`. Validações também devolvem `details` por campo. Os principais estados são `400` para entrada inválida, `401` para login necessário, `403` para associação ou papel insuficiente, `404` para registros fora da empresa e `409` para conflitos.

## Dados e segredos

Clientes, projetos, tarefas, membros e auditoria ficam no D1. Arquivos permanecem destinados ao R2. Credenciais da Drap são lidas somente no servidor e não aparecem nas respostas da API nem no código enviado ao navegador.

O identificador da empresa ativa fica em cookie `HttpOnly`, `Secure` e `SameSite=Lax`. Esse valor é apenas uma preferência: cada requisição confirma novamente que a pessoa autenticada pertence à empresa selecionada.

Os segredos `SUPERADMIN_PASSWORD_HASH` e `SUPERADMIN_SESSION_SECRET` são configurados no ambiente de hospedagem e nunca entram no Git. O endereço de e-mail administrativo não é enviado ao código do navegador até existir uma sessão válida.
