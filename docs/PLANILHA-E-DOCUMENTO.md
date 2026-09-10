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

## Limites

São 52 colunas e 500 linhas por planilha, e no máximo 20 mil células preenchidas. Isso não
é um substituto do Excel: é a superfície de cálculo sobre os dados reais da plataforma,
para encurtar o caminho entre o dado e o total.
