import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { monthSchema, normalizeSinapiUf, regimeSchema, type SinapiRegime } from "./sinapi-contract";
import { paraCentavos, type ItemSinapi } from "./sinapi-planilha";
import type { NationalPackage } from "./sinapi-mapped";

export function officialSinapiUrl(value: string, month: string) {
  const url = new URL(value);
  if (url.origin !== "https://www.caixa.gov.br" || url.username || url.password || url.search || url.hash ||
    !/^\/Downloads\/sinapi-relatorios-mensais\/SINAPI-\d{4}-\d{2}-formato-xlsx\.zip$/.test(url.pathname) || !url.pathname.includes(`SINAPI-${month}-`)) {
    throw new Error("Use a URL HTTPS do pacote XLSX mensal em www.caixa.gov.br, com a mesma competência selecionada.");
  }
  return url.href;
}

// CSV delimitado por ponto e vírgula, vírgula ou TAB, incluindo campos entre aspas.
export function csvRows(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = first.includes(";") ? ";" : first.includes("\t") ? "\t" : ",";
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (ch === delimiter || ch === "\n")) {
      row.push(cell.replace(/\r$/, "").trim()); cell = "";
      if (ch === "\n") { if (row.some(Boolean)) rows.push(row); row = []; }
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV com aspas não fechadas.");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length > 2000000) throw new Error("CSV excede o limite de linhas.");
  return rows;
}
export function parseSinapiCsv(files: { name: string; bytes: Buffer }[], month: string, uf: string, regime: SinapiRegime): NationalPackage {
  const itens: ItemSinapi[] = [], signatures: string[] = []; const seen = new Set<string>(); let semPreco = 0;
  for (const file of files) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    const [header, ...rows] = csvRows(text);
    const names = header?.map((s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
    const columns = ["competencia", "uf", "regime", "tipo", "codigo", "descricao", "unidade", "preco"];
    if (!names || columns.some((c) => !names.includes(c)) || new Set(names).size !== names.length) throw new Error(`${file.name}: use as colunas ${columns.join("; ")}.`);
    const at = Object.fromEntries(columns.map((c) => [c, names.indexOf(c)]));
    signatures.push(createHash("sha256").update(JSON.stringify(names)).digest("hex"));
    for (const [index, row] of rows.entries()) {
      const location = `${file.name}, linha ${index + 2}`;
      if (row.length !== header.length) throw new Error(`${location}: quantidade de colunas incorreta.`);
      if (!monthSchema.safeParse(row[at.competencia]).success || row[at.competencia] !== month) throw new Error(`${location}: competência diferente de ${month}.`);
      const state = normalizeSinapiUf(row[at.uf]);
      const tax = regimeSchema.parse(row[at.regime]);
      const tipo = row[at.tipo];
      if (tipo !== "insumo" && tipo !== "composicao") throw new Error(`${location}: tipo deve ser insumo ou composicao.`);
      const codigo = row[at.codigo], descricao = row[at.descricao], unidade = row[at.unidade];
      if (!/^[1-9]\d*$/.test(codigo) || !descricao || descricao.length > 3000 || !unidade || unidade.length > 30) throw new Error(`${location}: código, descrição ou unidade inválidos.`);
      const raw = row[at.preco]; const price = paraCentavos(raw);
      const missing = !raw || /^(?:-|–|—|N\/A)$/i.test(raw);
      if (!missing && (price === null || !Number.isSafeInteger(price))) throw new Error(`${location}: preço inválido.`);
      if (state !== uf || tax !== regime) continue;
      const key = `${tipo}:${codigo}`; if (seen.has(key)) throw new Error(`${location}: código duplicado ${key}.`); seen.add(key);
      if (missing || (tipo === "composicao" && price === 0)) { semPreco++; continue; }
      itens.push({ codigo, descricao, unidade, tipo, custoUnitarioCentavos: price! });
    }
  }
  if (itens.length < 100 || itens.length > 150000) throw new Error(`${uf}/${regime}: esperados entre 100 e 150.000 preços; encontrados ${itens.length}.`);
  return { itens, signatures: signatures.sort(), semPreco, arquivos: files.map((f) => f.name) };
}

// Empacota uma pasta selecionada pelo usuário sem escrever caminhos no disco.
export function packSinapiFiles(files: { name: string; bytes: Buffer }[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), data = deflateRawSync(file.bytes), checksum = crc32(file.bytes);
    const local = Buffer.alloc(30 + name.length); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(file.bytes.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(file.bytes.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); name.copy(central, 46);
    locals.push(local, data); centrals.push(central); offset += local.length + data.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
