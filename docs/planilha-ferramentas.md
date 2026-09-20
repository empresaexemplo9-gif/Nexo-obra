# Ferramentas da planilha

Esta entrega amplia o editor existente. Não representa equivalência integral com Excel ou Google Planilhas.

## Recursos adicionados

- Desfazer e refazer até 50 alterações nesta sessão, incluindo edição, estrutura, formatos, importação e receitas. Grades grandes reduzem o número de passos para respeitar o orçamento de 400.000 células no histórico. O histórico não volta a uma revisão antiga do servidor. Os botões descrevem a ação; na grade, Ctrl+Z desfaz e Ctrl+Shift+Z ou Ctrl+Y refazem.
- Moeda brasileira, percentual e número com duas casas por coluna. A formatação não arredonda o valor utilizado nas fórmulas.
- Negrito nas células selecionadas e aplicação das larguras previstas pelos modelos. Formatos, larguras e negrito acompanham inserções e exclusões de linhas/colunas.
- Filtro visual por conteúdo. As fórmulas continuam usando todas as linhas. Seleções podem incluir linhas ocultas, conforme aviso na interface.
- Ctrl+C copia valores como tabela; Ctrl+V cola tabelas TSV a partir da célula ativa, inclusive do Excel ou Google Planilhas, expandindo a grade quando necessário. Vírgulas decimais e ponto e vírgula de fórmulas são preservados. Blocos que excedem os limites são recusados inteiros. Para CSV, escolha o separador em Ferramentas. O editor de uma célula mantém os atalhos normais de texto.
- Importação CSV/TSV com separador selecionável, aspas, campos multilinha e validação antes de alterar a grade. O destino é substituído e a operação pode ser desfeita.
- Localizar e substituir texto na seleção, com prévia; fórmulas são preservadas.
- Receitas de ações em sequência: remover espaços, maiúsculas, minúsculas, conversão numérica, fórmulas em valores e limpeza. A prévia informa células afetadas. Uma mudança posterior na planilha invalida a prévia.
- Até 20 receitas por planilha, com até 12 passos. São salvas pelo mesmo botão Salvar e validadas no servidor. Não executam JavaScript, macros ou chamadas externas.
- Referências absolutas e mistas (`$A$1`, `$A1`, `A$1`) no cálculo e no preenchimento. Alterações estruturais continuam atualizando os endereços.
- Preencher para baixo respeita o intervalo selecionado; sem intervalo, segue até o fim da coluna.
- Documento e grade respeitam o acesso de leitura na interface. Durante o salvamento, a edição fica temporariamente desabilitada.
- Importação dos módulos da empresa recusa uma tabela que ultrapasse os limites a partir da célula ativa e conserva casas decimais.

## Uso

1. Abra a planilha e selecione células, uma linha ou uma coluna.
2. Abra **Ferramentas e automações da seleção**.
3. Adicione as ações na ordem desejada ou carregue uma receita.
4. Clique em **Prévia da automação**, confira e aplique.
5. Para reutilizar a sequência, dê um nome, clique em **Guardar receita** e salve a planilha.

As receitas são executadas manualmente na seleção atual. Não há execução agendada ou atualização de fontes em segundo plano nesta entrega.

## Limites e recursos ainda não implementados

A grade mantém 500 linhas, 52 colunas, até 20.000 células preenchidas e 2.000 caracteres por célula. CSV é limitado a 2 MB. O histórico em memória desaparece ao recarregar a página.

Ainda não há edição simultânea em tempo real, referências entre abas, tabelas dinâmicas, editor geral de gráficos, VBA/Apps Script, Power Query, validação de dados, formatação condicional ou importação/exportação XLSX completa no editor. O catálogo de funções na interface é o conjunto efetivamente suportado pelo motor. Arquivos XLSX podem fornecer dados via copiar/colar ou exportação CSV.

## Validação

Testes do motor e da API verificam cálculo, isolamento por empresa, permissões, revisão concorrente, modelos e referências. Testes adicionais cobrem importação atômica, precisão decimal, receitas, histórico e ações reais no DOM. A conferência visual local usa apenas dados fictícios, sem acesso ao banco de produção.
