# Publicação: onde o código roda de verdade

## Existem dois endereços, e só um compila o repositório

| Endereço | O que faz |
| --- | --- |
| `nexo-obra-jet.vercel.app` | **Não compila nada.** O `vercel.json` tem `buildCommand` vazio e reescreve todas as rotas para o endereço abaixo. É um redirecionador de domínio. |
| `nexo-obra.thiagohcarvalho09.chatgpt.site` | É onde a aplicação roda: o alvo do OpenAI Sites, identificado por `project_id` em `.openai/hosting.json`. |

Consequência: **enviar commit para a branch `main` do GitHub não coloca nada no ar.** O
repositório é a fonte do código, mas quem serve o site é a publicação do OpenAI Sites, que
precisa ser refeita a cada alteração.

Esse foi o motivo real de uma sequência inteira de funcionalidades parecer não existir: o
código estava publicado no GitHub e o site continuava servindo um build anterior a todas
elas, sem nenhum sintoma além de "não mudou nada".

## Como saber qual versão está no ar

Entre em `/superadmin`. No topo aparece **Versão no ar**, com o identificador curto do
commit e a data em que aquele bundle foi compilado. O selo é gravado dentro do bundle no
momento do build, então ele descreve o que está servindo — não o que está no repositório.

Se a data tiver dois dias ou mais, o painel avisa que alterações posteriores não estão
naquele build e lembra que o domínio público não compila o repositório.

## Sequência para colocar uma alteração no ar

1. Commit e envio para `main` (guarda o código, não publica).
2. **Republicar o projeto no OpenAI Sites** — é este passo que gera o bundle novo.
3. Abrir `/superadmin` e confirmar que **Versão no ar** mostra o commit esperado.
4. Se a alteração incluiu migração, usar **Atualizar banco de dados** no mesmo painel.
   Consulte [Atualizar o banco de dados](ATUALIZAR-BANCO.md).

Os passos 3 e 4 são o que transforma "publiquei" em "está funcionando". Sem o 3, o código
não está lá; sem o 4, está lá mas sem as tabelas.

## Variáveis de ambiente

Ficam no ambiente de publicação, nunca no repositório. Sem `SUPERADMIN_EMAIL`,
`SUPERADMIN_PASSWORD_HASH` e `SUPERADMIN_SESSION_SECRET`, o painel responde
`superadmin_not_configured` e nenhuma sessão administrativa é emitida.
