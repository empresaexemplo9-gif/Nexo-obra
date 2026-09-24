// Modelos de planilha. Cada um nasce com objetivo, cabeçalho, fórmulas e os papéis de
// coluna já marcados — então a leitura financeira funciona desde a primeira linha digitada.
// Nenhum modelo traz dado de exemplo: estrutura é ajuda, número inventado é ruído.

import type { ColumnRole } from "@/lib/finance-analysis";
import { cellKey, columnName, type SheetCells } from "@/lib/spreadsheet";

export type TemplateCategory = "obra" | "financeiro" | "comercial";

export type WorksheetTemplate = {
  id: string;
  name: string;
  purpose: string;
  category: TemplateCategory;
  headers: string[];
  // A fórmula usa {l} para a linha atual e {f}/{u} para a primeira e a última linha de dados.
  formulas: Record<string, string>;
  totals: string[];
  totalLabel: string;
  dataRows: number;
  roles: Record<string, ColumnRole>;
  targetMarginPercent: number;
  widths?: Record<string, number>;
  note: string;
};

export const templateCategories: Record<TemplateCategory, string> = {
  obra: "Projeto e obra",
  financeiro: "Financeiro",
  comercial: "Comercial",
};

export const worksheetTemplates: WorksheetTemplate[] = [
  {
    id: "orcamento-obra",
    name: "Orçamento de obra",
    purpose: "Montar o custo por etapa e item, aplicar BDI e ver com que margem cada etapa está sendo vendida.",
    category: "obra",
    headers: ["Etapa", "Item", "Unidade", "Quantidade", "Custo unitário", "Custo total", "BDI %", "Preço de venda", "Margem"],
    formulas: {
      F: '=SE(D{l}="";"";D{l}*E{l})',
      H: '=SE(F{l}="";"";ARRED(F{l}*(1+G{l}/100);2))',
      I: '=SE(H{l}="";"";H{l}-F{l})',
    },
    totals: ["F", "H", "I"],
    totalLabel: "Total do orçamento",
    dataRows: 60,
    roles: { A: "setor", B: "descricao", C: "descricao", D: "quantidade", F: "custo", H: "receita" },
    targetMarginPercent: 25,
    widths: { B: 240, A: 160 },
    note: "Preencha quantidade, custo unitário e BDI. Custo total, preço e margem saem sozinhos.",
  },
  {
    id: "cronograma-fisico-financeiro",
    name: "Cronograma físico-financeiro",
    purpose: "Acompanhar o previsto contra o realizado de cada etapa, em avanço e em desembolso.",
    category: "obra",
    headers: ["Etapa", "Início", "Término", "Valor previsto", "% previsto", "Valor realizado", "% realizado", "Desvio (R$)", "Desvio (%)"],
    formulas: {
      H: '=SE(F{l}="";"";F{l}-D{l})',
      I: '=SE(OU(D{l}="";D{l}=0);"";ARRED(H{l}/D{l}*100;1))',
    },
    totals: ["D", "F", "H"],
    totalLabel: "Total da obra",
    dataRows: 40,
    roles: { A: "setor", B: "data", C: "data", D: "custo" },
    targetMarginPercent: 20,
    widths: { A: 220 },
    note: "O desvio compara realizado com previsto. Valor positivo é gasto acima do planejado.",
  },
  {
    id: "medicao-obra",
    name: "Medição de obra",
    purpose: "Fechar quanto medir no período por etapa e quanto sobra depois do custo executado.",
    category: "obra",
    headers: ["Etapa", "Valor contratado", "% executado", "% já medido", "% a medir", "Valor a faturar", "Custo da etapa", "Margem"],
    formulas: {
      E: '=SE(C{l}="";"";C{l}-D{l})',
      F: '=SE(E{l}="";"";ARRED(B{l}*E{l}/100;2))',
      H: '=SE(F{l}="";"";F{l}-G{l})',
    },
    totals: ["B", "F", "G", "H"],
    totalLabel: "Total da medição",
    dataRows: 40,
    roles: { A: "setor", F: "receita", G: "custo" },
    targetMarginPercent: 20,
    widths: { A: 220 },
    note: "Informe o percentual executado acumulado e o já medido. O que falta medir vira valor a faturar.",
  },
  {
    id: "apropriacao-horas",
    name: "Apropriação de horas",
    purpose: "Saber quanto cada hora técnica custa, quanto ela foi cobrada e em que projeto a hora rende ou perde.",
    category: "obra",
    headers: ["Projeto ou obra", "Colaborador", "Data", "Horas", "Custo da hora", "Custo total", "Valor cobrado"],
    formulas: { F: '=SE(D{l}="";"";ARRED(D{l}*E{l};2))' },
    totals: ["D", "F", "G"],
    totalLabel: "Total do período",
    dataRows: 80,
    roles: { A: "setor", B: "descricao", C: "data", D: "horas", F: "custo_colaborador", G: "receita" },
    targetMarginPercent: 30,
    widths: { A: 200, B: 180 },
    note: "É o modelo que mais alimenta a leitura financeira: com horas e custo, ela calcula o preço mínimo da hora.",
  },
  {
    id: "levantamento-quantitativos",
    name: "Levantamento de quantitativos",
    purpose: "Calcular área, volume e quantidade com perda por ambiente, para fechar o material a comprar.",
    category: "obra",
    headers: ["Ambiente", "Elemento", "Comprimento (m)", "Largura (m)", "Altura (m)", "Área (m²)", "Volume (m³)", "Perda %", "Quantidade final"],
    formulas: {
      F: '=SE(C{l}="";"";ARRED(C{l}*D{l};3))',
      G: '=SE(OU(F{l}="";E{l}="");"";ARRED(F{l}*E{l};3))',
      I: '=SE(F{l}="";"";ARRED(F{l}*(1+H{l}/100);3))',
    },
    totals: ["F", "G", "I"],
    totalLabel: "Total levantado",
    dataRows: 60,
    roles: { A: "setor", B: "descricao" },
    targetMarginPercent: 20,
    widths: { A: 180, B: 200 },
    note: "Só medidas e quantidades. Sem receita ou custo marcados, a leitura financeira não se aplica aqui.",
  },
  {
    id: "compras-cotacoes",
    name: "Compras e cotações",
    purpose: "Comparar fornecedores do mesmo insumo e registrar quanto a melhor cotação economizou.",
    category: "obra",
    headers: ["Insumo", "Fornecedor", "Quantidade", "Preço unitário", "Total", "Melhor preço unitário", "Economia"],
    formulas: {
      E: '=SE(C{l}="";"";ARRED(C{l}*D{l};2))',
      G: '=SE(OU(E{l}="";F{l}="");"";ARRED(E{l}-C{l}*F{l};2))',
    },
    totals: ["E", "G"],
    totalLabel: "Total das compras",
    dataRows: 60,
    roles: { A: "setor", B: "descricao", E: "custo" },
    targetMarginPercent: 20,
    widths: { A: 200, B: 180 },
    note: "Sem coluna de receita, a leitura mostra o custo por insumo, não margem.",
  },
  {
    id: "fluxo-de-caixa",
    name: "Fluxo de caixa",
    purpose: "Ver entrada, saída e saldo acumulado dia a dia, para saber quando o caixa aperta.",
    category: "financeiro",
    headers: ["Data", "Descrição", "Categoria", "Entrada", "Saída", "Resultado do dia", "Saldo acumulado"],
    formulas: {
      F: '=SE(E(D{l}="";E{l}="");"";D{l}-E{l})',
      // O saldo vem da soma do período inteiro até esta linha, não do saldo da linha de
      // cima. Encadear `G{p}` fazia o acumulado REINICIAR depois de qualquer linha em
      // branco: a de cima valia "", que numa conta vale 0, e o saldo voltava do zero sem
      // avisar. Somar as colunas desde o começo é imune a lacuna no meio.
      G: '=SE(F{l}="";"";SOMA(D{f}:D{l})-SOMA(E{f}:E{l}))',
    },
    totals: ["D", "E", "F"],
    totalLabel: "Total do período",
    dataRows: 80,
    roles: { C: "setor", B: "descricao", A: "data", D: "receita", E: "custo" },
    targetMarginPercent: 20,
    widths: { B: 240, C: 160 },
    note: "O saldo acumulado soma a linha anterior. Use a categoria para a leitura comparar onde entra e onde sai.",
  },
  {
    id: "resultado-mensal",
    name: "Resultado por centro",
    purpose: "Fechar receita, custo direto, equipe e despesa fixa de cada projeto ou serviço, e ver a margem de cada um.",
    category: "financeiro",
    headers: ["Projeto ou serviço", "Receita", "Custos diretos", "Custo com equipe", "Despesas fixas", "Resultado", "Margem %"],
    formulas: {
      F: '=SE(B{l}="";"";B{l}-C{l}-D{l}-E{l})',
      G: '=SE(OU(B{l}="";B{l}=0);"";ARRED(F{l}/B{l}*100;1))',
    },
    totals: ["B", "C", "D", "E", "F"],
    totalLabel: "Resultado do período",
    dataRows: 40,
    roles: { A: "setor", B: "receita", C: "custo", D: "custo_colaborador", E: "custo" },
    targetMarginPercent: 20,
    widths: { A: 240 },
    note: "É o modelo mais direto para a leitura financeira: ela aponta o centro que dá prejuízo e o aumento de preço necessário.",
  },
  {
    id: "funil-comercial",
    name: "Funil comercial",
    purpose: "Acompanhar propostas por etapa, o valor ponderado pela probabilidade e com que margem se está propondo.",
    category: "comercial",
    headers: ["Cliente", "Serviço", "Etapa", "Valor proposto", "Probabilidade %", "Valor ponderado", "Custo estimado", "Margem proposta", "Próximo passo"],
    formulas: {
      F: '=SE(D{l}="";"";ARRED(D{l}*E{l}/100;2))',
      H: '=SE(D{l}="";"";D{l}-G{l})',
    },
    totals: ["D", "F", "G", "H"],
    totalLabel: "Total do funil",
    dataRows: 60,
    roles: { A: "descricao", B: "setor", D: "receita", G: "custo" },
    targetMarginPercent: 30,
    widths: { A: 200, B: 180, I: 220 },
    note: "A leitura mostra em qual serviço a proposta sai abaixo da margem — antes de o contrato ser fechado.",
  },
  {
    id: "honorarios-etapas",
    name: "Honorários por etapa de projeto",
    purpose: "Distribuir o honorário entre as etapas do projeto e comparar com as horas realmente gastas em cada uma.",
    category: "comercial",
    // A décima coluna é vazia de propósito: I1 é o RÓTULO e J1 é onde o valor do contrato
    // é digitado. Sem ela a planilha nascia com 9 colunas (A–I), `J1` ficava fora da
    // grade, não havia como digitar o valor — e cada etapa fechava em 0, sem erro nenhum.
    headers: ["Etapa", "% do honorário", "Valor da etapa", "Horas previstas", "Horas gastas", "Custo das horas", "Margem da etapa", "", "Valor do contrato", ""],
    formulas: {
      // J1 guarda o valor do contrato; cada etapa recebe a fatia do percentual.
      // Enquanto J1 estiver vazio a etapa fica vazia, e não zero: zero é um número que a
      // tela exibe sem ninguém desconfiar.
      C: '=SE(OU(B{l}="";J1="");"";ARRED(J1*B{l}/100;2))',
      G: '=SE(C{l}="";"";C{l}-F{l})',
    },
    totals: ["B", "C", "D", "E", "F", "G"],
    totalLabel: "Total do contrato",
    dataRows: 20,
    roles: { A: "setor", C: "receita", E: "horas", F: "custo_colaborador" },
    targetMarginPercent: 30,
    widths: { A: 240, I: 160 },
    note: "Informe o valor do contrato em J1 e o percentual de cada etapa. Some 100% nas etapas.",
  },
];

export function templateById(id: string) {
  return worksheetTemplates.find((template) => template.id === id) ?? null;
}

export function buildTemplateContent(template: WorksheetTemplate) {
  const cells: SheetCells = {};
  const headerRow = 0;
  const firstDataRow = headerRow + 2;                       // 1-based, logo a linha 2
  const lastDataRow = headerRow + 1 + template.dataRows;
  const bold: string[] = [];

  template.headers.forEach((header, column) => {
    const key = cellKey({ column, row: headerRow });
    cells[key] = header;
    bold.push(key);
  });

  for (let row = headerRow + 1; row <= headerRow + template.dataRows; row += 1) {
    const line = row + 1;
    for (const [letter, formula] of Object.entries(template.formulas)) {
      cells[`${letter}${line}`] = formula
        .replaceAll("{l}", String(line))
        .replaceAll("{f}", String(firstDataRow))
        .replaceAll("{p}", String(line - 1))
        .replaceAll("{u}", String(lastDataRow));
    }
  }

  const totalRow = lastDataRow + 1;
  cells[`A${totalRow}`] = template.totalLabel;
  bold.push(`A${totalRow}`);
  for (const letter of template.totals) {
    cells[`${letter}${totalRow}`] = `=SOMA(${letter}${firstDataRow}:${letter}${lastDataRow})`;
    bold.push(`${letter}${totalRow}`);
  }

  return {
    cells,
    body: "",
    widths: template.widths ?? {},
    formats: {} as Record<string, "texto" | "numero" | "moeda" | "contabil" | "percentual">,
    bold,
    analysis: {
      headerRow,
      roles: template.roles,
      targetMarginPercent: template.targetMarginPercent,
      ignoreRows: [totalRow - 1],
    },
    columns: Math.max(template.headers.length, 8),
    rows: Math.min(500, totalRow + 2),
  };
}

export function columnLabels(template: WorksheetTemplate) {
  return template.headers.map((header, index) => ({ letter: columnName(index), header }));
}
