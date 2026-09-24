// Motor de cálculo da planilha. Roda igual no navegador e no servidor: a mesma função
// produz o mesmo número nos dois lados, então o que a pessoa vê é o que fica gravado.
// Nomes de função em português, com os equivalentes em inglês aceitos como sinônimo.

export type CellAddress = { column: number; row: number };
export type SheetCells = Record<string, string>;
export type CellResult = { value: number | string | boolean | null; error: string | null; display: string };
export type SheetResult = Record<string, CellResult>;

export const SHEET_MAX_COLUMNS = 52;
export const SHEET_MAX_ROWS = 500;

export function columnName(index: number) {
  let name = "";
  let value = index;
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  }
  return name;
}

export function columnIndex(name: string) {
  let index = 0;
  for (const character of name.toUpperCase()) index = index * 26 + (character.charCodeAt(0) - 64);
  return index - 1;
}

export function cellKey(address: CellAddress) {
  return `${columnName(address.column)}${address.row + 1}`;
}

export function parseCellKey(key: string): CellAddress | null {
  const match = /^([A-Za-z]{1,2})(\d{1,4})$/.exec(key.trim());
  if (!match) return null;
  const row = Number(match[2]) - 1;
  const column = columnIndex(match[1]);
  if (row < 0 || column < 0) return null;
  return { column, row };
}

const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 10 });

// 12 * 89,90 vale 1078,8 e não 1078,8000000000002. A representação binária não pode
// aparecer no resultado de uma conta de dinheiro, então cada operação volta às 15 casas
// significativas que o double representa com segurança.
export function exact(value: number) {
  if (!Number.isFinite(value) || value === 0 || Number.isInteger(value)) return value;
  return Number(value.toPrecision(15));
}

function roundHalfAway(value: number, digits: number) {
  const factor = 10 ** digits;
  const scaled = exact(value * factor);
  return (scaled < 0 ? -1 : 1) * Math.round(Math.abs(scaled)) / factor;
}

export function displayValue(value: number | string | boolean | null): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "VERDADEIRO" : "FALSO";
  if (typeof value === "number") return Number.isFinite(value) ? numberFormat.format(value) : "#NÚM!";
  return value;
}

/**
 * Ponto usado como separador de MILHAR, do jeito que o Excel em português decide:
 * grupos de exatamente três dígitos, sem vírgula em lugar nenhum.
 *
 * `1.500` → 1500, `12.000` → 12000, `1.234.567` → 1234567.
 * `1234.56` e `1.50` continuam decimais — dois dígitos não formam grupo de milhar, e
 * `1234.56` é a forma que `/api/worksheets/data` produz (centavos ÷ 100, no máximo duas
 * casas), então a regra nunca colide com o dado que o próprio produto insere.
 */
// Grupo inicial com zero ("0.125") não é milhar: nenhum número se escreve assim.
const MILHAR = /^[+-]?[1-9]\d{0,2}(\.\d{3})+$/;

// Um texto digitado vira número quando é inequivocamente numérico, aceitando os dois
// separadores usados no Brasil: "1.234,56" e "1234.56".
//
// O ponto sozinho era sempre lido como decimal, então `1.500` valia 1,5 — erro de mil
// vezes, em silêncio, num produto de orçamento. Pior: a exibição formata 1500 como
// "1.500", ensinando um formato que a leitura recusava. Copiar um número da tela para
// outra célula o dividia por mil.
export function parseNumber(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const cleaned = text.replace(/\s|R\$|%/g, "");
  const candidate = /,\d+(?:e[+-]?\d+)?$/i.test(cleaned)
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : MILHAR.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned.replace(/,/g, "");
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(candidate)) return null;
  const value = Number(candidate);
  if (!Number.isFinite(value)) return null;
  return text.includes("%") ? value / 100 : value;
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "ref"; value: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "name"; value: string }
  | { kind: "operator"; value: string }
  | { kind: "open" } | { kind: "close" } | { kind: "separator" };

class FormulaError extends Error {
  constructor(public code: string) { super(code); }
}

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < formula.length) {
    const character = formula[index];
    if (/\s/.test(character)) { index += 1; continue; }
    if (character === "(") { tokens.push({ kind: "open" }); index += 1; continue; }
    if (character === ")") { tokens.push({ kind: "close" }); index += 1; continue; }
    if (character === ";") { tokens.push({ kind: "separator" }); index += 1; continue; }
    if (character === "," && !/^,\d/.test(formula.slice(index))) { tokens.push({ kind: "separator" }); index += 1; continue; }
    if (character === '"' || character === "'") {
      const end = formula.indexOf(character, index + 1);
      if (end < 0) throw new FormulaError("#TEXTO!");
      tokens.push({ kind: "text", value: formula.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    const twoChar = formula.slice(index, index + 2);
    if (["<=", ">=", "<>"].includes(twoChar)) { tokens.push({ kind: "operator", value: twoChar }); index += 2; continue; }
    if ("+-*/^%=<>&".includes(character)) { tokens.push({ kind: "operator", value: character }); index += 1; continue; }
    const rest = formula.slice(index);
    const range = /^(\$?[A-Za-z]{1,2}\$?\d{1,4}):(\$?[A-Za-z]{1,2}\$?\d{1,4})/.exec(rest);
    if (range) { tokens.push({ kind: "range", from: range[1].replaceAll("$", "").toUpperCase(), to: range[2].replaceAll("$", "").toUpperCase() }); index += range[0].length; continue; }
    const reference = /^\$?[A-Za-z]{1,2}\$?\d{1,4}(?![A-Za-z0-9_.])/.exec(rest);
    if (reference) { tokens.push({ kind: "ref", value: reference[0].replaceAll("$", "").toUpperCase() }); index += reference[0].length; continue; }
    // Em português a vírgula é o separador decimal e `;` separa argumentos. O ponto
    // também é aceito como decimal, então 1,5 e 1.5 valem o mesmo.
    const numeric = /^(\d+(?:[.,]\d+)?|[.,]\d+)/.exec(rest);
    if (numeric) { tokens.push({ kind: "number", value: Number(numeric[0].replace(",", ".")) }); index += numeric[0].length; continue; }
    const name = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*/.exec(rest);
    if (name) { tokens.push({ kind: "name", value: name[0].toUpperCase() }); index += name[0].length; continue; }
    throw new FormulaError("#NOME?");
  }
  return tokens;
}

type Node =
  | { type: "number"; value: number }
  | { type: "text"; value: string }
  | { type: "ref"; key: string }
  | { type: "range"; from: string; to: string }
  | { type: "call"; name: string; args: Node[] }
  | { type: "unary"; operator: string; operand: Node }
  | { type: "binary"; operator: string; left: Node; right: Node };

function parse(tokens: Token[]): Node {
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function parseExpression(): Node { return parseComparison(); }

  function parseComparison(): Node {
    let left = parseConcat();
    while (peek()?.kind === "operator" && ["=", "<", ">", "<=", ">=", "<>"].includes((peek() as { value: string }).value)) {
      const operator = (take() as { value: string }).value;
      left = { type: "binary", operator, left, right: parseConcat() };
    }
    return left;
  }
  function parseConcat(): Node {
    let left = parseAdditive();
    while (peek()?.kind === "operator" && (peek() as { value: string }).value === "&") {
      take();
      left = { type: "binary", operator: "&", left, right: parseAdditive() };
    }
    return left;
  }
  function parseAdditive(): Node {
    let left = parseMultiplicative();
    while (peek()?.kind === "operator" && ["+", "-"].includes((peek() as { value: string }).value)) {
      const operator = (take() as { value: string }).value;
      left = { type: "binary", operator, left, right: parseMultiplicative() };
    }
    return left;
  }
  function parseMultiplicative(): Node {
    let left = parsePower();
    while (peek()?.kind === "operator" && ["*", "/"].includes((peek() as { value: string }).value)) {
      const operator = (take() as { value: string }).value;
      left = { type: "binary", operator, left, right: parsePower() };
    }
    return left;
  }
  function parsePower(): Node {
    const base = parseUnary();
    if (peek()?.kind === "operator" && (peek() as { value: string }).value === "^") {
      take();
      return { type: "binary", operator: "^", left: base, right: parsePower() };
    }
    return base;
  }
  function parseUnary(): Node {
    const token = peek();
    if (token?.kind === "operator" && ["+", "-"].includes(token.value)) {
      take();
      return { type: "unary", operator: token.value, operand: parseUnary() };
    }
    return parsePostfix();
  }
  function parsePostfix(): Node {
    const node = parsePrimary();
    if (peek()?.kind === "operator" && (peek() as { value: string }).value === "%") {
      take();
      return { type: "binary", operator: "/", left: node, right: { type: "number", value: 100 } };
    }
    return node;
  }
  function parsePrimary(): Node {
    const token = take();
    if (!token) throw new FormulaError("#FÓRMULA!");
    if (token.kind === "number") return { type: "number", value: token.value };
    if (token.kind === "text") return { type: "text", value: token.value };
    if (token.kind === "ref") return { type: "ref", key: token.value };
    if (token.kind === "range") return { type: "range", from: token.from, to: token.to };
    if (token.kind === "open") {
      const inner = parseExpression();
      if (take()?.kind !== "close") throw new FormulaError("#FÓRMULA!");
      return inner;
    }
    if (token.kind === "name") {
      if (["VERDADEIRO", "TRUE"].includes(token.value)) return { type: "number", value: 1 };
      if (["FALSO", "FALSE"].includes(token.value)) return { type: "number", value: 0 };
      if (peek()?.kind !== "open") throw new FormulaError("#NOME?");
      take();
      const args: Node[] = [];
      if (peek()?.kind === "close") { take(); return { type: "call", name: token.value, args }; }
      for (;;) {
        args.push(parseExpression());
        const next = take();
        if (next?.kind === "close") break;
        if (next?.kind !== "separator") throw new FormulaError("#FÓRMULA!");
      }
      return { type: "call", name: token.value, args };
    }
    throw new FormulaError("#FÓRMULA!");
  }

  const result = parseExpression();
  if (position !== tokens.length) throw new FormulaError("#FÓRMULA!");
  return result;
}

function expandRange(from: string, to: string) {
  const start = parseCellKey(from);
  const end = parseCellKey(to);
  if (!start || !end) throw new FormulaError("#REF!");
  const keys: string[] = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
    for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column += 1) {
      keys.push(cellKey({ column, row }));
    }
  }
  return keys;
}

const ALIASES: Record<string, string> = {
  SUM: "SOMA", AVERAGE: "MEDIA", "MÉDIA": "MEDIA", COUNT: "CONT.NUM", "CONT.NÚM": "CONT.NUM",
  COUNTA: "CONT.VALORES", IF: "SE", SUMIF: "SOMASE", COUNTIF: "CONT.SE", ROUND: "ARRED",
  CEILING: "TETO", FLOOR: "PISO", POWER: "POTENCIA", "POTÊNCIA": "POTENCIA", SQRT: "RAIZ",
  TODAY: "HOJE", NOW: "AGORA", CONCATENATE: "CONCAT", CONCATENAR: "CONCAT", LEFT: "ESQUERDA",
  RIGHT: "DIREITA", UPPER: "MAIUSCULA", "MAIÚSCULA": "MAIUSCULA", LOWER: "MINUSCULA",
  "MINÚSCULA": "MINUSCULA", AND: "E", OR: "OU", NOT: "NAO", "NÃO": "NAO", MEDIAN: "MEDIANA",
  MINIMO: "MIN", "MÍNIMO": "MIN", MAXIMO: "MAX", "MÁXIMO": "MAX", VLOOKUP: "PROCV",
  ABS: "ABS", INT: "INT", TRUNC: "TRUNCAR", LEN: "NUM.CARACT", "NÚM.CARACT": "NUM.CARACT",
  IFERROR: "SEERRO",
};

export const SHEET_FUNCTIONS = [
  "SOMA", "MEDIA", "MIN", "MAX", "CONT.NUM", "CONT.VALORES", "SE", "SOMASE", "CONT.SE",
  "ARRED", "ABS", "INT", "TRUNCAR", "TETO", "PISO", "POTENCIA", "RAIZ", "MEDIANA",
  "HOJE", "AGORA", "CONCAT", "ESQUERDA", "DIREITA", "MAIUSCULA", "MINUSCULA",
  "NUM.CARACT", "E", "OU", "NAO", "PROCV", "SEERRO",
] as const;

type Scalar = number | string | boolean | null;

function toNumber(value: Scalar): number {
  if (value === null || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = parseNumber(value);
  if (parsed === null) throw new FormulaError("#VALOR!");
  return parsed;
}
function toText(value: Scalar): string {
  if (value === null) return "";
  if (typeof value === "number") return displayValue(value);
  if (typeof value === "boolean") return value ? "VERDADEIRO" : "FALSO";
  return value;
}
function truthy(value: Scalar) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (value === null || value === "") return false;
  const upper = value.toUpperCase();
  if (["FALSO", "FALSE", "0"].includes(upper)) return false;
  return true;
}
function numbersOnly(values: Scalar[]) {
  const numbers: number[] = [];
  for (const value of values) {
    if (typeof value === "number") { numbers.push(value); continue; }
    if (typeof value === "boolean") { numbers.push(value ? 1 : 0); continue; }
    if (typeof value === "string" && value !== "") {
      const parsed = parseNumber(value);
      if (parsed !== null) numbers.push(parsed);
    }
  }
  return numbers;
}
function matches(value: Scalar, criteria: Scalar) {
  const text = toText(criteria).trim();
  const comparison = /^(<=|>=|<>|<|>|=)(.*)$/.exec(text);
  if (comparison) {
    const target = comparison[2].trim();
    const targetNumber = parseNumber(target);
    if (targetNumber !== null) {
      const current = typeof value === "number" ? value : parseNumber(toText(value));
      if (current === null) return false;
      switch (comparison[1]) {
        case "<": return current < targetNumber;
        case ">": return current > targetNumber;
        case "<=": return current <= targetNumber;
        case ">=": return current >= targetNumber;
        case "<>": return current !== targetNumber;
        default: return current === targetNumber;
      }
    }
    const current = toText(value).toLocaleUpperCase("pt-BR");
    const upper = target.toLocaleUpperCase("pt-BR");
    return comparison[1] === "<>" ? current !== upper : current === upper;
  }
  const criteriaNumber = parseNumber(text);
  if (criteriaNumber !== null) {
    const current = typeof value === "number" ? value : parseNumber(toText(value));
    return current !== null && current === criteriaNumber;
  }
  return toText(value).toLocaleUpperCase("pt-BR") === text.toLocaleUpperCase("pt-BR");
}

export function evaluateSheet(cells: SheetCells, now = Date.now()): SheetResult {
  const results: SheetResult = {};
  const visiting = new Set<string>();

  /**
   * Valor de uma célula para quem a referencia. Célula com erro NÃO vale zero: o erro
   * sobe.
   *
   * Antes, `A1` com `#DIV/0!` valia nulo, e nulo vale 0 numa conta. O efeito era o pior
   * possível num produto de orçamento: uma parcela quebrada não aparecia em lugar nenhum
   * e o total fechava como se estivesse certo. A leitura financeira lia o mesmo zero e
   * mostrava margem melhor do que a real.
   *
   * Agora a regra é a do Excel: erro contamina quem depende dele, e quem quiser seguir
   * mesmo assim diz isso explicitamente com `SEERRO`.
   */
  function cellValue(key: string): Scalar {
    const normalized = key.toUpperCase();
    if (results[normalized]) {
      const pronto = results[normalized];
      if (pronto.error) throw new FormulaError(pronto.error);
      return pronto.value;
    }
    if (visiting.has(normalized)) throw new FormulaError("#CIRCULAR!");
    const raw = cells[normalized];
    if (raw === undefined || raw === "") { results[normalized] = { value: null, error: null, display: "" }; return null; }
    visiting.add(normalized);
    try {
      const computed = computeRaw(raw);
      results[normalized] = computed;
      if (computed.error) throw new FormulaError(computed.error);
      return computed.value;
    } finally {
      visiting.delete(normalized);
    }
  }

  function values(node: Node): Scalar[] {
    if (node.type === "range") return expandRange(node.from, node.to).map((key) => cellValue(key));
    return [evaluate(node)];
  }

  function arredondarAoMultiplo(args: Node[], ajustar: (valor: number) => number): number {
    const valor = toNumber(evaluate(args[0]));
    const multiplo = args[1] === undefined ? 1 : toNumber(evaluate(args[1]));
    if (multiplo === 0) return 0;
    // Sinais opostos não têm resposta boa; o Excel recusa, e devolver um número
    // plausível aqui seria pior do que o erro.
    if (valor !== 0 && Math.sign(valor) !== Math.sign(multiplo)) throw new FormulaError("#NÚM!");
    return exact(ajustar(exact(valor / multiplo)) * multiplo);
  }

  function callFunction(rawName: string, args: Node[]): Scalar {
    const name = ALIASES[rawName] ?? rawName;
    const flat = () => args.flatMap(values);
    switch (name) {
      case "SOMA": return exact(numbersOnly(flat()).reduce((total, value) => total + value, 0));
      case "MEDIA": { const list = numbersOnly(flat()); if (!list.length) throw new FormulaError("#DIV/0!"); return exact(list.reduce((a, b) => a + b, 0) / list.length); }
      case "MEDIANA": { const list = numbersOnly(flat()).sort((a, b) => a - b); if (!list.length) throw new FormulaError("#NÚM!"); const middle = Math.floor(list.length / 2); return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2; }
      case "MIN": { const list = numbersOnly(flat()); return list.length ? Math.min(...list) : 0; }
      case "MAX": { const list = numbersOnly(flat()); return list.length ? Math.max(...list) : 0; }
      case "CONT.NUM": return numbersOnly(flat()).length;
      case "CONT.VALORES": return flat().filter((value) => value !== null && value !== "").length;
      case "SE": { if (args.length < 2) throw new FormulaError("#FÓRMULA!"); return truthy(evaluate(args[0])) ? evaluate(args[1]) : args[2] ? evaluate(args[2]) : false; }
      case "E": return flat().every(truthy);
      case "OU": return flat().some(truthy);
      case "NAO": return !truthy(evaluate(args[0]));
      case "SOMASE": {
        if (args.length < 2) throw new FormulaError("#FÓRMULA!");
        const tested = values(args[0]);
        const criteria = evaluate(args[1]);
        const summed = args[2] ? values(args[2]) : tested;
        let total = 0;
        tested.forEach((value, position) => { if (matches(value, criteria)) total += numbersOnly([summed[position] ?? null])[0] ?? 0; });
        return exact(total);
      }
      case "CONT.SE": {
        if (args.length < 2) throw new FormulaError("#FÓRMULA!");
        const criteria = evaluate(args[1]);
        return values(args[0]).filter((value) => matches(value, criteria)).length;
      }
      case "PROCV": {
        if (args.length < 3 || args[1].type !== "range") throw new FormulaError("#FÓRMULA!");
        const needle = evaluate(args[0]);
        const start = parseCellKey(args[1].from);
        const end = parseCellKey(args[1].to);
        if (!start || !end) throw new FormulaError("#REF!");
        const column = toNumber(evaluate(args[2]));
        const left = Math.min(start.column, end.column);
        const offset = left + Math.round(column) - 1;
        if (column < 1 || offset > Math.max(start.column, end.column)) throw new FormulaError("#REF!");
        for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
          if (matches(cellValue(cellKey({ column: left, row })), needle)) return cellValue(cellKey({ column: offset, row }));
        }
        throw new FormulaError("#N/D");
      }
      case "ARRED": return roundHalfAway(toNumber(evaluate(args[0])), args[1] ? Math.round(toNumber(evaluate(args[1]))) : 0);
      case "ABS": return Math.abs(toNumber(evaluate(args[0])));
      case "INT": return Math.floor(toNumber(evaluate(args[0])));
      case "TRUNCAR": return Math.trunc(toNumber(evaluate(args[0])));
      // O 2º argumento é o múltiplo, e era ignorado em silêncio: `=TETO(12,3;0,5)` dava
      // 13 em vez de 12,5. É a conta de comprar material em múltiplo de embalagem — barra
      // de 12 m, saco de cimento, caixa de piso — dando quantidade errada sem avisar.
      case "TETO": return arredondarAoMultiplo(args, Math.ceil);
      case "PISO": return arredondarAoMultiplo(args, Math.floor);
      case "POTENCIA": return toNumber(evaluate(args[0])) ** toNumber(evaluate(args[1]));
      case "RAIZ": { const value = toNumber(evaluate(args[0])); if (value < 0) throw new FormulaError("#NÚM!"); return Math.sqrt(value); }
      case "HOJE": return new Date(now).toLocaleDateString("pt-BR");
      case "AGORA": return new Date(now).toLocaleString("pt-BR");
      case "CONCAT": return flat().map(toText).join("");
      case "ESQUERDA": return toText(evaluate(args[0])).slice(0, args[1] ? Math.round(toNumber(evaluate(args[1]))) : 1);
      case "DIREITA": { const count = args[1] ? Math.round(toNumber(evaluate(args[1]))) : 1; const text = toText(evaluate(args[0])); return count >= text.length ? text : text.slice(text.length - count); }
      case "MAIUSCULA": return toText(evaluate(args[0])).toLocaleUpperCase("pt-BR");
      case "MINUSCULA": return toText(evaluate(args[0])).toLocaleLowerCase("pt-BR");
      case "NUM.CARACT": return toText(evaluate(args[0])).length;
      // A saída explícita da propagação acima. `PROCV` que não acha devolve `#N/D`, e
      // quem monta orçamento quer ver 0 ali — mas dizendo que quer, não por acidente.
      case "SEERRO": {
        if (args.length < 1) throw new FormulaError("#FÓRMULA!");
        try {
          return evaluate(args[0]);
        } catch (erro) {
          // Só erro de fórmula tem alternativa. Falha de programação continua subindo.
          if (!(erro instanceof FormulaError)) throw erro;
          // `#CIRCULAR!` não se engole: a alternativa não desfaz o ciclo, só o esconde.
          if (erro.code === "#CIRCULAR!") throw erro;
          return args.length > 1 ? evaluate(args[1]) : "";
        }
      }
      default: throw new FormulaError("#NOME?");
    }
  }

  function evaluate(node: Node): Scalar {
    switch (node.type) {
      case "number": return node.value;
      case "text": return node.value;
      case "ref": return cellValue(node.key);
      case "range": { const list = expandRange(node.from, node.to); return list.length ? cellValue(list[0]) : null; }
      case "call": return callFunction(node.name, node.args);
      case "unary": return exact(node.operator === "-" ? -toNumber(evaluate(node.operand)) : toNumber(evaluate(node.operand)));
      case "binary": {
        if (node.operator === "&") return toText(evaluate(node.left)) + toText(evaluate(node.right));
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        if (["=", "<>", "<", ">", "<=", ">="].includes(node.operator)) {
          const comparable = typeof left === "number" || typeof right === "number"
            ? [toNumber(left), toNumber(right)] as const
            : [toText(left), toText(right)] as const;
          switch (node.operator) {
            case "=": return comparable[0] === comparable[1];
            case "<>": return comparable[0] !== comparable[1];
            case "<": return comparable[0] < comparable[1];
            case ">": return comparable[0] > comparable[1];
            case "<=": return comparable[0] <= comparable[1];
            default: return comparable[0] >= comparable[1];
          }
        }
        const a = toNumber(left);
        const b = toNumber(right);
        switch (node.operator) {
          case "+": return exact(a + b);
          case "-": return exact(a - b);
          case "*": return exact(a * b);
          case "/": if (b === 0) throw new FormulaError("#DIV/0!"); return exact(a / b);
          default: return exact(a ** b);
        }
      }
    }
  }

  function computeRaw(raw: string): CellResult {
    if (!raw.startsWith("=")) {
      if (raw.startsWith("'")) return { value: raw.slice(1), error: null, display: raw.slice(1) };
      if (["VERDADEIRO", "FALSO", "TRUE", "FALSE"].includes(raw.trim().toUpperCase())) {
        const value = ["VERDADEIRO", "TRUE"].includes(raw.trim().toUpperCase());
        return { value, error: null, display: displayValue(value) };
      }
      const parsed = parseNumber(raw);
      const value = parsed === null ? raw : parsed;
      return { value, error: null, display: displayValue(value) };
    }
    try {
      const value = evaluate(parse(tokenize(raw.slice(1))));
      return { value, error: null, display: displayValue(value) };
    } catch (error) {
      const code = error instanceof FormulaError ? error.code : "#ERRO!";
      return { value: null, error: code, display: code };
    }
  }

  for (const key of Object.keys(cells)) {
    // `cellValue` agora lança quando a célula tem erro. O erro já foi gravado em
    // `results` antes de subir; aqui só se impede que ele derrube a planilha inteira.
    try { cellValue(key); } catch { /* o resultado da célula já está registrado */ }
  }
  return results;
}

export function sheetToCsv(cells: SheetCells, columns: number, rows: number) {
  const computed = evaluateSheet(cells);
  const lines: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const line: string[] = [];
    for (let column = 0; column < columns; column += 1) {
      const key = cellKey({ column, row });
      const text = computed[key]?.display ?? "";
      line.push(/[";\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
    }
    if (line.some((value) => value !== "")) lines.push(line.join(";"));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Edição estrutural. Inserir ou remover linha e coluna reescreve as referências
// das fórmulas: sem isso, a planilha continuaria somando a célula errada em
// silêncio, que é pior do que recusar a operação.
// ---------------------------------------------------------------------------

type Axis = "row" | "column";

// Reescreve os endereços de um texto de fórmula, sem tocar no que estiver entre aspas.
function rewriteReferences(formula: string, rewrite: (address: CellAddress, locked: { column: boolean; row: boolean }) => string | null) {
  let result = "";
  let index = 0;
  while (index < formula.length) {
    const character = formula[index];
    if (character === '"' || character === "'") {
      const end = formula.indexOf(character, index + 1);
      const stop = end < 0 ? formula.length : end + 1;
      result += formula.slice(index, stop);
      index = stop;
      continue;
    }
    const match = /^(\$?)([A-Za-z]{1,2})(\$?)(\d{1,4})(?![A-Za-z0-9_.])/.exec(formula.slice(index));
    if (match) {
      const address = parseCellKey(`${match[2]}${match[4]}`);
      const replaced = address ? rewrite(address, { column: !!match[1], row: !!match[3] }) : null;
      const target = replaced ? parseCellKey(replaced) : null;
      result += target ? `${match[1]}${columnName(target.column)}${match[3]}${target.row + 1}` : "#REF!";
      index += match[0].length;
      continue;
    }
    result += character;
    index += 1;
  }
  return result;
}

function shiftFormula(raw: string, axis: Axis, at: number, delta: number) {
  if (!raw.startsWith("=")) return raw;
  return `=${rewriteReferences(raw.slice(1), (address) => {
    const position = axis === "row" ? address.row : address.column;
    if (delta < 0 && position === at) return null;
    if (position < at) return cellKey(address);
    const moved = { ...address, [axis]: position + delta } as CellAddress;
    return moved.row < 0 || moved.column < 0 ? null : cellKey(moved);
  })}`;
}

function moveCells(cells: SheetCells, axis: Axis, at: number, delta: number): SheetCells {
  const next: SheetCells = {};
  for (const [key, raw] of Object.entries(cells)) {
    const address = parseCellKey(key);
    if (!address) continue;
    const position = axis === "row" ? address.row : address.column;
    if (delta < 0 && position === at) continue;
    const target = position < at ? address : { ...address, [axis]: position + delta } as CellAddress;
    if (target.row < 0 || target.column < 0) continue;
    next[cellKey(target)] = shiftFormula(raw, axis, at, delta);
  }
  return next;
}

export function insertRow(cells: SheetCells, at: number) { return moveCells(cells, "row", at, 1); }
export function deleteRow(cells: SheetCells, at: number) { return moveCells(cells, "row", at, -1); }
export function insertColumn(cells: SheetCells, at: number) { return moveCells(cells, "column", at, 1); }
export function deleteColumn(cells: SheetCells, at: number) { return moveCells(cells, "column", at, -1); }

/**
 * A fórmula como ficaria copiada para `linhas` abaixo e `colunas` à direita: referência
 * relativa anda, a travada com $ fica. Referência que sairia da grade vira #REF!, como no
 * Excel — somar a célula errada em silêncio seria pior.
 */
export function offsetFormula(raw: string, linhas: number, colunas: number): string {
  if (!raw.startsWith("=") || (linhas === 0 && colunas === 0)) return raw;
  return `=${rewriteReferences(raw.slice(1), (address, locked) => {
    const moved = { column: address.column + (locked.column ? 0 : colunas), row: address.row + (locked.row ? 0 : linhas) };
    return moved.row < 0 || moved.column < 0 || moved.row >= SHEET_MAX_ROWS || moved.column >= SHEET_MAX_COLUMNS ? null : cellKey(moved);
  })}`;
}

// Copia a célula para baixo deslocando as referências relativas, como ao arrastar a alça.
export function fillDown(cells: SheetCells, fromKey: string, untilRow: number): SheetCells {
  const origin = parseCellKey(fromKey);
  const raw = cells[fromKey.toUpperCase()];
  if (!origin || raw === undefined || untilRow <= origin.row) return cells;
  const next = { ...cells };
  for (let row = origin.row + 1; row <= untilRow; row += 1) {
    next[cellKey({ column: origin.column, row })] = offsetFormula(raw, row - origin.row, 0);
  }
  return next;
}

/** O mesmo, para a direita: a fórmula da primeira coluna segue linha afora. */
export function fillRight(cells: SheetCells, fromKey: string, untilColumn: number): SheetCells {
  const origin = parseCellKey(fromKey);
  const raw = cells[fromKey.toUpperCase()];
  if (!origin || raw === undefined || untilColumn <= origin.column) return cells;
  const next = { ...cells };
  for (let column = origin.column + 1; column <= untilColumn; column += 1) {
    next[cellKey({ column, row: origin.row })] = offsetFormula(raw, 0, column - origin.column);
  }
  return next;
}

const REFERENCIA = /(\$?)([A-Za-z]{1,2})(\$?)(\d{1,4})(?![A-Za-z0-9_.(])/g;
const INTERVALO = /\$?([A-Za-z]{1,2})\$?(\d{1,4})\s*:\s*\$?([A-Za-z]{1,2})\$?(\d{1,4})(?![A-Za-z0-9_.(])/g;

/** Linhas referenciadas por uma fórmula, com os intervalos à parte. Texto entre aspas não conta. */
function linhasReferenciadas(formula: string) {
  const semTexto = formula.replace(/"[^"]*"|'[^']*'/g, "");
  const intervalos: Array<{ de: number; ate: number }> = [];
  const resto = semTexto.replace(INTERVALO, (_m, _c1, r1: string, _c2, r2: string) => {
    const a = Number(r1) - 1, b = Number(r2) - 1;
    intervalos.push({ de: Math.min(a, b), ate: Math.max(a, b) });
    return " ";
  });
  const avulsas = [...resto.matchAll(REFERENCIA)].map((match) => Number(match[4]) - 1);
  return { intervalos, avulsas };
}

function chaveDeOrdem(value: CellResult["value"] | undefined): number | string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "VERDADEIRO" : "FALSO";
  return value;
}

/**
 * Ordena o bloco de dados abaixo do cabeçalho pela coluna escolhida.
 *
 * O bloco termina na primeira linha fixa (a linha de total do modelo), que fica onde está.
 * Fórmula que só usa a própria linha — `=D5*E5`, o caso de todo modelo — anda junto com a
 * linha e é reescrita para o novo número. Recusa quando uma fórmula liga uma linha do bloco
 * a outra (saldo acumulado, `=F4+F5`) ou quando alguém fora do bloco aponta para uma linha
 * específica dele: nesses casos ordenar mudaria o cálculo sem aviso. Intervalo que cobre o
 * bloco inteiro, como o total `=SOMA(F2:F61)`, continua certo depois de ordenar.
 *
 * Linhas sem nenhum valor digitado (só com as fórmulas do modelo) e valores vazios vão
 * para o fim nas duas direções; números vêm antes de texto.
 */
export function sortRows(
  cells: SheetCells,
  options: { columns: number; rows: number; headerRow: number; column: number; direction: "asc" | "desc"; fixedRows?: number[] },
): { cells: SheetCells; blocked: boolean; destination: Record<number, number>; range: [number, number] } {
  const { columns, rows, headerRow, column, direction } = options;
  const inicio = headerRow + 1;
  const fim = Math.min(rows, ...(options.fixedRows ?? []).filter((row) => row > headerRow));
  const dentro = (row: number) => row >= inicio && row < fim;
  const computed = evaluateSheet(cells);
  const recusa = { cells, blocked: true, destination: {}, range: [inicio, fim] as [number, number] };

  for (const [key, raw] of Object.entries(cells)) {
    if (!raw.startsWith("=")) continue;
    const address = parseCellKey(key);
    if (!address) continue;
    const { intervalos, avulsas } = linhasReferenciadas(raw.slice(1));
    if (dentro(address.row)) {
      if (avulsas.some((row) => row !== address.row && dentro(row))) return recusa;
      if (intervalos.some(({ de, ate }) => (de !== address.row || ate !== address.row) && ate >= inicio && de < fim)) return recusa;
    } else {
      if (avulsas.some(dentro)) return recusa;
      if (intervalos.some(({ de, ate }) => ate >= inicio && de < fim && (de > inicio || ate < fim - 1))) return recusa;
    }
  }

  const linhas: Array<{ row: number; values: Array<string | undefined>; chave: number | string | null; semDado: boolean }> = [];
  const vazias: number[] = [];
  for (let row = inicio; row < fim; row += 1) {
    const values: Array<string | undefined> = [];
    let vazia = true, semDado = true;
    for (let index = 0; index < columns; index += 1) {
      const raw = cells[cellKey({ column: index, row })];
      if (raw !== undefined && raw !== "") {
        vazia = false;
        if (!raw.startsWith("=")) semDado = false;
      }
      values.push(raw);
    }
    if (vazia) { vazias.push(row); continue; }
    linhas.push({ row, values, chave: semDado ? null : chaveDeOrdem(computed[cellKey({ column, row })]?.value), semDado });
  }

  const sinal = direction === "desc" ? -1 : 1;
  linhas.sort((left, right) => {
    if (left.semDado !== right.semDado) return left.semDado ? 1 : -1;
    if (left.chave === null || right.chave === null) return left.chave === right.chave ? 0 : left.chave === null ? 1 : -1;
    if (typeof left.chave === "number" && typeof right.chave === "number") return sinal * (left.chave - right.chave);
    if (typeof left.chave === "number") return -1;
    if (typeof right.chave === "number") return 1;
    return sinal * left.chave.localeCompare(right.chave, "pt-BR", { numeric: true, sensitivity: "base" });
  });

  const next: SheetCells = {};
  for (const [key, raw] of Object.entries(cells)) {
    const address = parseCellKey(key);
    if (address && dentro(address.row)) continue;
    next[key] = raw;
  }
  // Para onde foi cada linha do bloco. As vazias vão depois das preenchidas, na ordem em
  // que estavam, para a formatação delas (negrito, cor) não cair em cima de um dado.
  const destination: Record<number, number> = {};
  [...linhas.map((entry) => entry.row), ...vazias].forEach((row, index) => { destination[row] = inicio + index; });
  linhas.forEach((entry, index) => {
    const destino = inicio + index;
    entry.values.forEach((raw, columnIndex) => {
      if (raw === undefined || raw === "") return;
      next[cellKey({ column: columnIndex, row: destino })] = raw.startsWith("=")
        ? `=${rewriteReferences(raw.slice(1), (address) => cellKey(address.row === entry.row ? { ...address, row: destino } : address))}`
        : raw;
    });
  });
  return { cells: next, blocked: false, destination, range: [inicio, fim] };
}

// Reposiciona os parâmetros da análise financeira quando a grade muda de forma.
//
// Inserir ou remover linha/coluna move as células, mas `roles`, `headerRow` e `ignoreRows`
// guardam POSIÇÕES — letra de coluna e índice de linha. Sem deslocá-los junto, a coluna
// marcada como "Custo" passa a apontar para a vizinha depois de uma remoção, e a leitura
// financeira lê a coluna errada sem nenhum erro na tela. É a falha silenciosa que o
// titular relatou como "parâmetros falhando antes de usar".
//
// Uma coluna removida perde o papel em vez de herdá-lo da seguinte: herdar seria inventar
// uma marcação que ninguém fez. Uma linha de cabeçalho removida cede o lugar para a linha
// que ocupou seu índice, que é o que a tela passa a mostrar ali.
export function moveAnalysis<T extends { headerRow: number; roles: Record<string, string>; ignoreRows: number[] }>(
  analysis: T,
  axis: "row" | "column",
  at: number,
  delta: 1 | -1,
): T {
  if (axis === "column") {
    const roles: Record<string, string> = {};
    for (const [letra, papel] of Object.entries(analysis.roles)) {
      const indice = columnIndex(letra);
      if (indice < at) { roles[letra] = papel; continue; }
      // A coluna excluída leva o papel embora.
      if (delta === -1 && indice === at) continue;
      roles[columnName(indice + delta)] = papel;
    }
    return { ...analysis, roles };
  }

  const deslocar = (linha: number) => (linha < at ? linha : linha + delta);
  const ignoreRows = [...new Set(
    analysis.ignoreRows
      .filter((linha) => !(delta === -1 && linha === at))
      .map(deslocar)
      .filter((linha) => linha >= 0),
  )].sort((a, b) => a - b);
  // Remover a própria linha de cabeçalho mantém o índice: quem ocupou o lugar vira o
  // cabeçalho, que é o que aparece na tela depois da remoção.
  const headerRow = delta === -1 && analysis.headerRow === at ? at : Math.max(0, deslocar(analysis.headerRow));
  return { ...analysis, headerRow, ignoreRows };
}

// Seleção por eixo. A planilha só sabia somar coluna: o rodapé filtrava pela
// coluna do cursor e não havia caminho nenhum para o total de uma linha, que é
// como se lê um mês fechado da esquerda para a direita.
export type SheetAxis = "row" | "column";

function axisPosition(address: CellAddress, axis: SheetAxis) {
  return axis === "row" ? address.row : address.column;
}

/**
 * Total do eixo, pulando as linhas marcadas para ignorar.
 *
 * Sem esse filtro o total somava a PRÓPRIA linha de total: itens de 30 mil com
 * `=SOMA(...)` no rodapé mostravam 60 mil. Como os dez modelos gravam a linha de total em
 * `analysis.ignoreRows`, o número aparecia dobrado em qualquer planilha criada por modelo
 * — e dobrado é um número plausível, que ninguém confere.
 */
export function axisTotal(
  computed: SheetResult,
  axis: SheetAxis,
  index: number,
  ignorarLinhas: readonly number[] = [],
) {
  const ignoradas = new Set(ignorarLinhas);
  let total = 0;
  for (const [key, result] of Object.entries(computed)) {
    const address = parseCellKey(key);
    if (!address || axisPosition(address, axis) !== index) continue;
    // Numa linha selecionada, ignorar a própria linha apagaria o total inteiro; o que se
    // pula ali é só a coluna de total, que não é marcada. Por isso o filtro vale para a
    // linha da célula, e só quando o eixo é uma coluna.
    if (axis === "column" && ignoradas.has(address.row)) continue;
    if (typeof result.value === "number") total += result.value;
  }
  return exact(total);
}

// Última célula preenchida do eixo, para o cursor parar logo depois dela.
export function axisLastFilled(cells: SheetCells, axis: SheetAxis, index: number) {
  let last = -1;
  for (const [key, raw] of Object.entries(cells)) {
    const address = parseCellKey(key);
    if (!address || axisPosition(address, axis) !== index) continue;
    if (!raw.trim()) continue;
    const position = axis === "row" ? address.column : address.row;
    if (position > last) last = position;
  }
  return last;
}

// Intervalo do eixo que termina antes do cursor: A5:D5 na linha, A1:A4 na
// coluna. Parar antes do cursor evita a fórmula se incluir e dar #CIRCULAR!.
export function axisRange(axis: SheetAxis, index: number, until: number) {
  if (until < 1) return null;
  return axis === "row"
    ? `${columnName(0)}${index + 1}:${columnName(until - 1)}${index + 1}`
    : `${columnName(index)}1:${columnName(index)}${until}`;
}

export type ResumoSelecao = {
  /** Quantas células a seleção cobre, cheias ou vazias. */
  celulas: number;
  preenchidas: number;
  /** Quantas viraram número — é sobre estas que soma, média, mínimo e máximo falam. */
  numericas: number;
  comErro: number;
  soma: number | null;
  media: number | null;
  minimo: number | null;
  maximo: number | null;
};

/**
 * As contas da seleção, para a barra de resumo.
 *
 * Responde perguntas que a soma sozinha não responde num orçamento: "quantos itens de
 * fato têm preço" (a linha esquecida), "qual o preço médio", "qual o maior e o menor
 * unitário" (o item fora da curva).
 *
 * Célula com erro é CONTADA à parte e fica fora das contas. Somar tratando erro como zero
 * é o defeito que este mesmo arquivo acabou de corrigir em `cellValue`; repeti-lo aqui
 * devolveria o zero silencioso pela porta da frente.
 *
 * `soma`, `media`, `minimo` e `maximo` vêm `null` quando não há número nenhum. Devolver 0
 * seria pior: zero é um número que a tela exibe sem ninguém desconfiar.
 */
export function resumoDaSelecao(computed: SheetResult, chaves: Iterable<string>): ResumoSelecao {
  let celulas = 0;
  let preenchidas = 0;
  let comErro = 0;
  const numeros: number[] = [];

  for (const chave of chaves) {
    celulas += 1;
    const resultado = computed[chave.toUpperCase()];
    if (!resultado) continue;
    if (resultado.error) { comErro += 1; preenchidas += 1; continue; }
    if (resultado.value === null || resultado.value === "") continue;
    preenchidas += 1;
    if (typeof resultado.value === "number") numeros.push(resultado.value);
  }

  if (numeros.length === 0) {
    return { celulas, preenchidas, numericas: 0, comErro, soma: null, media: null, minimo: null, maximo: null };
  }

  const soma = exact(numeros.reduce((total, valor) => total + valor, 0));
  return {
    celulas,
    preenchidas,
    numericas: numeros.length,
    comErro,
    soma,
    media: exact(soma / numeros.length),
    minimo: Math.min(...numeros),
    maximo: Math.max(...numeros),
  };
}

/** As chaves de um retângulo, da âncora ao foco, em qualquer ordem de arrasto. */
export function chavesDoRetangulo(ancora: string, foco: string): string[] {
  const a = parseCellKey(ancora);
  const b = parseCellKey(foco);
  if (!a || !b) return [];
  const chaves: string[] = [];
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row += 1) {
    for (let column = Math.min(a.column, b.column); column <= Math.max(a.column, b.column); column += 1) {
      chaves.push(cellKey({ column, row }));
    }
  }
  return chaves;
}

/** `A2:C31 · 30L × 3C` — o rótulo que confirma o que foi marcado antes de somar. */
export function rotuloDoRetangulo(ancora: string, foco: string): string {
  const a = parseCellKey(ancora);
  const b = parseCellKey(foco);
  if (!a || !b) return "";
  const inicio = cellKey({ column: Math.min(a.column, b.column), row: Math.min(a.row, b.row) });
  const fim = cellKey({ column: Math.max(a.column, b.column), row: Math.max(a.row, b.row) });
  if (inicio === fim) return inicio;
  const linhas = Math.abs(a.row - b.row) + 1;
  const colunas = Math.abs(a.column - b.column) + 1;
  return `${inicio}:${fim} · ${linhas}L × ${colunas}C`;
}
