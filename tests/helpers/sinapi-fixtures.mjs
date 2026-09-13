import { deflateRawSync, crc32 } from "node:zlib";
export function montarZip(arquivos) {
  const locais = []; const centrais = []; let deslocamento = 0;
  for (const [nome, texto] of Object.entries(arquivos)) {
    const conteudo = Buffer.from(texto, "utf8"); const dados = deflateRawSync(conteudo);
    const nomeBytes = Buffer.from(nome, "utf8"); const soma = crc32(conteudo);
    const local = Buffer.alloc(30 + nomeBytes.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(soma, 14); local.writeUInt32LE(dados.length, 18); local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nomeBytes.length, 26); nomeBytes.copy(local, 30);
    locais.push(local, dados);
    const central = Buffer.alloc(46 + nomeBytes.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(soma, 16); central.writeUInt32LE(dados.length, 20); central.writeUInt32LE(conteudo.length, 24);
    central.writeUInt16LE(nomeBytes.length, 28); central.writeUInt32LE(deslocamento, 42); nomeBytes.copy(central, 46);
    centrais.push(central); deslocamento += local.length + dados.length;
  }
  const corpo = Buffer.concat(centrais); const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(centrais.length, 8); fim.writeUInt16LE(centrais.length, 10);
  fim.writeUInt32LE(corpo.length, 12); fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, corpo, fim]);
}

export function xlsx(abas) {
  const textos = []; const idx = (t) => { const a = textos.indexOf(t); if (a >= 0) return a; textos.push(t); return textos.length - 1; };
  const letra = (n) => { let s = ""; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const folhas = Object.entries(abas).map(([nome, linhas], p) => ({
    nome, arquivo: `worksheets/sheet${p + 1}.xml`, id: `rId${p + 1}`,
    xml: `<?xml version="1.0"?><worksheet><sheetData>${linhas.map((cs, l) => `<row r="${l + 1}">${cs.map((v, c) => v === "" || v == null ? "" : `<c r="${letra(c)}${l + 1}" t="s"><v>${idx(String(v))}</v></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`,
  }));
  const arquivos = {
    "xl/workbook.xml": `<?xml version="1.0"?><workbook><sheets>${folhas.map((f) => `<sheet name="${f.nome}" r:id="${f.id}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships>${folhas.map((f) => `<Relationship Id="${f.id}" Target="${f.arquivo}"/>`).join("")}</Relationships>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${textos.map((t) => `<si><t>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></si>`).join("")}</sst>`,
  };
  for (const f of folhas) arquivos[`xl/${f.arquivo}`] = f.xml;
  return montarZip(arquivos);
}
