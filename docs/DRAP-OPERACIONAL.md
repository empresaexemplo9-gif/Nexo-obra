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

Este contrato operacional permite usar recursos DRAP dentro da H.OIKOS sem redirecionar para o portal DRAP depois que o tenant e a credencial existem.

Ainda não foi fornecido contrato de API para: criar tenant DRAP, consultar catálogo/preço comercial, criar assinatura, cobrar a assinatura, cancelar plano ou emitir/rotacionar automaticamente a API key. Esses pontos permanecem bloqueados até existir contrato real; nenhum endpoint é inventado no código.
