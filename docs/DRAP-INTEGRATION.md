# Integração remota com a Drap

Este documento registra o contrato técnico usado pela H.OIKOS/Nexo Obra para operar a DRAP com dados reais. A DRAP continua sendo a fonte oficial dos dados financeiros; a H.OIKOS guarda vínculos operacionais, estado de sincronização, solicitações idempotentes e eventos recebidos, sem criar uma segunda verdade financeira.

## Princípio de produção

O runtime não usa mock, demo nem valor financeiro fabricado. Quando uma capacidade remota não está configurada, não existe para o tenant ou está indisponível, a aplicação falha de forma explícita. Testes automatizados continuam existindo apenas como validação de qualidade; eles não alimentam a execução de produção.

## Base e autenticação

Base técnica:

```text
https://empresa.drap.app.br/api/v1
```

A autenticação usa Bearer token:

```http
Authorization: Bearer drap_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Cada API key pertence a um único tenant. A própria Drap aplica RLS e filtro explícito no backend, portanto a H.OIKOS **não envia `company_id`** para escolher empresa. O tenant é determinado pela key usada naquela conexão.

O limite informado é de **60 requisições por minuto por API key**. Em excesso a API responde `429` com `Retry-After`.

## Configuração no servidor

Para uma única empresa, a configuração legada continua aceita:

```dotenv
DRAP_API_URL=https://empresa.drap.app.br
DRAP_API_TOKEN=drap_live_...
DRAP_WEBHOOK_SECRET=...
DRAP_SUMMARY_PATH=/api/v1/resumo
DRAP_TRANSACTIONS_PATH=/api/v1/lancamentos
```

Para várias empresas, configure as credenciais por `external_company_id`:

```dotenv
DRAP_TENANTS_JSON={"empresa-a":{"apiToken":"drap_live_...","webhookSecret":"..."},"empresa-b":{"apiToken":"drap_live_...","webhookSecret":"..."}}
```

`DRAP_TENANTS_JSON`, tokens e secrets pertencem somente ao ambiente de execução do servidor. Nunca use `NEXT_PUBLIC_*` para esses valores.

Cobranças, NFS-e e os demais recursos operacionais permitidos **não dependem de `DRAP_CHARGES_PATH` nem de outra rota manual de ambiente**. O servidor descobre a rota real por tenant dentro da allowlist em `lib/server/drap-resources.ts`. Um `404` faz a descoberta tentar somente aliases conhecidos; `403` é tratado como recurso existente sem escopo; `429` preserva o rate-limit; e respostas como `400/405/409/422` comprovam existência da rota sem inventar sucesso da operação.

## Lançamentos

### Listar

```http
GET /api/v1/lancamentos
Authorization: Bearer drap_live_...
```

Resposta confirmada:

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
Idempotency-Key: <uuid>
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

A escrita operacional da H.OIKOS exige `Idempotency-Key` válida e encaminha a mesma chave à DRAP. A interface só deve disparar uma escrita quando existir uma regra de domínio explícita para aquela ação; ausência de automação de tela não transforma a integração em simulação.

## Resumo financeiro

O caminho preferido é o resumo oficial:

```http
GET /api/v1/resumo
```

Quando esse endpoint responde corretamente, os totais vêm da própria DRAP. Somente quando o resumo não existe naquele ambiente (`404` ou corpo incompatível com o contrato esperado) a H.OIKOS calcula o resumo a partir de **lançamentos reais retornados pela DRAP**. Esse fallback nunca usa dados fictícios e sinaliza truncamento quando a leitura não cobriu o universo completo.

## Cobranças

A rota da H.OIKOS é:

```text
POST /api/integrations/drap/charges
```

O fluxo de produção:

1. valida empresa, permissão financeira, projeto, cliente e centro de custo;
2. rejeita repetição conflitante e reaproveita a mesma intenção por `idempotencyKey`;
3. confirma conexão DRAP ativa do tenant;
4. descobre o recurso real `cobrancas` pela allowlist;
5. grava a solicitação local como pendente;
6. chama a DRAP real com a mesma `Idempotency-Key`;
7. só persiste `external_charge_id`, status e link quando a resposta remota confirma uma cobrança identificável;
8. em falha, registra o erro e não fabrica pagamento nem cobrança.

## Superfície operacional permitida

A ponte genérica é exposta em:

```text
/api/integrations/drap/resources/{resource}/{...segments}
```

Ela é server-side, tenant-scoped e limitada à allowlist. Leituras usam `GET`; escritas permitidas usam `POST`, `PATCH` ou `DELETE` e sempre exigem `Idempotency-Key`.

Recursos atualmente reconhecidos pela allowlist incluem lançamentos, parceiros, categorias, resumo, NFS-e, cobranças, orçamentos, contas bancárias, anexos, centros de custo, módulos, assinaturas, planos, empresas e webhooks. Reconhecer o nome não significa inventar disponibilidade: cada tenant é sondado contra a API real antes do uso.

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
| `400` | body inválido ou contrato da operação não satisfeito |
| `401` | key ausente, inválida ou revogada |
| `403` | scope insuficiente |
| `404` | recurso não existe naquele tenant |
| `409` | conflito |
| `429` | rate-limit; consultar `Retry-After` |
| `500` | erro interno |

## Webhooks

Endpoint receptor da H.OIKOS:

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

A H.OIKOS rejeita timestamps com diferença superior a **300 segundos**. O `rawBody` é validado antes de parsear JSON.

Como o contrato não fornece `event_id`, a H.OIKOS gera um identificador idempotente SHA-256 a partir de `timestamp.rawBody`. Uma repetição byte a byte do mesmo webhook é registrada apenas uma vez.

### Roteamento multiempresa

O payload oficial não contém `company_id`. Para não misturar tenants, a H.OIKOS identifica a empresa pelo **secret que validou a assinatura** e pelo `external_company_id` correspondente em `DRAP_TENANTS_JSON`.

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

O processador trata `lancamento.*` como sinal de atualização da fonte oficial e volta a consultar a DRAP quando a tela precisar do dado. Ele não replica lançamentos como segunda verdade local. Eventos de cobrança atualizam somente solicitações de cobrança já vinculadas por ID remoto. Os demais eventos ficam preservados para auditoria até existir regra de domínio explícita.

## Segurança e resiliência

- tokens e secrets só no servidor;
- credencial separada por tenant em ambiente multiempresa;
- ponte operacional limitada a recursos permitidos;
- escrita exige `Idempotency-Key` e a encaminha à DRAP;
- payload do webhook limitado e HMAC validado sobre `timestamp.rawBody`;
- tolerância máxima de relógio de 300 segundos;
- webhook repetido não duplica processamento;
- consulta GET tem timeout curto e respeita paginação;
- `429` preserva `Retry-After`;
- nenhuma falha da DRAP é substituída por dado fictício;
- nenhum dado financeiro de teste entra no runtime de produção.

## Estado técnico atual

- [x] autenticação Bearer implementada;
- [x] isolamento por tenant da API key implementado;
- [x] listagem e paginação de `/api/v1/lancamentos` mapeadas;
- [x] resumo oficial `/api/v1/resumo` preferido, com fallback somente para lançamentos reais;
- [x] assinatura de webhook `timestamp.rawBody` implementada;
- [x] janela de 300 segundos e idempotência do receptor implementadas;
- [x] roteamento multiempresa por secret implementado;
- [x] eventos `lancamento.*` e `cobranca.*` reconhecidos;
- [x] descoberta de recursos por tenant com allowlist implementada;
- [x] cobranças usam rota real descoberta e idempotência de ponta a ponta;
- [x] novas ativações usam preço oficial mínimo e acréscimo opcional exclusivo do superadministrador, congelado por solicitação; contratação real aguarda conclusão pela Drap;
- [ ] credenciais e secrets de produção precisam existir no provedor de hospedagem para cada tenant que será usado;
- [ ] subscription real de webhook precisa estar criada para cada ambiente publicado que depender de eventos;
- [ ] cada operação externa de alto impacto, como emissão de NFS-e, deve ser validada ao vivo com um tenant autorizado antes de ser apresentada como concluída ao usuário final.
