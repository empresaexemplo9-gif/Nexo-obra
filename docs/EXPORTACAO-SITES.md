# Exportação do OpenAI Sites: o que veio e o que aproveitar

O projeto rodava no OpenAI Sites (`nexo-obra.thiagohcarvalho09.chatgpt.site`, versão 18,
Cloudflare Workers + D1 + R2). Em 11/09/2026 o titular exportou aquele ambiente inteiro —
código, histórico Git e banco — e determinou a continuidade aqui, com o GitHub como
repositório oficial.

Este documento registra o que a exportação continha e o que dela ainda vale, para que
ninguém repita a conferência nem aplique o pacote por cima do que já está no ar. **A
exportação não é uma base a restaurar: é um ponto de comparação, e a comparação já foi
feita.**

## Conclusão

Nada da exportação precisa ser aplicado. O código do Sites já está inteiro neste
repositório e o banco exportado não tem registro de negócio nenhum. O ambiente do Sites
está superado de fato, não só de intenção: o `main` já compila este repositório.

## Onde a aplicação está rodando

A exportação avisa para não confundir código no GitHub com publicação, e o aviso já foi
atendido antes desta conferência. O `vercel.json` do `main` declara `framework: nextjs` e
`buildCommand: npm run build`: **a Vercel compila este repositório**, e o encaminhamento
para `nexo-obra.thiagohcarvalho09.chatgpt.site` que existia no `main` antigo saiu junto com
o commit `5603576`. O alvo do OpenAI Sites, e com ele o D1 que a exportação leu, deixou de
ser o que serve o endereço oficial.

A prova de que o build funciona fora da máquina de desenvolvimento é a publicação de
pré-visualização que a Vercel gerou para o ramo desta conferência: ela compilou e chegou a
**Ready**.

O que continua sem confirmação de dentro desta sessão é o estado do ambiente de produção em
si — qual commit está servindo, quais variáveis estão configuradas e quantas migrações o
banco já recebeu. A saída de rede para `vercel.app` está bloqueada aqui e o conector da
Vercel responde `403` para este escopo. Quem tem o painel confere isso em `/superadmin`, no
selo **Versão no ar**, e em **Atualizar banco de dados**, na sequência descrita em
[Publicação](PUBLICACAO.md).

## Código: o Sites não tinha nada que o repositório não tenha

O HEAD publicado no Sites era `03528e9`, uma mesclagem feita sobre o commit `8f82b3e`
deste repositório. As duas árvores têm o mesmo hash:

```
03528e9 (HEAD do Sites)  ->  f5661d25d4ad946f16c94d9ca2be13fcb78245ad
8f82b3e (neste histórico) ->  f5661d25d4ad946f16c94d9ca2be13fcb78245ad
```

Árvore igual quer dizer conteúdo igual, arquivo por arquivo. `8f82b3e` é ancestral do
`main`, que está 18 commits à frente dele. Conferindo os 298 arquivos do pacote contra
o repositório:

| Resultado | Arquivos | Leitura |
| --- | --- | --- |
| Idênticos | 244 | o mesmo conteúdo, só com fim de linha diferente (CRLF no pacote) |
| Diferentes | 45 | o repositório avançou depois: Next.js, libSQL, Vercel Blob, login próprio |
| Ausentes aqui | 9 | a camada da Cloudflare/Sites, removida de propósito |

Os 9 ausentes são `worker/index.ts`, `vite.config.ts`, `build/sites-vite-plugin.ts`,
`app/chatgpt-auth.ts`, `types/cloudflare-workers.d.ts`, `types/import-meta-glob.d.ts`,
`scripts/build-verified.sh`, `.openai/hosting.json` e `lib/server/diary-storage.ts` (o
bucket R2, hoje `lib/server/storage.ts` sobre Vercel Blob). A troca está descrita em
[Publicação](PUBLICACAO.md).

As 15 migrações do pacote são byte a byte iguais às daqui; o repositório tem uma 16ª
(`0015_organic_machine_man.sql`). O esquema daqui contém o de lá.

A exportação apontou uma falha em `tests/reminders-api.test.mjs` (dispensar lembrete por
dia), causada por o teste calcular a data em UTC e o servidor em `America/Sao_Paulo`. Esse
teste já formata o dia no fuso do servidor neste repositório. A suíte atual passa inteira:
245 testes, com `npm run typecheck` e `npm run build` limpos.

## Banco: 40 linhas, nenhuma de negócio

O D1 exportado tinha 38 tabelas e 40 linhas. **25 das 38 tabelas estavam vazias**, entre
elas todas as de negócio: `clients`, `projects`, `budget_versions`, `budget_items`,
`tasks`, `goals`, `site_diary_entries`, `diary_photos`, `project_files`,
`crm_opportunities`, `financial_charge_requests`, `client_portal_*`, `time_entries`.

As 40 linhas se dividem assim:

| Tabela | Linhas | O que é |
| --- | --- | --- |
| `_platform_migrations` | 15 | registro de migrações daquele banco; o banco de produção tem o seu |
| `usage_sessions`, `usage_days` | 8 | telemetria de tempo de uso |
| `superadmin_login_attempts` | 4 | tentativas de login do portão administrativo |
| `platform_audit_events`, `audit_events` | 4 | trilha de auditoria |
| `organizations`, `users`, `members`, `organization_members` | 6 | o ambiente de manutenção e as duas identidades administrativas |
| `terms_acceptances` | 1 | aceite de termos |
| `organization_invitations` | 1 | um convite de contratante pendente |
| `worksheets` | 1 | uma planilha sem nenhuma célula preenchida |

A organização e os dois acessos administrativos **não são dado a migrar**: o próprio código
os recria. `lib/server/maintenance.ts` grava o ambiente de manutenção com `INSERT OR
IGNORE`, e as identidades do superadministrador e do administrador de manutenção derivam
dos segredos do ambiente, não de linha em tabela.

Sobra a trilha de auditoria daquele ambiente, uma planilha vazia e um convite de
contratante ainda pendente, com validade até 13/09/2026. **Não execute `database/data.sql`
contra o banco de produção.** Se aquele convite fizer falta, emita um novo em `/superadmin`:
o convite antigo só existe no D1 do Sites, e copiar a linha não ajudaria — o `token_hash`
guardado corresponde a um link que não está mais em circulação.

## O que a exportação não trouxe

- **Os quatro segredos administrativos** (`SUPERADMIN_PASSWORD_HASH`,
  `SUPERADMIN_SESSION_SECRET`, `MAINTENANCE_ADMIN_PASSWORD_HASH`,
  `MAINTENANCE_ADMIN_SESSION_SECRET`) vieram nulos: o Sites não revela valor de segredo.
  Eles são configurados no painel de publicação. Consulte [Acesso e senha](ACESSO-E-SENHA.md).
- **O bucket R2**: as ferramentas do conector não listavam objetos. Como `project_files` e
  `diary_photos` estavam vazias, não há registro apontando para arquivo nenhum lá; não dá
  para afirmar que o bucket estava vazio, só que nada no banco dependia dele.
- **O banco de produção (Turso)**: a exportação leu o D1 do Sites, não o Turso. Nada foi
  lido, copiado ou alterado no banco de produção.
- **O esquema exportado foi reconstruído das migrações**, não lido do DDL vivo. Ele confere
  com as colunas exportadas, mas não prova que índices ou gatilhos extras de produção
  fossem idênticos.

## Onde o pacote está

Fora do repositório, com o titular. Ele contém e-mails pessoais, trilha de auditoria e o
`token_hash` de um convite; nada disso pertence ao Git. Este documento é o que fica, porque
é o que ainda responde a alguma pergunta.
