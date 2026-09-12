# Publicação: onde o código roda de verdade

## O que mudou

Até agora existiam dois endereços e só um compilava o repositório:
`nexo-obra-jet.vercel.app` tinha `buildCommand` vazio e reescrevia todas as rotas para
`nexo-obra.thiagohcarvalho09.chatgpt.site`, que era onde a aplicação de fato rodava. Enviar
commit para `main` não colocava nada no ar. Esse foi o motivo real de uma sequência inteira
de funcionalidades parecer não existir: o código estava no GitHub e o site continuava
servindo um build anterior a todas elas, sem nenhum sintoma além de "não mudou nada".

Agora o `vercel.json` declara `framework: nextjs` e `buildCommand: npm run build`, que é
`next build`. O Vercel compila o repositório: **enviar commit para `main` publica**.

Isso exigiu sair de três dependências do runtime da Cloudflare, que só existem dentro do
alvo do OpenAI Sites:

| Antes | Agora |
| --- | --- |
| Banco pelo binding D1 | `@libsql/client` sobre Turso, com a mesma interface (`db/index.ts`) |
| Segredos por `cloudflare:workers` | `lib/server/runtime.ts` sobre `process.env` |
| Fotos num bucket R2 | `@vercel/blob` (`lib/server/storage.ts`) |
| SQL das migrações por `import.meta.glob` (Vite) | `drizzle/manifest.ts`, gerado e conferido por teste |
| Identidade pelos cabeçalhos `oai-authenticated-user-*` | senha e cookie assinado próprios ([Acesso e senha](ACESSO-E-SENHA.md)) |

O build antigo saiu. `vinext`, `wrangler` e `@cloudflare/vite-plugin` foram desinstalados,
e `worker/`, `vite.config.ts`, `build/sites-vite-plugin.ts`, `scripts/build-verified.sh` e
`.openai/hosting.json` foram removidos. O caminho de volta é o histórico do Git, não um
arquivo esquecido no repositório.

`scripts/install-ci.sh` também encolheu: ele baixava e conferia à mão o tarball do vinext
antes de instalar, porque aquele pacote vinha de fora do registro. Agora é `npm ci` com
uma trava para não sobrepor instalações.

## Como saber qual versão está no ar

Entre em `/superadmin`. No topo aparece **Versão no ar**, com o identificador curto do
commit e a data em que aquele bundle foi compilado. O selo é gravado dentro do bundle no
momento do build, então ele descreve o que está servindo — não o que está no repositório.

O selo vem de `env` no `next.config.ts`, preenchido com `VERCEL_GIT_COMMIT_SHA` no build do
Vercel. Se a data tiver dois dias ou mais, o painel avisa que alterações posteriores não
estão naquele build.

## Sequência para colocar uma alteração no ar

1. Commit e envio para `main`. O Vercel compila e publica.
2. Abrir `/superadmin` e confirmar que **Versão no ar** mostra o commit esperado.
3. Se a alteração incluiu migração, usar **Atualizar banco de dados** no mesmo painel.
   Consulte [Atualizar o banco de dados](ATUALIZAR-BANCO.md).

O passo 3 é o que transforma "publiquei" em "está funcionando": o build novo está lá, mas
sem as tabelas as áreas novas respondem `503 database_not_migrated`.

## Variáveis de ambiente

Ficam no painel do Vercel, nunca no repositório. Nunca envie um segredo por conversa: quem
configura é quem tem acesso ao painel.

| Variável | Sem ela |
| --- | --- |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | nada que toque no banco funciona |
| `SESSION_SECRET` | nenhum login de empresa funciona (`503 session_secret_missing`) |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD_HASH`, `SUPERADMIN_SESSION_SECRET` | `superadmin_not_configured`: nenhuma sessão administrativa é emitida |
| `BLOB_READ_WRITE_TOKEN` | as fotos do diário respondem `503 storage_unavailable`; o texto do registro continua salvo |
| `MEDIA_ENCRYPTION_KEY` | nenhuma foto é gravada (`503 storage_unavailable`): subir em claro não acontece por omissão. Gere com `npm run media:key` |
| `TRUST_IDENTITY_HEADERS` | (deixe vazio) os cabeçalhos `oai-authenticated-user-*` são ignorados, que é o correto fora da borda do ChatGPT |

### Fotos do diário: por que vão cifradas

O bucket R2 saiu junto com o runtime da Cloudflare, e com ele a garantia de que o objeto
era inalcançável sem credencial. No Vercel Blob o objeto sobe como **privado**
(`access: "private"`), e a leitura passa pelo token do armazenamento — a URL sozinha não
devolve nada. Isso recupera a garantia que o R2 dava. Guardar a foto em claro mesmo assim
seria apostar tudo numa única tranca, do lado do fornecedor.

Então o que sobe é um envelope AES-256-GCM: cabeçalho `NXO1`, vetor de inicialização de 12
bytes sorteado por objeto, texto cifrado e etiqueta de autenticação. A chave fica em
`MEDIA_ENCRYPTION_KEY` e nunca no armazenamento. Consequências práticas:

- uma URL vazada devolve bytes inúteis;
- um objeto adulterado, truncado ou de outra chave falha na verificação e **não é servido**
  como se fosse a foto, em vez de virar imagem corrompida na tela;
- o objeto sobe como `application/octet-stream`: nem o tipo da imagem é anunciado. O tipo
  real vem do banco na hora de servir;
- cifrar a mesma foto duas vezes dá texto cifrado diferente, então o armazenamento não
  revela que dois objetos são iguais.

A autorização continua nas rotas — empresa, registro e permissão são conferidos antes de
devolver os bytes. A cifra é a segunda tranca, não a primeira.

Gere a chave com `npm run media:key` e configure no painel. **Trocá-la torna ilegíveis as
fotos já gravadas**; o texto dos registros continua intacto. `tests/photo-encryption.test.mjs`
verifica o que fica no armazenamento, não só o que volta.

### Banco de dados

`DATABASE_URL` e `DATABASE_AUTH_TOKEN` vêm do banco libSQL/Turso e ficam nas variáveis do
provedor de publicação. Em desenvolvimento, `DATABASE_URL=file:./local.db` resolve sem
conta nenhuma e sem token.

O adaptador em `db/index.ts` expõe a mesma interface que as 52 rotas e bibliotecas já
usavam, então trocar o provedor de banco não toca no código do produto. Os testes em
`tests/db-adapter.test.mjs` aplicam as 15 migrações num banco libSQL real e verificam
marcadores posicionais, `first`, `all`, `run` e o comportamento transacional do `batch`.

### O hash da senha e a armadilha do `$`

Gere o hash com:

```bash
npm run superadmin:hash -- "sua senha"
```

A saída usa **dois-pontos** como separador:

```
pbkdf2-sha256:100000:<salt>:<digest>
```

Isso não é estética. Painéis de publicação e leitores de `.env` costumam expandir `$`
como variável, e um hash no formato `pbkdf2-sha256$100000$salt$digest` **chega mutilado ao
servidor** — `$salt` e `$digest` viram texto vazio. O login então responde
*"Usuário ou senha inválidos"* mesmo com a senha correta, e nada indica que o problema é
de configuração. Isso foi verificado na prática: o hash chegou com 37 caracteres em vez
de 80.

O separador `$` continua aceito, para não invalidar um hash já configurado. Mas prefira
`:`, que atravessa qualquer expansão intacto.

Se o hash chegar ilegível, o login responde `503 superadmin_hash_invalid` com a instrução,
em vez de fingir que a senha está errada.

### O login não depende do banco migrado

A rota que aplica migrações exige sessão de superadministrador. Se o login dependesse de
tabela migrada, seria um impasse: nem migrar sem entrar, nem entrar sem migrar. Por isso o
portão cria a própria tabela de tentativas quando ela não existe, mantendo o bloqueio por
tentativa em qualquer estado do banco.
