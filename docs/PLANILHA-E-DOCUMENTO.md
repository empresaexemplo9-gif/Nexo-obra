# Planilha e documento

Ferramenta de cálculo dentro da plataforma, para não precisar exportar dados, somar em
outro programa e voltar com o número na mão. Todo acesso com empresa aberta pode usar.

## O que ela faz

- Grade com fórmulas, navegação por teclado e recálculo imediato.
- Importação de dados **reais** da empresa: itens de orçamento, projetos e obras, clientes
  e tarefas. O bloco é colado a partir da célula selecionada, já com cabeçalho — e, no caso
  do orçamento, com a coluna de total já preenchida com a fórmula na linha certa.
- Documento de texto que puxa números da mesma peça: escrever `{{=SOMA(A1:A20)}}` ou
  `{{B4}}` mostra o valor calculado.
- Exportação em CSV com os valores calculados, não com as fórmulas.

## Convenção de escrita

Segue o Excel em português:

- **vírgula** é separador decimal: `ARRED(1,005;2)` devolve `1,01`;
- **ponto e vírgula** separa argumentos: `SOMASE(B1:B3;"receber";C1:C3)`;
- ao digitar em uma célula valem os dois formatos: `1.234,56` e `1234.56`;
- `%` divide por cem: `=A1*15%`.

Os nomes das funções são aceitos em português e em inglês (`SOMA` e `SUM`, `MÉDIA` e
`AVERAGE`, `MÁXIMO` e `MAX`).

### Funções disponíveis

`SOMA`, `MEDIA`, `MEDIANA`, `MIN`, `MAX`, `CONT.NUM`, `CONT.VALORES`, `SE`, `E`, `OU`,
`NAO`, `SOMASE`, `CONT.SE`, `PROCV`, `ARRED`, `ABS`, `INT`, `TRUNCAR`, `TETO`, `PISO`,
`POTENCIA`, `RAIZ`, `HOJE`, `AGORA`, `CONCAT`, `ESQUERDA`, `DIREITA`, `MAIUSCULA`,
`MINUSCULA`, `NUM.CARACT`, além dos operadores `+ - * / ^ % &` e das comparações.

## Dinheiro sem erro de arredondamento

`12 * 89,90` precisa dar `1078,80`, e não `1078,8000000000002`. Cada operação volta às 15
casas significativas que o `double` representa com segurança, e `ARRED` arredonda meio
para longe do zero — `ARRED(1,005;2)` é `1,01`, como se espera de um valor em reais.

Os valores importados saem do banco em centavos e chegam à planilha em reais, então a
soma da tela é a soma do banco.

## O que é guardado

O banco guarda **o que foi digitado**, nunca o resultado. O cálculo é refeito por
`lib/spreadsheet.ts`, que roda igual no navegador e no servidor — a mesma entrada produz o
mesmo número nos dois lados, então não existe um total gravado que possa divergir da
fórmula que o gerou.

Cada planilha tem uma revisão. Salvar com uma revisão antiga responde `409` em vez de
sobrescrever em silêncio o trabalho de outra pessoa.

## Autorização

- A planilha pertence à empresa aberta e nunca aparece em outra: toda consulta filtra pelo
  `organization_id` resolvido no servidor.
- Qualquer acesso da empresa pode criar, abrir e editar.
- Excluir: quem criou, o contratante (`owner`), um administrador ou o superadministrador.
- Importar dados reais respeita a permissão do módulo de origem. Sem leitura em
  Orçamentos, a origem nem é oferecida, e pedir direto responde `403`.
- Criação, alteração e exclusão entram na auditoria da empresa.

## Seleção e barra de resumo

Arraste com o mouse, use `Shift` + clique ou `Shift` + setas para marcar um intervalo.
`Ctrl` + clique (ou `⌘` + clique) continua somando células avulsas, para o caso espalhado
que o retângulo não cobre. No toque o arrasto rola a grade — que é o gesto esperado no
celular e o único jeito de alcançar as colunas da direita numa tela de 320 px.

A barra abaixo da grade responde cinco perguntas sobre o que está marcado: quantas células
estão **preenchidas**, a **soma**, a **média**, o **mínimo** e o **máximo**. Células com
erro são contadas à parte e ficam fora das contas — tratar erro como zero é exatamente o
defeito que o motor deixou de ter. Quando não há número na seleção a barra diz isso, em
vez de exibir `Soma 0`: zero se lê como zero de verdade.

Com uma célula só marcada, a barra mostra o **total da coluna** — o valor da célula já está
na barra de fórmulas logo acima, e repeti-lo custava justamente a leitura que falta.

## Seleção de linha e coluna

Clicar no cabeçalho seleciona a linha ou a coluna inteira: as células ficam destacadas, a
barra de resumo passa a falar do eixo escolhido e o cursor para na primeira célula
livre do eixo, que é onde o total costuma entrar. O total do eixo **não inclui a linha de
total** marcada pelo modelo, senão o número apareceria dobrado. Com a linha selecionada, `SOMA` e as
demais funções de intervalo montam uma faixa horizontal (`SOMA(A5:D5)`); com a coluna,
vertical (`SOMA(A1:A4)`). O intervalo sempre termina antes do cursor, para a fórmula não se
incluir e virar `#CIRCULAR!`. Sem nada selecionado vale a coluna do cursor.

## Edição estrutural

Inserir e remover linha ou coluna **reajusta as referências das fórmulas**: `SOMA(A1:A2)`
vira `SOMA(A1:A3)` quando entra uma linha no meio, e o que apontava para a linha removida
passa a `#REF!` em vez de somar a célula errada. Preencher para baixo desloca as
referências relativas. Ordenar é recusado quando há fórmula nas linhas a mover.

## Saúde financeira

A planilha de análise, com leitura de margem e preço, tem regras próprias de acesso e está
descrita em [Saúde financeira](SAUDE-FINANCEIRA.md).

## Limites

São 52 colunas e 500 linhas por planilha, e no máximo 20 mil células preenchidas. Isso não
é um substituto do Excel: é a superfície de cálculo sobre os dados reais da plataforma,
para encurtar o caminho entre o dado e o total.


## Números digitados

O ponto separa **milhar** quando não há vírgula e os grupos têm três dígitos, como no Excel
em português: `1.500` vale mil e quinhentos, `12.000` vale doze mil. Com vírgula, ela é a
casa decimal: `1.234,56`. `1234.56` continua valendo mil duzentos e trinta e quatro e
cinquenta e seis — é a forma que a inserção de dados reais produz.

## Erro em fórmula

Erro contamina quem depende dele. Se `E3` vale `#DIV/0!`, então `F3 = D3*E3` também vale
`#DIV/0!`, e o total da coluna igual. Antes a célula com erro valia zero para quem a
referenciava, e o total do orçamento fechava como se estivesse certo, com uma parcela
faltando.

Para seguir mesmo assim, diga isso explicitamente: `=SEERRO(PROCV(...);0)`. `SEERRO` não
engole `#CIRCULAR!` — alternativa não desfaz um ciclo, só o esconderia.
