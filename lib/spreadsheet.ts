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

// Um texto digitado vira número quando é inequivocamente numérico, aceitando os dois
// separadores usados no Brasil: "1.234,56" e "1234.56".
export function parseNumber(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const cleaned = text.replace(/\s|R\$|%/g, "");
  const candidate = /,\d{1,10}$/.test(cleaned)
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/,/g, "");
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(candidate)) return null;
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
    const range = /^([A-Za-z]{1,2}\d{1,4}):([A-Za-z]{1,2}\d{1,4})/.exec(rest);
    if (range) { tokens.push({ kind: "range", from: range[1].toUpperCase(), to: range[2].toUpperCase() }); index += range[0].length; continue; }
    const reference = /^[A-Za-z]{1,2}\d{1,4}(?![A-Za-z0-9_.])/.exec(rest);
    if (reference) { tokens.push({ kind: "ref", value: reference[0].toUpperCase() }); index += reference[0].length; continue; }
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
};

export const SHEET_FUNCTIONS = [
  "SOMA", "MEDIA", "MIN", "MAX", "CONT.NUM", "CONT.VALORES", "SE", "SOMASE", "CONT.SE",
  "ARRED", "ABS", "INT", "TRUNCAR", "TETO", "PISO", "POTENCIA", "RAIZ", "MEDIANA",
  "HOJE", "AGORA", "CONCAT", "ESQUERDA", "DIREITA", "MAIUSCULA", "MINUSCULA",
  "NUM.CARACT", "E", "OU", "NAO", "PROCV",
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

  function cellValue(key: string): Scalar {
    const normalized = key.toUpperCase();
    if (results[normalized]) return results[normalized].error ? null : results[normalized].value;
    if (visiting.has(normalized)) throw new FormulaError("#CIRCULAR!");
    const raw = cells[normalized];
    if (raw === undefined || raw === "") { results[normalized] = { value: null, error: null, display: "" }; return null; }
    visiting.add(normalized);
    try {
      const computed = computeRaw(raw);
      results[normalized] = computed;
      return computed.error ? null : computed.value;
    } finally {
      visiting.delete(normalized);
    }
  }

  function values(node: Node): Scalar[] {
    if (node.type === "range") return expandRange(node.from, node.to).map((key) => cellValue(key));
    return [evaluate(node)];
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
      case "TETO": return Math.ceil(toNumber(evaluate(args[0])));
      case "PISO": return Math.floor(toNumber(evaluate(args[0])));
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

  for (const key of Object.keys(cells)) cellValue(key);
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
function rewriteReferences(formula: string, rewrite: (address: CellAddress) => string | null) {
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
    const match = /^([A-Za-z]{1,2})(\d{1,4})(?![A-Za-z0-9_.])/.exec(formula.slice(index));
    if (match) {
      const address = parseCellKey(match[0]);
      const replaced = address ? rewrite(address) : null;
      result += replaced ?? "#REF!";
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

// Copia a célula para baixo deslocando as referências relativas, como ao arrastar a alça.
export function fillDown(cells: SheetCells, fromKey: string, untilRow: number): SheetCells {
  const origin = parseCellKey(fromKey);
  const raw = cells[fromKey.toUpperCase()];
  if (!origin || raw === undefined || untilRow <= origin.row) return cells;
  const next = { ...cells };
  for (let row = origin.row + 1; row <= untilRow; row += 1) {
    const offset = row - origin.row;
    next[cellKey({ column: origin.column, row })] = raw.startsWith("=")
      ? `=${rewriteReferences(raw.slice(1), (address) => {
        const moved = { column: address.column, row: address.row + offset };
        return moved.row < 0 ? null : cellKey(moved);
      })}`
      : raw;
  }
  return next;
}

// Ordenar move linhas inteiras. Uma fórmula que aponta para outra linha passaria a
// apontar para o lugar errado, então a ordenação é recusada quando existe fórmula na
// faixa — recusar é melhor do que embaralhar o cálculo sem avisar.
export function sortRows(
  cells: SheetCells,
  options: { columns: number; rows: number; headerRow: number; column: number; direction: "asc" | "desc" },
): { cells: SheetCells; blocked: boolean } {
  const { columns, rows, headerRow, column, direction } = options;
  const body: Array<{ values: Array<string | undefined>; sortKey: string | number }> = [];
  const computed = evaluateSheet(cells);

  for (let row = headerRow + 1; row < rows; row += 1) {
    const values: Array<string | undefined> = [];
    let empty = true;
    for (let index = 0; index < columns; index += 1) {
      const raw = cells[cellKey({ column: index, row })];
      if (raw !== undefined && raw !== "") empty = false;
      if (raw?.startsWith("=")) return { cells, blocked: true };
      values.push(raw);
    }
    if (empty) continue;
    const value = computed[cellKey({ column, row })]?.value;
    body.push({ values, sortKey: typeof value === "number" ? value : String(value ?? "") });
  }

  body.sort((left, right) => {
    if (typeof left.sortKey === "number" && typeof right.sortKey === "number") return left.sortKey - right.sortKey;
    return String(left.sortKey).localeCompare(String(right.sortKey), "pt-BR");
  });
  if (direction === "desc") body.reverse();

  const next: SheetCells = {};
  for (const [key, raw] of Object.entries(cells)) {
    const address = parseCellKey(key);
    if (address && address.row > headerRow) continue;
    next[key] = raw;
  }
  body.forEach((entry, index) => {
    entry.values.forEach((raw, columnIndex) => {
      if (raw !== undefined && raw !== "") next[cellKey({ column: columnIndex, row: headerRow + 1 + index })] = raw;
    });
  });
  return { cells: next, blocked: false };
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
