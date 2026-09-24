# Contrato operacional DRAP usado pela H.OIKOS

Este documento registra somente o contrato confirmado para uso embutido na H.OIKOS. A pessoa usuária continua autenticada apenas na H.OIKOS; a API key DRAP fica no servidor e cada conexão é vinculada ao tenant da empresa.

## Base e autenticação

Base técnica: `https://empresa.drap.app.br/api/v1`.

Autenticação por Bearer token. Cada key pertence a um único tenant. O backend H.OIKOS usa `DRAP_TENANTS_JSON` quando há mais de uma empresa conectada e nunca envia a key ao navegador.

Rate limit: 60 requisições por minuto por API key. Em `429`, respeitar `Retry-After`.

## Lançamentos

- `GET /lancamentos` — lista. Filtros opcionais: `tipo`, `status`, `data_de`, `data_ate`, `limit`, `offset`.
- `POST /lancamentos` — cria.
- `GET /lancamentos/{id}` — busca um.
- `PATCH /lancamentos/{id}` — atualiza.
- `DELETE /lancamentos/{id}` — remove.

## Parceiros

Clientes, fornecedores e registros do tipo ambos.

- `GET /parceiros` — lista. Filtros opcionais: `tipo`, `ativo`, `limit`, `offset`.
- `POST /parceiros` — cria.
- `GET /parceiros/{id}` — busca um.
- `PATCH /parceiros/{id}` — atualiza.
- `DELETE /parceiros/{id}` — remove.

## Categorias

- `GET /categorias` — lista áreas e subcategorias.
- `POST /categorias` — cria nova área.

## Superfície adicional descoberta pela API real

A documentação pública da DRAP não enumera toda a superfície disponível para uma chave. Por isso a H.OIKOS não transforma nomes presumidos em contrato: ela consulta a API real do próprio tenant, com a credencial guardada no servidor, e só libera o recurso que respondeu como existente.

A descoberta fica em `lib/server/drap-resources.ts` e usa uma allowlist fechada. Os recursos sondados são lançamentos, parceiros, categorias, resumo, NFS-e/notas fiscais, cobranças, orçamentos, contas bancárias, anexos, centros de custo, módulos, assinaturas, planos, empresas e webhooks. Para NFS-e e contas bancárias existem aliases conhecidos; `404` avança para o próximo alias, enquanto `403` para a busca porque comprova que o recurso existe mas a chave não tem escopo.

A aplicação expõe a leitura do mapa real em:

```text
GET /api/integrations/drap/capabilities
```

A resposta é privada e por tenant. Ela informa `available`, `forbidden`, `missing`, `rate_limited` ou `error` para cada recurso, sem devolver API key ou cabeçalhos de autenticação. O resultado positivo/negativo é mantido em cache curto para não consumir o limite da DRAP a cada renderização.

Recursos operacionais permitidos podem ser usados pelo backend H.OIKOS em:

```text
GET|POST|PATCH|DELETE /api/integrations/drap/resources/{resource}/{...segmentos}
```

Isso **não** é proxy aberto: o primeiro segmento precisa existir na allowlist, os segmentos seguintes são codificados, a conexão DRAP do tenant precisa estar ativa e a permissão `finance` é conferida no servidor. Recursos administrativos (`modulos`, `assinaturas`, `planos`, `empresas`) ficam somente leitura por essa ponte.

Toda escrita pela ponte exige `Idempotency-Key` válida e a mesma chave é encaminhada à DRAP. Assim um timeout pode ser repetido sem transformar a mesma intenção da pessoa em duas operações financeiras.

A mesma exigência vale para as rotas dedicadas: `POST /lancamentos`, `PATCH`/`DELETE /lancamentos/{id}`, `POST /parceiros`, `PATCH`/`DELETE /parceiros/{id}` e `POST /categorias` respondem `400 idempotency_key_required` sem a chave, antes de qualquer chamada remota.

Cobranças usam a mesma descoberta em tempo de execução. A capacidade deixa de depender de `DRAP_CHARGES_PATH` existir no ambiente: a H.OIKOS primeiro comprova que o recurso `cobrancas` existe para aquele tenant e só então tenta criar a cobrança. A solicitação local continua idempotente e a `Idempotency-Key` chega ao backend DRAP. O corpo segue o contrato real de `/api/v1/cobrancas` (`parceiro_id`, `descricao`, `valor` em reais, `vencimento`, `forma`), montado em `lib/integrations/drap.ts`; centro de custo e política de lembretes ficam só na H.OIKOS. Reenviar com a mesma chave depois de falha tenta de novo na DRAP (que devolve a cobrança já criada, se houver) em vez de responder a falha antiga como sucesso; a tela gera uma chave por abertura do formulário e só troca de chave depois de uma recusa definitiva.

## Códigos HTTP

- `200` — sucesso em GET/PATCH.
- `201` — criado em POST.
- `400` — body inválido; a DRAP pode retornar detalhe Zod em `detail`.
- `401` — API key ausente, inválida ou revogada.
- `403` — scope insuficiente.
- `404` — recurso não existe no tenant.
- `409` — conflito, por exemplo nome duplicado.
- `429` — rate limit; usar `Retry-After`.
- `500` — erro interno.

Na borda H.OIKOS, `401` remoto é tratado como falha de credencial do conector, não como logout do usuário H.OIKOS.

## Webhooks

Cabeçalhos obrigatórios:

- `X-DRAP-Timestamp`
- `X-DRAP-Signature: sha256=<hex>`

Assinatura: HMAC SHA-256 de `${timestamp}.${rawBody}`. A diferença de relógio aceita é menor que 300 segundos.

Eventos confirmados:

- `lancamento.created`
- `lancamento.updated`
- `lancamento.deleted`
- `lancamento.paid`
- `lancamento.unpaid`
- `parceiro.created`
- `parceiro.updated`
- `parceiro.deleted`
- `categoria.created`
- `categoria.updated`
- `categoria.deleted`
- `conta_bancaria.created`
- `conta_bancaria.updated`
- `conta_bancaria.deleted`
- `nfse.emitida`
- `nfse.cancelada`
- `cobranca.criada`
- `cobranca.paga`
- `cobranca.cancelada`
- `orcamento.criado`
- `orcamento.atualizado`
- `anexo.adicionado`

O endpoint H.OIKOS é `POST /api/integrations/drap/webhook`. Eventos são persistidos de forma idempotente antes do processamento.

## Retry de webhook

A primeira entrega ocorre imediatamente. Falhas por HTTP >= 400, timeout ou DNS são reentregues pela DRAP com backoff de `1 min -> 5 min -> 30 min -> 2 h`. Após quatro tentativas, a delivery é marcada como `dead`. O receptor H.OIKOS precisa continuar idempotente porque uma mesma entrega pode ser repetida.

## Limite atual do contrato

A ponte de descoberta permite usar, sem expor a credencial, os recursos que a API real comprovar para o tenant. Ela não transforma a existência de um módulo comercial em um payload de escrita inventado: quando a DRAP exige campos específicos, a H.OIKOS encaminha o corpo somente pelas rotas operacionais permitidas e deixa a própria API validar o contrato.

Ainda não foi fornecido contrato público de provisionamento para: criar tenant DRAP, criar/cancelar assinatura comercial, cobrar a assinatura ou emitir/rotacionar automaticamente a API key. Esses pontos permanecem fora da ponte de escrita; nenhum endpoint administrativo é inventado no código.
