// Interpretação da planilha da SINAPI.
//
// O defeito que importa aqui não é o que estoura: é o que passa. Ler preço da coluna
// errada, ou ler "1.234,56" como 1,23, produz orçamento errado sem nenhum erro na tela.
// Por isso os testes atacam ambiguidade de formato e mudança de layout.
import assert from "node:assert/strict";
import { deflateRawSync, crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { interpretar, paraCentavos } = await vite.ssrLoadModule("/lib/integrations/sinapi-planilha.ts");
after(() => vite.close());

function montarZip(arquivos) {
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

function xlsx(abas) {
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

test("dinheiro: vírgula decimal, ponto de milhar e as duas juntas", () => {
  assert.equal(paraCentavos("27,61"), 2761);
  assert.equal(paraCentavos("1.234,56"), 123456, "ponto é milhar quando a vírgula é decimal");
  assert.equal(paraCentavos("1234.56"), 123456, "ponto é decimal quando não há vírgula");
  assert.equal(paraCentavos("1,234.56"), 123456, "formato inglês: vírgula é milhar");
  assert.equal(paraCentavos("R$ 89,90"), 8990);
  assert.equal(paraCentavos("0,01"), 1);
});

test("dinheiro: o que não é número devolve nulo em vez de zero", () => {
  // Zero silencioso viraria item de graça no orçamento.
  for (const lixo of ["", "  ", "-", "N/A", "TOTAL", "R$"]) assert.equal(paraCentavos(lixo), null, `"${lixo}"`);
});

test("acha as colunas pelo nome, não pela posição", () => {
  const r = interpretar(xlsx({
    "Analítico": [
      ["SINAPI - Sistema Nacional de Pesquisa de Custos", "", "", ""],
      ["Competência: 09/2026", "", "", ""],
      ["DESCRICAO", "UNIDADE", "CODIGO", "CUSTO TOTAL"],
      ["PEDREIRO COM ENCARGOS", "H", "88309", "27,61"],
    ],
  }), "composicao");
  assert.equal(r.linhaDoCabecalho, 2, "pula as linhas de título");
  assert.deepEqual(r.itens[0], { codigo: "88309", descricao: "PEDREIRO COM ENCARGOS", unidade: "H", custoUnitarioCentavos: 2761, tipo: "composicao" });
});

test("colunas trocadas de lugar continuam lidas certo", () => {
  // É exatamente o caso que um parser por índice fixo erraria em silêncio.
  const r = interpretar(xlsx({
    "P": [["CUSTO", "CODIGO", "UNID", "DESCRICAO"], ["27,61", "88309", "H", "PEDREIRO"]],
  }), "composicao");
  assert.equal(r.itens[0].custoUnitarioCentavos, 2761);
  assert.equal(r.itens[0].codigo, "88309");
  assert.equal(r.itens[0].unidade, "H");
});

test("cabeçalho com acento e caixa diferente é reconhecido", () => {
  const r = interpretar(xlsx({
    "P": [["Código", "Descrição", "Unidade", "Preço Unitário"], ["1", "AREIA", "M3", "120,00"]],
  }), "insumo");
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].custoUnitarioCentavos, 12000);
});

test("rodapé, subtotal e código repetido não viram item", () => {
  const r = interpretar(xlsx({
    "P": [
      ["CODIGO", "DESCRICAO", "UNIDADE", "CUSTO"],
      ["88309", "PEDREIRO", "H", "27,61"],
      ["", "TOTAL GERAL", "", "999,00"],
      ["88310", "SERVENTE", "H", ""],
      ["88309", "PEDREIRO (DUPLICADO)", "H", "30,00"],
    ],
  }), "composicao");
  assert.equal(r.itens.length, 1, "só a linha completa e única vira item");
  assert.equal(r.ignoradas, 3);
  assert.equal(r.itens[0].custoUnitarioCentavos, 2761, "o duplicado não sobrescreve o primeiro");
});

test("planilha sem cabeçalho reconhecível falha alto e diz por quê", () => {
  assert.throws(
    () => interpretar(xlsx({ "Capa": [["Documento institucional"], ["sem tabela aqui"]] }), "composicao"),
    /nenhuma aba tem cabeçalho reconhecível.*"Capa"/s,
  );
});

test("procura o cabeçalho na aba certa quando há várias", () => {
  const r = interpretar(xlsx({
    "Capa": [["SINAPI"], ["referência"]],
    "Dados": [["CODIGO", "DESCRICAO", "UNIDADE", "CUSTO"], ["1", "X", "UN", "1,00"]],
  }), "insumo");
  assert.equal(r.aba, "Dados");
  assert.equal(r.itens.length, 1);
});
