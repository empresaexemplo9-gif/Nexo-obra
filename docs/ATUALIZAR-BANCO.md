# Atualizar o banco de dados

## O problema que isto resolve

`npm run db:generate` **apenas escreve** os arquivos SQL em `drizzle/`. Nada no deploy os
aplica ao banco. Um banco sem as migrações derruba toda funcionalidade que dependa das
tabelas novas — planilhas, liberações de acesso, lembretes, metas e tempo de uso — e a
falha aparecia como um erro genérico, sem dizer o motivo.

Agora a própria plataforma aplica o que falta.

## Como usar

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
| `POST` | `/api/superadmin/migrations` | Aplica as pendentes, em ordem |

## Ao criar uma migração nova

Rode `npm run db:generate` e faça o commit do arquivo em `drizzle/`. Não há lista para
atualizar: o módulo embute o diretório inteiro com `import.meta.glob`, então o arquivo novo
entra sozinho e aparece como pendente no painel após o deploy.

## Verificação antes de publicar

`npm test` agora roda `tsc --noEmit` antes do build. O build não faz checagem de tipos —
foi assim que um identificador inexistente chegou a passar — e o typecheck fecha essa
porta.
