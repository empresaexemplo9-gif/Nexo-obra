# Modelos de planilha

A planilha em branco aceita qualquer dado. Os modelos existem para o caso mais comum: um
objetivo definido, com o cabeçalho, as fórmulas e o **papel de cada coluna já marcado** —
então a leitura financeira funciona desde a primeira linha digitada, sem configurar nada.

Nenhum modelo traz dado de exemplo. Estrutura ajuda; número inventado atrapalha.

## Projeto e obra

| Modelo | Para que serve |
| --- | --- |
| **Orçamento de obra** | Custo por etapa e item, BDI aplicado e a margem com que cada etapa está sendo vendida. |
| **Cronograma físico-financeiro** | Previsto contra realizado de cada etapa, em avanço e em desembolso, com o desvio em reais e em %. |
| **Medição de obra** | Quanto medir no período por etapa, a partir do executado acumulado menos o já medido, e a sobra depois do custo. |
| **Apropriação de horas** | Quanto cada hora técnica custa, quanto foi cobrada e em que projeto a hora rende ou perde. |
| **Levantamento de quantitativos** | Área, volume e quantidade com perda por ambiente, para fechar o material. |
| **Compras e cotações** | Comparação de fornecedores do mesmo insumo e quanto a melhor cotação economizou. |

## Financeiro

| Modelo | Para que serve |
| --- | --- |
| **Fluxo de caixa** | Entrada, saída e saldo acumulado dia a dia, para saber quando o caixa aperta. |
| **Resultado por centro** | Receita, custo direto, equipe e despesa fixa de cada projeto ou serviço, com a margem de cada um. |

## Comercial

| Modelo | Para que serve |
| --- | --- |
| **Funil comercial** | Propostas por etapa, valor ponderado pela probabilidade e com que margem se está propondo. |
| **Honorários por etapa** | Distribuição do honorário entre as etapas do projeto, comparada com o custo das horas gastas em cada uma. |

## Como o modelo conversa com a leitura financeira

Os papéis de coluna já vêm marcados, então a aba *Leitura financeira* responde de imediato.
Os que mais rendem:

- **Apropriação de horas** libera preço mínimo da hora e margem por hora, porque traz horas
  e custo de equipe marcados.
- **Resultado por centro** é o mais direto: aponta o projeto que dá prejuízo e o aumento de
  preço necessário para chegar à margem definida.
- **Funil comercial** mostra em qual serviço a proposta sai abaixo da margem — antes de o
  contrato ser fechado.

**Levantamento de quantitativos** e **Compras** não têm receita marcada de propósito: são
planilhas de medida e de custo. A leitura diz isso em vez de fabricar uma margem.

## A linha de totais fica fora da conta

Todo modelo termina com uma linha de soma. Essa linha é marcada como **ignorada** na
leitura financeira: sem isso, ela entraria como mais um lançamento e **dobraria** receita,
custo e horas de toda a análise.

Se você criar uma linha de totais à mão numa planilha em branco, informe o número dela no
campo *Linha de totais, fora da conta*, na aba de leitura.

## Como o modelo é montado

O navegador escolhe **qual** modelo; quem monta o conteúdo é o servidor. Mandar conteúdo
junto com um `templateId` não substitui o modelo — o do servidor prevalece. Assim duas
pessoas que escolhem o mesmo modelo recebem exatamente a mesma estrutura e as mesmas
fórmulas.
