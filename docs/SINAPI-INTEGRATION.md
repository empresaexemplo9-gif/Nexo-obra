# Referência SINAPI dentro da plataforma

O superadmin prepara, analisa e ativa a referência em **/superadmin → Referência SINAPI**.
Os orçamentos consultam os preços persistidos, sem depender de uma API paga. A integração
externa anterior continua disponível quando não há referência local para os filtros.

## Primeira conferência

1. Aplique a migração `0017_medical_sir_ram` pelo botão **Atualizar banco de dados**.
2. Configure `BLOB_READ_WRITE_TOKEN` (armazenamento privado já utilizado pelo projeto) e
   `CRON_SECRET` na hospedagem. Não coloque os valores no Git.
3. Selecione competência, UF e regime; use **Preparar referência** e **Processar próxima etapa**.
4. A plataforma baixa o ZIP da Caixa e mostra as primeiras 30 linhas de cada aba da
   planilha `SINAPI_Referência_AAAA_MM.xlsx`. Selecione as abas de insumos/composições,
   linha de cabeçalho e colunas de código, descrição, unidade e preço da UF/regime.
   O cabeçalho selecionado precisa identificar todas as quatro colunas.
5. Processe a análise e a importação. Confira a amostra no arquivo original, incluindo
   competência, UF, regime, unidade e valor; só então ative a referência.
6. Habilite **Renovar automaticamente** para a UF e o regime conferidos.

A configuração automática desta entrega atende a **uma combinação de UF/regime por vez**,
com uma ou duas tabelas (insumos/composições). É possível ativar referências de outras
combinações manualmente, mas mudar a configuração não agenda todas as 54 combinações.
Cada combinação conserva somente sua competência ativa. A seleção de colunas é explícita
porque o layout nacional não deve ser confundido com os antigos arquivos por UF.

## Renovação e descarte

O cron `/api/cron/sinapi` verifica diariamente a competência do mês anterior. O download
é repetido nos dias seguintes quando a publicação ainda não existe ou a Caixa recusa o
acesso. Não duplica um mês já ativo. A URL é construída no servidor sob
`https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/` e não aceita destinos arbitrários.

O job persiste as fases `baixando → conferindo → interpretando → importando → pendente → aprovada`.
Depois da homologação, cabeçalhos idênticos permitem pular a seleção manual.
Se a interpretação falhar por uma coluna deslocada, o job volta à conferência e permite
corrigir o mapeamento usando o arquivo já baixado, sem tocar nos preços ativos.

A aprovação
automática exige ausência de alertas: variação de quantidade até 20%, aumento de itens sem
preço de até 100 e no máximo 5% de itens com mudança de unidade ou variação de preço acima
de 50%. Esses limites são alarmes operacionais, não prova de exatidão dos preços.

A escrita acontece em lotes de 500 itens, com checkpoint na mesma transação do lote.
Cron e ações manuais usam um lease global de 10 minutos; as funções têm duração máxima
de 300 segundos. As etapas longas podem continuar na execução seguinte ou pelo painel.
Um arquivo de 20 MB não é, por si só, incompatível com serverless: o que precisa caber é
o trabalho total de download, descompressão, interpretação e persistência.

A ativação confere a quantidade persistida e troca a referência na mesma transação que
remove os itens e a competência anterior **da mesma UF e regime**. Não altera os valores
copiados para orçamentos. A referência do item de orçamento inclui mês, UF, regime, tipo e código.

Os únicos binários temporários são o XLSX de referência e seu JSON normalizado, privados
e com chaves determinísticas. São apagados após ativar ou descartar. Se a exclusão falhar,
o job permanece rastreável para nova tentativa. O cron limpa tentativas sem progresso
há sete dias, mesmo com renovação desabilitada. Não conserva ZIPs nem um histórico de
planilhas; na referência vigente permanecem URL, SHA-256 do ZIP, tamanho, contagens,
assinatura do cabeçalho, amostra e identidade/data da aprovação.

## Hospedagem

`vercel.json` agenda uma chamada diária às 09:00 UTC, autenticada por `CRON_SECRET`.
O código e o agendamento só entram em produção após publicação. Configure a função para
suportar 300 segundos; o limite depende da configuração do projeto, incluindo Fluid Compute.
Consulte [duração das funções](https://vercel.com/docs/functions/configuring-functions/duration)
e [limites do cron](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Evidência e limites

Os testes usam ZIP/XLSX válidos construídos em teste e SQLite com as migrações reais.
Cobrem retomada, permissões, concorrência, transação revertida, integridade CRC, mudança
de cabeçalhos, alertas, preços em centavos, leitura pelos orçamentos e limpeza.

**A publicação real da Caixa ainda não foi homologada nesta implementação.** As tentativas
locais de download em 13/09/2026 receberam HTTP 429. O painel permite fazer essa conferência
no ambiente publicado, mas um download que falha continua sendo falha: não existem preços
de demonstração nem alegação de que fixtures sejam uma tabela oficial validada.
Layouts que não ofereçam os quatro títulos na linha escolhida param para adaptação.

A [página SINAPI da Caixa](https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi/Paginas/default.aspx)
informa que, desde 2025, o pacote XLSX inclui todas as UFs. O caminho antigo por UF/regime
não é utilizado para as publicações novas.

## Fonte externa existente

`SINAPI_API_URL`, `SINAPI_API_TOKEN`, `SINAPI_API_KEY_HEADER` e `SINAPI_SEARCH_PATH` continuam
restritos ao servidor. O adaptador envia busca, UF, competência e regime à fonte configurada.
A homologação desse contrato externo continua responsabilidade da integração existente.
