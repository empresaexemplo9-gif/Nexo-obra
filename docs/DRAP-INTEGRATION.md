# Integração remota com a Drap

Este documento registra o contrato técnico confirmado para a API financeira da Drap usada pelo Nexo Obra. A Drap continua sendo a fonte oficial dos dados financeiros; o Nexo guarda apenas vínculos operacionais, estado de sincronização e eventos recebidos.

## Base e autenticação

Base técnica:

```text
https://empresa.drap.app.br/api/v1
```

A autenticação usa Bearer token:

```http
Authorization: Bearer drap_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Cada API key pertence a um único tenant. A própria Drap aplica RLS e filtro explícito no backend, portanto o Nexo **não envia `company_id`** para escolher empresa. O tenant é determinado pela key usada naquela conexão.

O limite informado é de **60 requisições por minuto por API key**. Em excesso a API responde `429` com `Retry-After`.

## Configuração no servidor

Para uma única empresa, a configuração legada continua aceita:

```dotenv
DRAP_API_URL=https://empresa.drap.app.br
DRAP_API_TOKEN=drap_live_...
DRAP_WEBHOOK_SECRET=...
DRAP_TRANSACTIONS_PATH=/api/v1/lancamentos
```

Para várias empresas, configure as credenciais por `external_company_id`:

```dotenv
DRAP_TENANTS_JSON={"empresa-a":{"apiToken":"drap_live_...","webhookSecret":"..."},"empresa-b":{"apiToken":"drap_live_...","webhookSecret":"..."}}
```

`DRAP_TENANTS_JSON`, tokens e secrets pertencem somente ao ambiente de execução do servidor. Nunca use `NEXT_PUBLIC_*` para esses valores.

O portal humano continua separado da API:

```dotenv
NEXT_PUBLIC_DRAP_PORTAL_URL=https://empresa.drap.app.br/inicio
```

## Lançamentos

### Listar

```http
GET /api/v1/lancamentos
Authorization: Bearer drap_live_...
```

Resposta:

```json
{
  "items": [],
  "total": 142,
  "limit": 100,
  "offset": 0
}
```

Filtros confirmados: `tipo`, `status`, `data_de`, `data_ate`, `limit` e `offset`.

O adaptador usa páginas de 100 registros e limita cada leitura a 500 lançamentos por requisição interna. O endpoint padrão é `/api/v1/lancamentos` mesmo quando `DRAP_TRANSACTIONS_PATH` não é definido.

### Criar

```http
POST /api/v1/lancamentos
Authorization: Bearer drap_live_...
Content-Type: application/json
```

Exemplo de body:

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

A criação direta de lançamento ainda não é disparada automaticamente pelo Nexo. Toda escrita financeira deve continuar idempotente e explicitamente homologada antes de ser ligada à interface.

## Parceiros e categorias

Endpoints confirmados:

| Recurso | Métodos |
| --- | --- |
| `/parceiros` | `GET`, `POST` |
| `/parceiros/{id}` | `GET`, `PATCH`, `DELETE` |
| `/categorias` | `GET`, `POST` |

Filtros de parceiros: `tipo`, `ativo`, `limit`, `offset`.

## Respostas HTTP

| Código | Significado |
| --- | --- |
| `200` | sucesso em GET/PATCH |
| `201` | criado em POST |
| `400` | body inválido; detalhe Zod em `detail` |
| `401` | key ausente, inválida ou revogada |
| `403` | scope insuficiente |
| `404` | recurso não existe naquele tenant |
| `409` | conflito |
| `429` | rate-limit; consultar `Retry-After` |
| `500` | erro interno |

## Webhooks

Endpoint receptor do Nexo:

```text
POST /api/integrations/drap/webhook
```

A subscription é criada na Drap em **Configurações → Integrações → Webhooks**. O secret é mostrado uma única vez e deve ser salvo no ambiente do servidor.

Cabeçalhos confirmados:

```http
X-DRAP-Timestamp: 1750564800
X-DRAP-Signature: sha256=...
Content-Type: application/json
```

Envelope confirmado:

```json
{
  "event": "lancamento.created",
  "timestamp": 1750564800,
  "data": {
    "lancamento": {
      "id": "uuid",
      "data": "2026-06-22",
      "descricao": "Venda site",
      "tipo": "receita",
      "valor": 1500.00,
      "status": "pago"
    }
  }
}
```

### Assinatura

A assinatura é HMAC-SHA256 do texto exato:

```text
X-DRAP-Timestamp + "." + rawBody
```

Em Node, a regra equivalente é:

```js
const esperado = "sha256=" + createHmac("sha256", secret)
  .update(`${timestamp}.${rawBody}`)
  .digest("hex");
```

O Nexo rejeita timestamps com diferença superior a **300 segundos**. O `rawBody` é validado antes de parsear JSON.

Como o contrato não fornece `event_id`, o Nexo gera um identificador idempotente SHA-256 a partir de `timestamp.rawBody`. Uma repetição byte a byte do mesmo webhook é registrada apenas uma vez.

### Roteamento multiempresa

O payload oficial não contém `company_id`. Para não misturar tenants, o Nexo identifica a empresa pelo **secret que validou a assinatura** e pelo `external_company_id` correspondente em `DRAP_TENANTS_JSON`.

A configuração legada com um único `DRAP_WEBHOOK_SECRET` só é aceita quando existe no máximo uma conexão Drap ativa. Se houver mais de uma, o receptor falha fechado com conflito em vez de encaminhar o evento à empresa errada.

## Eventos oficiais

Eventos informados pela Drap:

- `lancamento.created`, `lancamento.updated`, `lancamento.deleted`, `lancamento.paid`, `lancamento.unpaid`;
- `parceiro.created`, `parceiro.updated`, `parceiro.deleted`;
- `categoria.created`, `categoria.updated`, `categoria.deleted`;
- `conta_bancaria.created`, `conta_bancaria.updated`, `conta_bancaria.deleted`;
- `nfse.emitida`, `nfse.cancelada`;
- `cobranca.criada`, `cobranca.paga`, `cobranca.cancelada`;
- `orcamento.criado`, `orcamento.atualizado`;
- `anexo.adicionado`.

O processador do Nexo trata `lancamento.*` como sinal de atualização da fonte oficial e volta a consultar a Drap quando a tela precisar do dado. Ele não replica lançamentos como segunda verdade local. Eventos de cobrança atualizam somente solicitações de cobrança já vinculadas por ID remoto. Os demais eventos ficam preservados para auditoria até existir regra de domínio explícita.

## Mapeamento de lançamentos para a interface

O adaptador reconhece, entre outros:

- `tipo=receita` como valor a receber;
- `tipo=despesa` como valor a pagar;
- `status=pago` como quitado;
- `status=vencido` como vencido;
- `descricao` como descrição;
- `valor` como valor;
- `contraparte` como cliente/fornecedor exibido.

O resumo financeiro mostrado pelo Nexo é calculado em memória a partir dos lançamentos consultados na Drap. Nenhum saldo ou lançamento é persistido como fonte concorrente.

## Segurança e resiliência

- tokens e secrets só no servidor;
- credencial separada por tenant em ambiente multiempresa;
- payload do webhook limitado a 256 KiB;
- HMAC verificado sobre `timestamp.rawBody`;
- tolerância máxima de relógio de 300 segundos;
- webhook repetido não duplica processamento;
- consulta GET tem timeout curto e respeita paginação;
- `429` preserva o valor de `Retry-After` no erro interno;
- nenhuma falha da Drap é substituída por dado fictício;
- escritas financeiras continuam exigindo idempotency key quando forem homologadas.

## Estado de homologação

- [x] autenticação Bearer confirmada;
- [x] isolamento por tenant da API key confirmado;
- [x] listagem e paginação de `/api/v1/lancamentos` mapeadas;
- [x] campos básicos de lançamento mapeados;
- [x] assinatura do webhook confirmada como `timestamp.rawBody`;
- [x] janela de 300 segundos implementada;
- [x] idempotência do receptor implementada;
- [x] roteamento multiempresa por secret implementado;
- [x] eventos `lancamento.*` e `cobranca.*` reconhecidos;
- [ ] credenciais reais configuradas no ambiente de produção;
- [ ] subscription real criada apontando para o endpoint publicado;
- [ ] POST automático de lançamentos habilitado após teste de idempotência/escrita;
- [ ] endpoints de cobrança homologados antes de liberar criação pela interface.
