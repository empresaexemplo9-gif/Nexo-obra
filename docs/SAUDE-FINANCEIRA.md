# Planilha de saúde financeira

Uma planilha comum, neutra até existir dado. A partir do momento em que há conteúdo, ela
lê esse conteúdo e responde três perguntas: **onde você ganha, onde você perde e quanto
o preço precisa subir**.

## Neutra até o dado, com sentido depois dele

A planilha não sabe o que é custo, receita ou hora — e não tenta adivinhar por valor. O
sentido vem do **papel de cada coluna**, marcado na aba *Leitura financeira*:

| Papel | Para que serve |
| --- | --- |
| Setor / categoria | separa serviço, obra, cliente ou área para comparar |
| Receita (R$) | o que entra |
| Custo (R$) | o que sai, fora colaboradores |
| Custo com colaborador (R$) | mão de obra, equipe, prestador |
| Horas trabalhadas | libera margem por hora e preço mínimo da hora |
| Quantidade e Preço unitário | quando não há coluna de receita, ela é calculada por quantidade × preço |
| Descrição, Data | contexto, não entram em conta |

Assim que há dados, a planilha **propõe** os papéis lendo o cabeçalho — "Faturamento" vira
Receita, "Salário da equipe" vira Custo com colaborador, "Centro de custo" vira Setor. A
proposta nunca é aplicada sozinha: uma coluna marcada errado mudaria todos os números,
então a confirmação é de quem está usando.

## O que ela aponta, e de onde tira

Tudo é aritmética sobre o que foi marcado. Nenhum número é estimado, arredondado para
cima ou preenchido por suposição:

- **Margem**: `receita − custo`, e a porcentagem sobre a receita.
- **Preço a aumentar**: para a margem que você definir, a receita precisa ser
  `custo ÷ (1 − margem)`. A planilha mostra esse valor e a diferença em porcentagem sobre
  o preço atual. Se a margem já está na meta, ela diz que **não é preciso aumentar**.
- **Ou cortar custo**: a alternativa equivalente, em reais, para chegar à mesma margem.
- **Margem por hora**: quanto a hora rende, quanto custa, e o preço mínimo por hora para a
  meta. Sem coluna de horas, essa parte **não aparece** — no lugar dela, o aviso de qual
  coluna marcar.
- **Peso dos colaboradores**: quanto consomem da receita, comparado com o teto que a meta
  permite para o total de custos.
- **Onde ganha e onde perde**: cada setor com receita, custo, sobra, margem e o ajuste de
  preço necessário; os que dão prejuízo aparecem primeiro, com o quanto subir ou cortar.

Quando falta dado para uma conta, a conta não sai. No lugar dela vai o que precisa ser
marcado. É a diferença entre uma leitura real e um palpite com cara de número.

## Precisão do dinheiro

As contas passam pelo mesmo motor da planilha, que corta o ruído da representação binária:
`12 × 89,90` é `1.078,80`, e "cortar R$ 7.000" é exatamente sete mil, não
`7.000,00000000001`. Valores com fórmula entram pelo resultado calculado, não pelo texto.

## Quem abre

Esta planilha é **governada pelo superadministrador**, e nasce fechada:

| Ação | Quem pode |
| --- | --- |
| Criar e excluir | somente o superadministrador |
| Liberar e revogar acesso | somente o superadministrador |
| Ver | quem receber liberação de leitura |
| Ver e editar | quem receber liberação de edição |

Sem liberação, a planilha **não aparece na lista e não abre** — responde como inexistente,
sem revelar que existe, nem para o contratante da empresa. Cada liberação e revogação
entra na auditoria da empresa. A planilha comum e o documento continuam abertos à empresa
como antes.

## Edição

Além da grade com fórmulas, a barra traz inserir e remover linha e coluna, preencher para
baixo e ordenar. Inserir e remover **reajustam as referências das fórmulas**, como no
Excel: uma faixa `SOMA(A1:A2)` vira `SOMA(A1:A3)` quando uma linha entra no meio, e uma
fórmula que apontava para a linha removida passa a mostrar `#REF!` em vez de somar a
célula errada em silêncio.

Ordenar move linhas inteiras. Quando há fórmula nas linhas a ordenar, a operação é
**recusada com aviso** — mover referências para o lugar errado seria pior do que não
ordenar.

## Linha de totais

Uma linha de soma no rodapé entraria como mais um lançamento e dobraria a leitura inteira.
Por isso ela é marcada como ignorada — os [modelos](MODELOS-DE-PLANILHA.md) já nascem
assim, e numa planilha em branco o campo *Linha de totais, fora da conta* resolve.

## Limite conhecido

São 52 colunas e 500 linhas. Não há gráfico, tabela dinâmica, macro nem formatação
condicional. A leitura financeira cobre margem, hora, colaborador e setor; ela não projeta
cenários futuros nem sugere preço de mercado, porque isso exigiria dados que a planilha
não tem.
