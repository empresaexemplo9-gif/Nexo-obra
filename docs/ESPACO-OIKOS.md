# Espaço Oikos

A Oikos é uma empresa contratante que usa a plataforma com a **marca própria**: a
identidade H.OIKOS · Ecossistema para arquitetos, que era a desta plataforma antes do
rebranding para DRAP Backoffice. Os módulos, os dados e as regras são os mesmos de
qualquer empresa; o que muda é a aparência.

## Acesso

| Login | Senha inicial | Papel |
| --- | --- | --- |
| `oikos@admin` | `oikos.admin` | dono da empresa (`owner`), com tudo liberado |

Entra pelo mesmo formulário de `/entrar`. A primeira tentativa com esse login cria,
uma única vez, a empresa **Oikos** (ID fixo `00000000-0000-4000-9000-000000000002`), a conta
e o vínculo de dono (`lib/server/oikos.ts`). Daí em diante é uma conta de empresa comum:
mesma sessão assinada, mesmo bloqueio após cinco erros, mesma auditoria, aceite dos termos
no primeiro acesso, convites e equipe em **Equipe**, e o superadmin enxerga e opera a
empresa no painel como qualquer outra.

Só o hash PBKDF2 da senha fica no código. `OIKOS_ADMIN_PASSWORD_HASH` no ambiente substitui
esse hash antes do primeiro acesso. **Troque a senha pelo menu da conta no primeiro uso**:
depois da troca, a senha inicial deixa de abrir.

O login `oikos@admin` é o único aceito fora do formato de e-mail.

## Marca

`GET /api/session` devolve `marca: "oikos"` quando a empresa resolvida no servidor é a Oikos
(`lib/marca.ts`). A interface aplica `html[data-marca="oikos"]`, e `app/oikos-tema.css` só vale
com esse atributo. O tema é o CSS anterior ao rebranding (commit `4e0b7a1^`), com as classes
renomeadas para as atuais e sem as larguras máximas da área de trabalho. A logo H.OIKOS
(`public/brand/hoikos-*.svg`) sai no HTML junto da DRAP, e o CSS mostra a da marca ativa.

A marca é só aparência: nenhuma permissão depende dela. Para evitar piscar o tema errado, o
último valor fica em `localStorage` (`nexo-marca`) e é aplicado antes da primeira pintura;
sair da conta, abrir outra empresa ou a demonstração volta à marca da plataforma.

Textos de sistema (mensagens de erro, Termos de Uso, relatórios) continuam com o nome da
plataforma.
