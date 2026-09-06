# Contrato de integração com a Drap

A integração atual é deliberadamente somente leitura. O endpoint `GET /api/finance/summary` usa demonstração quando as credenciais não estão configuradas ou quando a fonte remota falha.

Antes de liberar escrita financeira, confirmar com a Drap:

1. URL e credenciais do sandbox.
2. OpenAPI ou contrato oficial dos endpoints.
3. Identificador estável da empresa e do centro de custo.
4. Política de paginação, limite, erros e idempotência.
5. Eventos, assinatura e reenvio de webhooks.

Nenhum token pode ser enviado ao navegador. Cobrança, PIX, boleto, nota ou conta a pagar só entram após homologação em sandbox e definição de chave de idempotência.
