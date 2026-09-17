# Referência SINAPI dentro da plataforma

O superadmin prepara, analisa e ativa a referência em **/superadmin → Referência SINAPI**.
Os orçamentos consultam os preços persistidos localmente. Goiás (`GO`) é a UF padrão da
interface, mas as **27 UFs** são aceitas pelo mesmo contrato. Cada item copiado para um
orçamento preserva a UF, competência e regime usados na `sourceReference`, portanto uma
atualização futura da base não altera um orçamento já salvo.

## Fonte oficial da CAIXA — caminho principal

A partir de 2025 a CAIXA publica um único pacote mensal XLSX nacional em
`SINAPI-AAAA-MM-formato-xlsx.zip`. Esse pacote contém os relatórios de insumos e
composições para todas as UFs. A plataforma lê diretamente esse pacote oficial, identifica
as tabelas de insumos e composições, seleciona a coluna da UF pedida e separa os regimes
**Desonerado** e **Não desonerado**.

Não é necessária uma chave do Orçamentador para importar a referência oficial. O fluxo é:

1. escolher competência, UF e regime;
2. baixar o ZIP XLSX oficial da CAIXA;
3. reconhecer automaticamente os relatórios nacionais de insumos e composições;
4. extrair apenas os preços da UF/regime selecionados;
5. gravar a referência local e comparar com a competência anterior da mesma UF/regime;
6. exigir revisão humana na primeira ativação ou quando a estrutura/quantidade/preços mudarem fora dos limites;
7. ativar a nova referência sem alterar snapshots já usados em orçamentos.

Se a CAIXA recusar o download automatizado no ambiente de hospedagem, o mesmo painel aceita
o **ZIP oficial da CAIXA** por envio manual. O arquivo enviado passa pelas mesmas validações,
assinaturas, comparação, importação e aprovação; apenas a etapa de aquisição muda.

Para referências até 2024 permanece o importador histórico por UF/regime e mapeamento
manual, porque a nomenclatura e a estrutura desses pacotes variam ao longo do acervo.

## Cobertura por UF, regime e competência

A persistência usa uma referência independente por combinação:

```text
competência + UF + regime
```

Assim, `2026-08 / GO / Não desonerado` e `2026-08 / SP / Não desonerado` podem coexistir e
ser consultadas sem misturar preços. Ativar uma nova competência remove apenas a referência
anterior **da mesma UF e regime**.

A busca em orçamento oferece todas as UFs:

`AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO`

Quando a UF não é enviada pela API, a plataforma assume `GO`. A competência pode ficar vazia
na busca para usar a referência local aprovada mais recente da UF/regime.

## Atualização mensal

`vercel.json` chama `/api/cron/sinapi` diariamente às 09:00 UTC. A chamada diária é uma
verificação: para a combinação de UF/regime homologada no painel, a atualização efetiva
acontece uma vez para a competência do mês anterior e não duplica um mês já ativo.

Depois que a primeira referência de uma combinação é aprovada, o superadmin pode habilitar
**Renovar automaticamente**. A assinatura estrutural não inclui preços nem a competência;
ela representa apenas o contrato das colunas. Se o contrato mudar, a nova tabela é importada
mas fica pendente de revisão humana em vez de substituir silenciosamente a vigente.

Os alarmes permanecem conservadores: quantidade com variação acima de 20%, mais de 100
itens adicionais sem preço utilizável, ou mais de 5% dos itens coincidentes com mudança de
unidade/variação de preço acima de 50% impedem a troca automática.

## Orçamentador — fallback opcional

O adaptador do Orçamentador foi mantido somente como fallback quando `SINAPI_API_TOKEN`
estiver configurado. Ele não é requisito para o funcionamento da base oficial local.

O contrato implementado segue o SDK `orcamentador/orcamentador-sdk` no commit
`db5e9129446ec96c66341f0c323c20a8e52b265d`: base `https://orcamentador.com.br/api`,
autenticação no header `X-API-Key`, insumos em `/insumos`, composições em `/composicoes`,
encargos em `/encargos` e indicadores em `/indicadores`.

Configuração opcional:

```dotenv
SINAPI_API_URL=https://orcamentador.com.br/api
SINAPI_API_KEY_HEADER=X-API-Key
SINAPI_SEARCH_PATH=/insumos
SINAPI_API_TOKEN=
```

A busca de orçamento consulta primeiro a referência local aprovada. Se não houver referência
local e o token opcional estiver configurado, o adaptador externo pode ser usado para uma
competência explicitamente informada.

## Primeira conferência e contingência

Aplique as migrações pelo botão **Atualizar banco de dados** e mantenha
`BLOB_READ_WRITE_TOKEN` e `CRON_SECRET` na hospedagem. Para a primeira conferência, selecione
competência, UF e regime no superadmin e use **Baixar e preparar referência oficial**. Se o
download for bloqueado pela CAIXA, abra a contingência e envie exatamente o ZIP XLSX oficial.

O fluxo mantém as fases `baixando → importando → pendente → aprovada` quando o pacote
nacional é reconhecido automaticamente. Pacotes históricos/não reconhecidos usam o caminho
`baixando → conferindo → interpretando → importando → pendente → aprovada`.

A ativação confere a quantidade persistida e troca a referência na mesma transação que
remove os itens e a competência anterior da mesma UF e regime. Valores já copiados para
orçamentos continuam como snapshots e não são alterados retroativamente.

## Segurança operacional

`CRON_SECRET` autentica o cron e nunca pertence ao Git. `SINAPI_API_TOKEN`, quando usado,
também é somente server-side. O sincronizador usa um lease global para impedir duas
atualizações concorrentes.

Cada pacote oficial recebe SHA-256 no laudo. Nenhum preço fictício é criado. Resposta curta
demais, pacote não reconhecido, falha de autenticação externa, rate limit, erro de rede ou
divergência de persistência preservam a referência que já estava ativa.
