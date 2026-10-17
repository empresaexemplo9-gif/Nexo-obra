# Propostas

Aba **Propostas** (grupo Trabalho). Segue a permissão de **Orçamentos e propostas**: quem vê
orçamento vê proposta; quem edita orçamento cria, edita, envia e cancela.

## Fluxo

1. **Nova proposta**: de um orçamento (copia os itens e valores; o cliente vem do projeto)
   ou em branco. O número sai sozinho, `PROP-0001` em diante, por empresa.
2. **Editar**: título, cabeçalho, seções antes e depois dos valores (adicionar, renomear,
   reordenar, remover), itens (descrição, unidade, quantidade, valor), desconto, validade e
   fechamento. **Ver como o cliente** mostra o documento exatamente como ele recebe. O total é
   sempre recalculado no servidor.
3. **Enviar**: WhatsApp (`wa.me` com o número do cliente), e-mail (`mailto:` ou Gmail) ou
   copiar o link. A mensagem vem pronta e pode ser editada. Não há provedor de mensagem: o
   envio sai do WhatsApp ou do e-mail do próprio usuário, e a plataforma registra que o canal
   foi aberto com o link — não afirma entrega.
4. **Data e hora**: a proposta é datada no primeiro envio, no fuso da empresa. A validade
   (padrão 15 dias) conta a partir daí. Reenviar não muda a emissão.
5. **Agendar**: escolha data, hora e canal. O link fica fora do ar até o envio. Na hora
   marcada a proposta aparece como “Hora de enviar” nos Lembretes do dia, no sino e no topo da
   aba, com o envio pronto em um clique. Não há disparo automático, porque o envio depende do
   WhatsApp ou do e-mail da pessoa; por isso também não depende de tarefa agendada na Vercel.
6. **Abertura**: quando o cliente abre o link, a equipe é avisada (lembrete, sino e aviso na
   aba aberta). Só conta a abertura no navegador do cliente: a prévia que o WhatsApp e o e-mail
   geram do link não conta, nem a equipe conferindo, nem recarregar em menos de 10 minutos.
7. **Aceite**: o cliente informa nome (e CPF/CNPJ, opcional), confirma que leu e aceita na
   própria página. Ficam registrados data, hash de IP e navegador e uma cópia exata do conteúdo
   e do total aceitos. Se a equipe editar depois que o cliente abriu, o aceite é recusado até
   ele recarregar a versão nova. Proposta aceita fica travada; vencida não aceita; cancelada
   tira o link do ar.

## Link do cliente

`/proposta/<id>.<assinatura>`. A assinatura é HMAC-SHA256 com `SESSION_SECRET` sobre o id e
um `link_nonce` da linha: o link pode ser mostrado de novo para reenviar sem guardar segredo
em claro, e não dá para fabricar link de outra proposta. Página sem indexação e sem
`Referer`.

## Código

- `lib/proposals.ts`: tipos, validação do conteúdo, total, mensagens e links de envio.
- `lib/server/proposals.ts`: link assinado, leitura e formato de resposta.
- `app/api/proposals/**`: lista, criação, edição, cancelamento, envio e agendamento.
- `app/api/proposta/[token]/{view,accept}`: abertura e aceite pelo cliente.
- `app/proposta/[token]/page.tsx`, `components/proposal-*.tsx`, `components/proposals-workspace.tsx`.
- Testes: `tests/proposals-api.test.mjs`.
