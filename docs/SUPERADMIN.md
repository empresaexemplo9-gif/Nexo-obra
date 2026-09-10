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

## Ambiente de manutenção

A manutenção continua existindo como sempre: login próprio em `/manutencao`, credenciais
separadas e uma organização interna reservada, à qual o administrador de manutenção fica
confinado — ele não alcança nenhuma empresa contratante, mesmo escolhendo uma.

O superadmin também opera esse ambiente, com mais recursos:

| Recurso | Manutenção | Superadmin |
| --- | --- | --- |
| Entrar no ambiente interno | com a senha de manutenção | pela sessão da plataforma, sem essa senha |
| Módulos do ambiente interno | todos | todos |
| Criar o ambiente se ainda não existe | sim, no primeiro login | sim, ao abrir pelo painel |
| Trocar para uma empresa contratante | não | sim, sem sair da sessão |
| Cadastrar empresa e convidar contratante | não | sim |
| Controlar acesso e ler o histórico do ambiente interno | não | sim |
| Assinatura e parceiros no ambiente interno | não se aplica | não se aplica |

`POST /api/superadmin/maintenance` cria o ambiente quando necessário, grava
`platform.maintenance_opened` e devolve o cookie de seleção. O ambiente interno nunca é o
destino padrão do superadmin: sem escolha explícita, ele cai em uma empresa contratante.
Ele também não entra nas contagens de empresas do painel — aparece em bloco próprio.

No painel “Assinaturas, parceiros e acessos”, escolher o ambiente de manutenção mostra
somente controle de acesso e histórico. Assinatura e convite de parceiro seguem recusados
no servidor, porque ali não existe contratante.

## Limites que continuam valendo

- O membro reservado nunca é alcançado por um login comum, mesmo com o mesmo e-mail:
  a busca de vínculos exclui o papel `superadmin`. Só a senha do painel abre esse acesso.
- Ele não aparece na equipe da empresa, não ocupa vaga, não recebe convite e não pode ser
  substituído pelo aceite de um convite.
- O superadmin não cria empresas pelo onboarding do contratante; usa o painel.
- O superadmin não assume a identidade de um cliente do portal.
- O administrador de manutenção não alcança nada do painel da plataforma: todas as rotas
  `/api/superadmin/*` respondem 401 para a sessão dele.

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
