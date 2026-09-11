# Integração SINAPI

O módulo de orçamento consulta a SINAPI somente por uma fonte oficial ou licenciada configurada no servidor. A plataforma não inclui tabela copiada, preços demonstrativos nem fallback fictício.

## Contrato esperado

A fonte deve aceitar busca por texto ou código, UF e mês de referência. Configure:

```dotenv
SINAPI_API_URL=
SINAPI_API_TOKEN=
SINAPI_API_KEY_HEADER=
SINAPI_SEARCH_PATH=/items/search
```

Sem `SINAPI_API_URL` e `SINAPI_API_TOKEN`, a interface informa que a fonte não está conectada.

O adaptador normaliza cada resultado para:

- código;
- descrição;
- unidade;
- custo unitário em centavos;
- UF;
- mês de referência;
- referência estável da fonte.

## Requisitos antes da ativação comercial

1. Confirmar a licença de uso e redistribuição dos dados.
2. Homologar o endpoint e o método de autenticação.
3. Validar se os preços incluem ou não desoneração.
4. Registrar UF e competência em cada item importado.
5. Definir rotina de atualização e política para orçamentos históricos.
6. Testar paginação, limites, indisponibilidade e rotação do token.

As credenciais permanecem no ambiente de produção e nunca são enviadas ao navegador ou gravadas no Git.
