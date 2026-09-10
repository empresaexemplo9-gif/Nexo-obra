# Superadministrador da plataforma

O superadministrador é o titular da H.OIKOS. Ele entra em `/superadmin` com credenciais
próprias — e-mail, senha com hash PBKDF2 e sessão assinada — separadas do login das
empresas. A partir dessa sessão ele tem poder total sobre a plataforma.

## O que o superadmin pode fazer

- Cadastrar empresas contratantes e liberar o convite principal do proprietário.
- Abrir qualquer empresa e operar todos os módulos com leitura e edição: visão geral,
  projetos, obras, orçamentos, cronograma, diário, portal do cliente, CRM, financeiro,
  equipe, tarefas e arquivos.
- Bloquear, suspender e restaurar acessos, vincular assinatura e acompanhar indicadores.
- Operar uma empresa mesmo com acesso bloqueado ou assinatura ainda não confirmada,
  que é justamente o cenário em que o suporte precisa entrar.

## Como funciona no servidor

1. `readSuperAdminIdentity` lê a sessão assinada e devolve uma identidade de escopo
   `superadmin`. Sem cookie válido, o pedido segue como acesso comum da empresa.
2. `requireOrganizationContext` reconhece esse escopo e monta o contexto sem exigir
   papel, sem `assertPlatformAccess` e sem aceite de termos, que pertencem ao contratante.
3. A empresa ativa vem do mesmo cookie de seleção usado pelo produto
   (`__Host-nexo-organization`). Sem escolha válida, cai na empresa mais recente.
   Sem nenhuma empresa cadastrada, a API responde `no_organization`.
4. Cada empresa aberta recebe um membro reservado com `external_user_id`
   `platform-superadmin` e papel `superadmin`. Ele mantém a integridade das escritas que
   apontam para `members` (diário, portal, arquivos) e identifica quem operou.

O isolamento multiempresa continua intacto: o superadmin opera **uma empresa por vez** e
toda query recebe o `organization_id` resolvido no servidor. Não existe consulta que
atravesse empresas.

## Limites que continuam valendo

- O membro reservado nunca é alcançado por um login comum, mesmo com o mesmo e-mail:
  a busca de vínculos exclui o papel `superadmin`. Só a senha do painel abre esse acesso.
- Ele não aparece na equipe da empresa, não ocupa vaga, não recebe convite e não pode ser
  substituído pelo aceite de um convite.
- O superadmin não cria empresas pelo onboarding do contratante; usa o painel.
- O superadmin não assume a identidade de um cliente do portal.

## Auditoria

- A primeira entrada em cada empresa grava `platform.superadmin_entered` em
  `platform_audit_events`, com o e-mail do responsável e o horário.
- O cadastro de empresa grava `platform.organization_created`.
- Cada escrita no núcleo operacional segue gravando em `audit_events` da empresa, com o
  autor identificado.

Os Termos de Uso descrevem esse acesso em linguagem simples na seção
“Superadmin e separação dos dados”. Qualquer mudança nesse poder exige nova versão dos
termos e novo aceite.

## Configuração

```dotenv
SUPERADMIN_EMAIL=titular@empresa.com
SUPERADMIN_PASSWORD_HASH=pbkdf2-sha256$100000$<salt>$<digest>
SUPERADMIN_SESSION_SECRET=segredo_longo_e_aleatorio
```

Sem essas três variáveis, `/superadmin` responde `superadmin_not_configured` e nenhuma
sessão administrativa é emitida.
