# Ativação Drap Architector e controle de acesso

Esta entrega implementa o lado Architector da integração. O repositório e o contrato de assinatura do `empresa.drap.app.br` não estavam disponíveis. O contrato abaixo é uma proposta implementada neste receptor, e não uma afirmação de que esses endpoints já existem no Empresa. Nenhuma assinatura de produção foi alterada.

## Regra comercial

- Empresa é o dono do catálogo de planos, assinatura, cobrança e faturas.
- Para o cliente do Architector, o total mensal é **mensalidade-base do plano Empresa × 1,5**, mesmo se ele utilizar somente o Architector. Não há uma segunda mensalidade gerada no Architector.
- O cálculo usa centavos inteiros; meio centavo é arredondado para cima: `floor((baseMonthlyCents * 3 + 1) / 2)`. Exemplo de cálculo: R$ 139,00 → R$ 208,50. Este exemplo não fixa um preço de catálogo.
- O valor-base vem do catálogo do Empresa no servidor. O navegador do Architector não informa preço nem percentual.
- Este contrato cobre BRL e mensalidade. Pacotes com ciclos independentes, rateios, descontos e mudanças de ciclo precisam ser normalizados pelo Empresa antes da homologação. Base zero resulta em zero; não foi inventado preço mínimo.

## Painel do superadmin

Em `/superadmin`, use **Assinaturas, parceiros e acessos**, selecione a empresa e:

1. Vincule o identificador da empresa e o plano mensal do Empresa. A confirmação informa que o acesso ficará pendente.
2. Envie a ativação. O Architector conserva uma única chave de idempotência por vínculo e aplica timeout de dez segundos. Reenvios devem retornar a mesma assinatura no Empresa. Intervalo mínimo entre envios: trinta segundos.
3. O retorno HTTP do envio não libera acesso: a liberação depende do evento autenticado do Empresa.
4. Adicione parceiros pelo e-mail. O convite dura sete dias, usa o perfil existente de parceiro (leitura dos módulos permitidos) e exige aceite dos termos. O link é copiado pelo administrador; não há envio automático de mensagens.
5. Bloqueie a empresa inteira ou um e-mail de membro, cliente do portal ou convite. Bloqueio temporário expira na data informada; bloqueio permanente não expira. Excluir acesso conserva um registro de exclusão lógica e impede reutilização de convites. Restaurar remove a restrição administrativa, mas não substitui a confirmação da assinatura.

Bloquear ou excluir acesso não cancela a cobrança. Alterações de assinatura e cancelamento financeiro são feitos no Empresa. Não são apagados projetos, documentos, registros financeiros ou autoria histórica. O superadmin vê metadados e histórico administrativo neste painel e pode abrir a empresa para operar o conteúdo dela com permissão total, sempre sob auditoria. O ambiente de manutenção é reservado.

As regras são consultadas no servidor a cada requisição, incluindo portal, fotos privadas e decisões. Regras de usuário ficam limitadas à empresa selecionada. Mudança de e-mail não remove restrições vinculadas ao e-mail já associado ao ID autenticado de membro/cliente. Ativação financeira nunca limpa bloqueio manual.

Empresas existentes sem vínculo continuam com o comportamento anterior. Migrá-las exige identificar o plano/empresa corretos e confirmar cada vínculo. A entrega não atribui preços nem bloqueia toda a base automaticamente.

## Configuração no servidor

| Variável | Conteúdo |
| --- | --- |
| `DRAP_ACTIVATION_URL` | URL HTTPS completa do endpoint a implementar/homologar em `empresa.drap.app.br`; redirecionamentos não são seguidos |
| `DRAP_ACTIVATION_TOKEN` | Token de serviço para solicitar ativação, com escopo restrito no Empresa |
| `DRAP_ACTIVATION_WEBHOOK_SECRET` | Segredo HMAC exclusivo da ativação, de pelo menos 32 caracteres, compartilhado com o Empresa |

Não colocar segredos em variáveis `NEXT_PUBLIC_*`, no Git ou em campos da interface. As credenciais financeiras existentes continuam separadas. Sem configuração a interface indica integração indisponível.

## Solicitação Architector → Empresa

`POST DRAP_ACTIVATION_URL`, com `Authorization: Bearer <token>` e `Idempotency-Key: <requestKey>`.

```json
{
  "product": "drap_architector",
  "organizationId": "11111111-1111-4111-8111-111111111111",
  "companyId": "identificador-empresa",
  "planId": "identificador-plano-mensal",
  "requestKey": "33333333-3333-4333-8333-333333333333",
  "currency": "BRL",
  "interval": "month",
  "pricingMultiplierBps": 15000,
  "billingOwner": "drap_empresa"
}
```

O Empresa precisa autenticar o serviço, validar o vínculo entre empresa e cliente, consultar o preço oficial, calcular o total no servidor e criar/reutilizar uma única assinatura. A chave deve ser persistida transacionalmente no Empresa antes de qualquer efeito financeiro. Respostas 2xx reconhecem apenas o recebimento. Timeouts são resultado incerto: reenvie a mesma chave, nunca crie outra cobrança para o mesmo vínculo. O endpoint deve conseguir reenviar a confirmação quando a mesma solicitação for repetida, permitindo reconciliação manual.

## Confirmação Empresa → Architector

`POST /api/integrations/drap/activation` no domínio do Architector. Tamanho máximo: 16 KiB. Cabeçalhos:

- `X-Drap-Timestamp`: segundos Unix, tolerância de cinco minutos.
- `X-Drap-Signature`: HMAC-SHA256 em hexadecimal minúsculo de `timestamp + "." + corpo JSON bruto`, com `DRAP_ACTIVATION_WEBHOOK_SECRET`.

```json
{
  "eventId": "44444444-4444-4444-8444-444444444444",
  "organizationId": "11111111-1111-4111-8111-111111111111",
  "requestKey": "33333333-3333-4333-8333-333333333333",
  "companyId": "identificador-empresa",
  "planId": "identificador-plano-mensal",
  "subscriptionId": "assinatura-empresa",
  "revision": 1,
  "status": "active",
  "baseMonthlyCents": 13900,
  "monthlyCents": 20850,
  "currency": "BRL",
  "interval": "month",
  "product": "drap_architector",
  "billingOwner": "drap_empresa"
}
```

Estados: `active`, `suspended`, `canceled`. A revisão deve ser inteira, positiva e crescente por assinatura. O Empresa só deve enviar `active` quando tiver confirmado a condição comercial de acesso. Mudanças de plano usam a mesma assinatura e uma nova revisão; o primeiro evento deve coincidir com o plano solicitado.

O receptor valida assinatura, timestamp, vínculo previamente autorizado, moeda, ciclo, total de 150% e revisão. Evento idêntico retorna sucesso sem novo efeito; reutilizar o ID com conteúdo diferente retorna 409. Revisões antigas não substituem novas. A transação persiste evento, estado e auditoria. A confirmação estabelece também a conexão financeira com a mesma empresa remota; vínculos financeiros conflitantes são rejeitados.

Resposta 200: evento recebido/duplicado. 401: assinatura/timestamp inválido. 400: corpo inválido. 409: vínculo, preço, identidade da assinatura, evento ou revisão conflitante. 413: corpo excessivo. 503: integração não configurada. Em falha de transporte/5xx, retente com o mesmo ID/corpo e novo timestamp/assinatura. Um 409 deve ser reconciliado com o estado atual da assinatura no Empresa.

## API administrativa

`GET /api/superadmin/platform?organizationId=<uuid>` lista metadados, regras, estado da assinatura e últimos cinquenta eventos administrativos.

`POST /api/superadmin/platform` exige sessão superadmin e origem permitida:

| `action` | Campos adicionais |
| --- | --- |
| `enroll` | `organizationId`, `companyId`, `planId`, `confirmed: true` |
| `send` | `organizationId` |
| `partner` | `organizationId`, `email` |
| `access` | `organizationId`, `subject` (`*` ou e-mail), `state` (`active`, `suspended`, `blocked`, `removed`), `until` (timestamp em milissegundos ou `null`), `reason`, `revision` |

Regras novas usam revisão zero; atualização usa a revisão retornada no GET, evitando sobrescrever outro administrador. Suspensão exige prazo futuro de até um ano. APIs administrativas não aceitam preço, margem, papel arbitrário ou URL de destino do navegador.

## Validação e conclusão da integração

Os testes executam migrações e SQL reais em SQLite com transporte D1 substituído, incluindo permissões, isolamento entre empresas, bloqueio de sessão existente, expiração, exclusão, idempotência, HMAC, preços adulterados, revisão antiga e timeout. A homologação comercial exige o repositório/API do Empresa, implantação do contrato do outro lado, configuração segura e um teste integrado em sandbox. Só então migrar clientes e liberar cobranças reais.
