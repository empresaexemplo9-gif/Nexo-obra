# Atualizar o banco de dados

## O problema que isto resolve

`npm run db:generate` **apenas escreve** os arquivos SQL em `drizzle/`. Nada no deploy os
aplica ao banco. Um banco sem as migrações derruba toda funcionalidade que dependa das
tabelas novas — planilhas, liberações de acesso, lembretes, metas e tempo de uso — e a
falha aparecia como um erro genérico, sem dizer o motivo.

Agora a própria plataforma aplica o que falta.

## Atualização automática, de hora em hora

O banco é atualizado sozinho:

- **De hora em hora**, pelo GitHub Actions (`.github/workflows/banco-de-dados.yml`), que chama `GET /api/cron/banco` na plataforma publicada aos 7 minutos de cada hora.
- **Uma vez por dia**, pelo cron da Vercel (`vercel.json`, 06:17 UTC), como reserva. O plano Hobby da Vercel só aceita agendamento diário — um intervalo de uma hora ali faria o deploy falhar —, por isso a hora em hora vem do GitHub.

A rota só responde com `Authorization: Bearer <CRON_SECRET>`. A Vercel envia esse cabeçalho sozinha; no GitHub, configure em **Settings → Secrets and variables → Actions**:

| Tipo | Nome | Valor |
| --- | --- | --- |
| Secret | `CRON_SECRET` | o mesmo valor de `CRON_SECRET` nas variáveis da Vercel |
| Variável (opcional) | `PLATAFORMA_URL` | endereço publicado; padrão `https://nexo-obra-jet.vercel.app` |

O GitHub só executa o agendamento do arquivo que está na `main`. Para testar sem esperar a hora, use **Actions → Atualizar banco de dados → Run workflow**.

### O que o automático aplica, e o que não

- Aplica, em ordem, migração que **só acrescenta**: tabela nova, índice novo, coluna nova (e `PRAGMA optimize`). Isso não toca em dado existente.
- **Não aplica** migração que apaga, renomeia, reconstrói tabela ou mexe em linhas (`DROP`, `RENAME`, `INSERT`, `UPDATE`, `DELETE`, tabela `__new_`). Ela para a fila — as seguintes podem depender dela —, aparece no painel em **Precisa de revisão** com o motivo, e o workflow do GitHub sai com aviso. A aplicação é feita pelo botão do painel depois de alguém ler o SQL.
- Uma trava no banco impede que o agendamento e o botão do painel apliquem ao mesmo tempo; quem chega com a trava ocupada espera a próxima rodada.
- O painel mostra quando foi a última execução automática, de onde veio e o resultado (ou o erro).
- Com o esquema em dia, a mesma chamada confere as tabelas oficiais da GOINFRA (no máximo uma vez a cada 20 horas). Falha lá não derruba a atualização do banco. Consulte [Compras → GOINFRA](COMPRAS.md#goinfra).

## Aplicação manual

1. Entre em `/superadmin`.
2. No topo do painel aparece **Banco de dados**:
   - *em dia* — quantas atualizações estão aplicadas, nada a fazer;
   - *desatualizado* — quantas faltam, quais são, e o botão **Atualizar banco de dados**.
3. Clique no botão. O painel recarrega sozinho ao terminar.

O aviso aparece **mesmo quando o resto do painel falha**, que é justamente o caso quando o
banco está desatualizado. Sem isso, o erro esconderia a solução.

## Por que é seguro aplicar

- Cada migração é registrada em `_platform_migrations` e nunca é aplicada duas vezes.
- Um banco cujas tabelas foram criadas antes deste registro é **reconhecido**: instruções
  que falham por "já existe" são contadas como ignoradas, e nada é recriado. Os dados
  existentes permanecem.
- Qualquer falha que **não** seja de "já existe" interrompe o processo e sobe com o nome da
  migração e o erro. Nenhum problema real é engolido.
- Só a sessão de superadministrador alcança a rota, e pedido de outra origem é recusado.

## Quando o erro aparecer para um usuário comum

Uma rota que encontre tabela ou coluna ausente responde `503` com o código
`database_not_migrated` e a mensagem apontando para o painel, em vez do erro genérico
anterior.

## API

| Método | Rota | Uso |
| --- | --- | --- |
| `GET` | `/api/superadmin/migrations` | Aplicadas, pendentes e total |
| `POST` | `/api/superadmin/migrations` | Aplica as pendentes, em ordem (manual, inclusive as que precisam de revisão) |
| `GET` | `/api/cron/banco` | Atualização automática; só com `CRON_SECRET` |

## Ao criar uma migração nova

Rode `npm run db:generate` e faça o commit do arquivo em `drizzle/` e do `drizzle/manifest.ts`.
Depois do deploy, a migração aditiva é aplicada na próxima hora sem ninguém clicar; a que
altera dado existente aparece no painel para revisão.

## Verificação antes de publicar

`npm test` agora roda `tsc --noEmit` antes do build. O build não faz checagem de tipos —
foi assim que um identificador inexistente chegou a passar — e o typecheck fecha essa
porta.
