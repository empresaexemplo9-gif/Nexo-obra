# Referência SINAPI dentro da plataforma

O superadmin prepara, analisa e ativa a referência em **/superadmin → Referência SINAPI**.
Os orçamentos consultam os preços persistidos localmente. A aquisição automática mensal usa
a API do Orçamentador quando `SINAPI_API_TOKEN` está configurado; a planilha da Caixa e o
envio manual continuam disponíveis como contingência.

## Vínculo com o Orçamentador

O contrato implementado segue o SDK `orcamentador/orcamentador-sdk` no commit
`db5e9129446ec96c66341f0c323c20a8e52b265d`: base `https://orcamentador.com.br/api`,
autenticação no header `X-API-Key`, insumos em `/insumos`, composições em `/composicoes`,
encargos em `/encargos` e indicadores em `/indicadores`.

Na hospedagem, configure apenas o segredo `SINAPI_API_TOKEN`. Os defaults de URL/header são:

```dotenv
SINAPI_API_URL=https://orcamentador.com.br/api
SINAPI_API_KEY_HEADER=X-API-Key
SINAPI_SEARCH_PATH=/insumos
SINAPI_API_TOKEN=
```

A busca dos orçamentos usa a API como fallback quando não existe referência local ativa.
Código numérico é enviado como `codigo`; texto é enviado como `nome`. UF, regime e
competência são enviados nos parâmetros documentados pelo SDK.

## Atualização mensal

`vercel.json` chama `/api/cron/sinapi` diariamente às 09:00 UTC. A chamada diária é apenas
uma verificação: para a combinação configurada de UF/regime, a atualização efetiva acontece
uma vez para a competência do mês anterior e não duplica um mês já ativo.

Quando `SINAPI_API_TOKEN` existe, o cron:

1. consulta insumos e composições do Orçamentador por páginas;
2. registra também um snapshot de encargos e dos indicadores INCC, IPCA, IGP-M, Selic e dólar no laudo;
3. normaliza código, descrição, unidade e preço em centavos;
4. grava a nova competência nas mesmas tabelas `sinapi_competencias` e `sinapi_itens`;
5. compara quantidade, itens sem preço, unidade e variação de preço com a referência ativa;
6. mantém a referência anterior se houver falha ou inconsistência;
7. na primeira troca de Caixa → Orçamentador exige aprovação humana, porque o contrato da fonte mudou;
8. depois dessa primeira aprovação, se **Renovar automaticamente** estiver habilitado e não houver alertas, ativa a nova competência e remove a anterior na mesma transação.

Os alarmes permanecem conservadores: quantidade com variação acima de 20%, mais de 100
itens adicionais sem preço utilizável, ou mais de 5% dos itens coincidentes com mudança de
unidade/variação de preço acima de 50% impedem a troca automática.

Se o token do Orçamentador não estiver configurado, o cron mantém o caminho anterior da
Caixa. Uma tentativa da Caixa parada em `baixando` pode ser descartada pelo sincronizador
quando o Orçamentador passa a ser a fonte, sem remover uma referência já aprovada.

## Primeira conferência e contingência da Caixa

Aplique as migrações pelo botão **Atualizar banco de dados** e mantenha `BLOB_READ_WRITE_TOKEN`
e `CRON_SECRET` na hospedagem. Para uma conferência manual, selecione competência, UF e
regime no superadmin e use **Preparar referência**. O fluxo de ZIP/XLSX continua com as
fases `baixando → conferindo → interpretando → importando → pendente → aprovada` e pode ser
usado se a API estiver indisponível.

A ativação confere a quantidade persistida e troca a referência na mesma transação que
remove os itens e a competência anterior **da mesma UF e regime**. Valores já copiados para
orçamentos continuam como snapshots e não são alterados retroativamente.

## Segurança operacional

`CRON_SECRET` autentica o cron e nunca pertence ao Git. `SINAPI_API_TOKEN` também é somente
server-side. O sincronizador usa o mesmo lease global do fluxo manual para impedir duas
atualizações concorrentes.

A primeira competência recebida pelo Orçamentador fica `pendente` mesmo que a renovação
automática já estivesse ligada. A aprovação humana grava a assinatura do novo contrato;
somente competências seguintes podem ser promovidas automaticamente.

Nenhum preço fictício é criado. Resposta curta demais, falha de autenticação, rate limit,
erro de rede ou divergência de persistência preservam a referência que já estava ativa.
