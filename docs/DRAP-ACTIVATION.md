# DRAP embutida na H.OIKOS

Atualizado em 2026-09-16 a partir da documentação pública da DRAP em:

- `https://empresa.drap.app.br/api-docs`
- `https://empresa.drap.app.br/precos`

## Objetivo

O usuário deve permanecer dentro da H.OIKOS para usar os recursos DRAP. A identidade humana continua sendo a conta H.OIKOS; tokens, API keys e secrets DRAP ficam somente no servidor. A H.OIKOS não deve exigir que o usuário abra o portal DRAP para operar lançamentos, parceiros, categorias ou webhooks.

A regra comercial é simples: **o preço apresentado ao usuário da H.OIKOS é o mesmo preço publicado pela DRAP, sem acréscimo**.

O contrato antigo que multiplicava a mensalidade por 1,5 foi descontinuado. O código ainda aceita callbacks históricos `drap_architector` somente para não quebrar ativações antigas já emitidas. Toda nova solicitação usa `product: "drap_embedded"` e `pricingMultiplierBps: 10000`.

## O que a API pública DRAP confirma

Base técnica:

```text
https://empresa.drap.app.br/api/v1
```

Autenticação:

```http
Authorization: Bearer drap_live_...
```

A documentação também cita `x-api-key` como alternativa. A key é criada em `Configurações → Integrações`, pertence a um tenant e é mostrada em texto bruto uma única vez.

### Lançamentos

- `GET /lancamentos`
- `POST /lancamentos`
- `GET /lancamentos/{id}`
- `PATCH /lancamentos/{id}`
- `DELETE /lancamentos/{id}`

Filtros documentados: `tipo`, `status`, `data_de`, `data_ate`, `limit`, `offset`.

Exemplo público de criação:

```json
{
  "data": "2026-06-22",
  "descricao": "Venda site",
  "tipo": "receita",
  "valor": 1500.00,
  "contraparte": "ACME Ltda",
  "status": "pago"
}
```

### Parceiros

- `GET /parceiros`
- `POST /parceiros`
- `GET /parceiros/{id}`
- `PATCH /parceiros/{id}`
- `DELETE /parceiros/{id}`

Filtros documentados: `tipo`, `ativo`, `limit`, `offset`.

### Categorias

- `GET /categorias`
- `POST /categorias`

### Erros e rate limit

A documentação pública lista `200`, `201`, `400`, `401`, `403`, `404`, `409`, `429` e `500`. Em `429`, o adaptador da H.OIKOS preserva `Retry-After`.

## Webhooks

O receptor H.OIKOS usa o envelope oficial:

```http
X-DRAP-Timestamp: 1750564800
X-DRAP-Signature: sha256=<hmac>
```

A assinatura é HMAC-SHA256 de:

```text
<timestamp>.<rawBody>
```

com tolerância máxima de 300 segundos.

Eventos documentados incluem lançamentos, parceiros, categorias, contas bancárias, NFS-e, cobranças, orçamentos e anexos. O receptor registra o evento antes de processar e usa hash da mensagem assinada como idempotency key quando a DRAP não fornece um ID independente.

A política publicada de reentrega é: tentativa imediata e, após falha, `1 min → 5 min → 30 min → 2 h`; depois da quarta tentativa a delivery passa para `dead`.

## Catálogo dentro da H.OIKOS

O backend mantém um snapshot do catálogo público em `lib/integrations/drap-catalog.ts`. Ele é servido por:

```text
GET /api/integrations/drap/catalog
```

A resposta informa:

- `pricing: "same_as_drap"`;
- `embeddedExperience: true`;
- `requiresRedirect: false`;
- `checkoutAvailable`: se existe ou não um endpoint DRAP de contratação service-to-service homologado;
- estado do tenant/conexão e da assinatura quando já existem.

O preço enviado pelo navegador nunca é aceito. O catálogo local é apenas apresentação; uma cobrança real deve ser confirmada pelo servidor DRAP.

### Preços públicos conferidos em 2026-09-16

| Item | Preço |
| --- | ---: |
| Plano grátis | R$ 0/mês |
| Dashboards Pro | R$ 59/mês |
| Integrações | R$ 29/mês |
| Multi-usuário | R$ 39/mês |
| Contabilidade Básica | R$ 69/mês |
| Banco & Conciliação | R$ 49/mês |
| Fluxo de Caixa & Tesouraria | R$ 69/mês |
| Emissão de Nota Fiscal | R$ 79/mês |
| Cobranças | R$ 59/mês |
| IA Assistente | R$ 49/mês |
| Assistente WhatsApp | R$ 29/mês |
| Pacote Essencial | R$ 139/mês |
| Pacote Fiscal | R$ 159/mês |
| Pacote Profissional | R$ 329/mês |
| Pacote Completo | R$ 349/mês |
| DRAP Retaguarda | R$ 990/mês ou R$ 9.900/ano |

A página pública informa trial de 14 dias para os módulos; o Plano Retaguarda não participa do trial.

## Limite confirmado da documentação pública

A documentação pública **não expõe** endpoint para:

- criar tenant/empresa DRAP por service account;
- criar ou rotacionar API key por API;
- criar webhook subscription por API;
- ativar/desativar módulo por API;
- iniciar checkout/assinatura por API;
- criar cobrança da mensalidade DRAP por API;
- cancelar assinatura por API.

A página pública de preços aponta a assinatura self-service para `Configurações → Faturas`, mas essa página exige uma sessão humana DRAP. A H.OIKOS não usa esse redirecionamento porque o produto deve permanecer embutido e sem segunda conta para o usuário.

## Adaptador de contratação embutida

Existe um adaptador capability-gated no servidor:

- `DRAP_ACTIVATION_URL`
- `DRAP_ACTIVATION_TOKEN`
- `DRAP_ACTIVATION_WEBHOOK_SECRET`

Ele só é considerado disponível quando as três variáveis estão configuradas e a URL aponta por HTTPS para `empresa.drap.app.br`.

Nova solicitação H.OIKOS → DRAP:

```json
{
  "product": "drap_embedded",
  "organizationId": "<uuid H.OIKOS>",
  "companyId": "<tenant DRAP>",
  "planId": "<item do catálogo>",
  "requestKey": "<uuid idempotente>",
  "currency": "BRL",
  "interval": "month",
  "pricingMultiplierBps": 10000,
  "billingOwner": "drap_empresa"
}
```

Esse endpoint de serviço **não aparece na API pública atual**. Portanto ele não deve ser apontado para uma rota privada descoberta por inspeção do navegador. A DRAP precisa homologar uma rota service-to-service própria para o fluxo embutido.

A confirmação DRAP → H.OIKOS usa HMAC, timestamp, revisão crescente e valor confirmado. Para `product: "drap_embedded"`, `monthlyCents` precisa ser exatamente igual a `baseMonthlyCents`. O callback legado `drap_architector` continua aceito apenas para eventos históricos gerados pelo contrato anterior.

## O que falta para zero conta e zero redirecionamento

Para um usuário H.OIKOS que nunca teve tenant DRAP, o backend DRAP precisa fornecer um contrato service-to-service com pelo menos:

1. provisionar uma empresa/tenant a partir da organização H.OIKOS;
2. ativar trial, módulo, pacote ou Retaguarda;
3. criar/consultar/cancelar a assinatura e o pagamento;
4. entregar uma API key de tenant para armazenamento exclusivamente servidor;
5. registrar webhook e entregar o secret de assinatura;
6. retornar estado idempotente para reconciliação.

Quando esse contrato existir, a H.OIKOS já tem os componentes necessários do outro lado: catálogo, tenant mapping, armazenamento server-side das credenciais, API operacional, HMAC, idempotência e estado de ativação.
