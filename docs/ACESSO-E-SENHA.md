# Acesso e senha

A plataforma autentica por conta própria. Não depende de borda, provedor externo nem
cabeçalho de identidade para saber quem está do outro lado.

## Como alguém passa a existir

O cadastro acontece no link de convite. O superadministrador (ou um administrador da
empresa, dentro do que ele mesmo tem) cria o convite; a pessoa abre o link, confirma que
é o e-mail convidado, escolhe a senha e aceita os termos. Uma única requisição grava a
credencial, cria o vínculo com a empresa, registra o aceite dos termos e já devolve a
sessão aberta — sem isso, a pessoa criaria a senha e continuaria de fora.

Depois disso, a volta é por `/entrar`: e-mail e senha.

## O que o servidor guarda

- `user_credentials`: e-mail, nome, e a senha só como hash
  `pbkdf2-sha256:100000:<sal>:<digest>` (PBKDF2-SHA256, 100.000 iterações, sal por senha).
  O separador é `:` porque painéis de publicação expandem `$` e mutilam o valor.
- A sessão não fica no banco: é um cookie `__Host-nexo-session` assinado com HMAC-SHA256
  sobre `SESSION_SECRET`, com validade de 12 horas. `HttpOnly`, `Secure`, `SameSite=Lax`
  — Lax porque o acesso chega por link de convite, que é navegação vinda de outro site.
- Cinco senhas erradas na mesma origem bloqueiam por 15 minutos, e o bloqueio vale
  inclusive para a senha correta. E-mail inexistente e senha errada devolvem a mesma
  mensagem, para não revelar quem tem conta.

## Configuração

| Variável | Para quê |
| --- | --- |
| `SESSION_SECRET` | Assina o cookie de sessão. Pelo menos 32 caracteres aleatórios. Sem ele, nenhum login funciona (a rota responde 503 em vez de emitir cookie forjável). |
| `TRUST_IDENTITY_HEADERS` | `true` apenas atrás de uma borda que sobrescreva `oai-authenticated-user-*` em toda requisição. Vazio em qualquer outra hospedagem. |

## Por que `TRUST_IDENTITY_HEADERS` existe

A identidade vinha dos cabeçalhos `oai-authenticated-user-id` e
`oai-authenticated-user-email`. Atrás da borda do ChatGPT isso é seguro, porque a borda
reescreve os dois em toda requisição. Fora dela, não: qualquer visitante envia os
cabeçalhos que quiser e entra como quem quiser.

Hoje o padrão é recusar. Os cabeçalhos só valem quando a hospedagem declara
`TRUST_IDENTITY_HEADERS=true`, e a ordem de resolução é: sessão do superadministrador,
sessão própria, cabeçalhos (se declarados), acesso de manutenção. Nenhuma delas aceita
`organization_id`, papel ou permissão vindos do navegador.

## Sair

`DELETE /api/auth/session` apaga o cookie. É o que o item "Sair" do menu e o botão do
portal do cliente chamam.

## Testes

- `tests/auth-session.test.mjs`: cabeçalho ignorado por padrão, convite que cria senha e
  abre sessão, login, mensagem única para e-mail inexistente e senha errada, bloqueio por
  tentativa, cookie assinado, expirado, forjado e de outro segredo, recusa entre sites,
  formato do hash.
- `tests/ui-auth.test.mjs`: a tela de entrada, o erro visível, o convite que exige senha
  de dez caracteres e confirmação igual, e o aceite de quem já tem sessão.
