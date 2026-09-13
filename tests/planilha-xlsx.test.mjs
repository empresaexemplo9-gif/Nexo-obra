// Leitor de ZIP/XLSX próprio, sem dependência. Estes testes montam arquivos REAIS —
// diretório central, cabeçalho local, deflate cru, sharedStrings — porque um teste contra
// um objeto simulado provaria só que o simulacro combina comigo mesmo. O arquivo da Caixa
// tem ~20 MB e é o único juiz que importa; o mais perto disso que dá para chegar offline é
// gerar o mesmo formato de arquivo.
import assert from "node:assert/strict";
import { deflateRawSync, crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { abrirZip } = await vite.ssrLoadModule("/lib/integrations/planilha-zip.ts");
const { abrirPlanilha } = await vite.ssrLoadModule("/lib/integrations/planilha-xlsx.ts");
after(() => vite.close());

// Escritor de ZIP mínimo, só para os testes: gera o mesmo formato que se espera ler.
function montarZip(arquivos, { comprimir = true } = {}) {
  const locais = [];
  const centrais = [];
  let deslocamento = 0;
  for (const [nome, conteudoTexto] of Object.entries(arquivos)) {
    const conteudo = Buffer.from(conteudoTexto, "utf8");
    const dados = comprimir ? deflateRawSync(conteudo) : conteudo;
    const metodo = comprimir ? 8 : 0;
    const nomeBytes = Buffer.from(nome, "utf8");
    const soma = crc32(conteudo);

    const local = Buffer.alloc(30 + nomeBytes.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(soma, 14); local.writeUInt32LE(dados.length, 18); local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nomeBytes.length, 26);
    nomeBytes.copy(local, 30);
    locais.push(local, dados);

    const central = Buffer.alloc(46 + nomeBytes.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(soma, 16); central.writeUInt32LE(dados.length, 20); central.writeUInt32LE(conteudo.length, 24);
    central.writeUInt16LE(nomeBytes.length, 28); central.writeUInt32LE(deslocamento, 42);
    nomeBytes.copy(central, 46);
    centrais.push(central);

    deslocamento += local.length + dados.length;
  }
  const corpoCentral = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(centrais.length, 8); fim.writeUInt16LE(centrais.length, 10);
  fim.writeUInt32LE(corpoCentral.length, 12); fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, corpoCentral, fim]);
}

function montarXlsx(abas) {
  const textos = [];
  const indiceDe = (texto) => { const achado = textos.indexOf(texto); if (achado >= 0) return achado; textos.push(texto); return textos.length - 1; };
  const letra = (n) => { let s = ""; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

  const folhas = Object.entries(abas).map(([nome, linhas], posicao) => {
    const corpo = linhas.map((celulas, l) => {
      const cs = celulas.map((valor, c) => {
        if (valor === null || valor === undefined || valor === "") return "";
        const referencia = `${letra(c)}${l + 1}`;
        return typeof valor === "number"
          ? `<c r="${referencia}"><v>${valor}</v></c>`
          : `<c r="${referencia}" t="s"><v>${indiceDe(String(valor))}</v></c>`;
      }).join("");
      return `<row r="${l + 1}">${cs}</row>`;
    }).join("");
    return { nome, arquivo: `worksheets/sheet${posicao + 1}.xml`, id: `rId${posicao + 1}`, xml: `<?xml version="1.0"?><worksheet><sheetData>${corpo}</sheetData></worksheet>` };
  });

  const arquivos = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types/>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook><sheets>${folhas.map((f) => `<sheet name="${f.nome}" sheetId="1" r:id="${f.id}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships>${folhas.map((f) => `<Relationship Id="${f.id}" Target="${f.arquivo}"/>`).join("")}</Relationships>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${textos.map((t) => `<si><t>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></si>`).join("")}</sst>`,
  };
  for (const f of folhas) arquivos[`xl/${f.arquivo}`] = f.xml;
  return montarZip(arquivos);
}

test("lê o índice e extrai entrada comprimida com deflate", () => {
  const zip = abrirZip(montarZip({ "a.txt": "conteúdo A", "pasta/b.txt": "conteúdo B" }));
  assert.deepEqual(zip.entradas.map((e) => e.nome), ["a.txt", "pasta/b.txt"]);
  assert.equal(zip.extrair("a.txt").toString("utf8"), "conteúdo A");
  assert.equal(zip.extrair("pasta/b.txt").toString("utf8"), "conteúdo B");
});

test("lê entrada guardada sem compressão", () => {
  const zip = abrirZip(montarZip({ "puro.txt": "sem deflate" }, { comprimir: false }));
  assert.equal(zip.extrair("puro.txt").toString("utf8"), "sem deflate");
});

test("dois arquivos diferentes com o mesmo nome de entrada não se misturam", () => {
  // O primeiro desenho usava um mapa no escopo do módulo, e este caso o quebrava.
  const um = abrirZip(montarZip({ "dados.xml": "sou o primeiro" }));
  const dois = abrirZip(montarZip({ "dados.xml": "sou o segundo" }));
  assert.equal(um.extrair("dados.xml").toString("utf8"), "sou o primeiro");
  assert.equal(dois.extrair("dados.xml").toString("utf8"), "sou o segundo");
});

test("recusa arquivo que não é ZIP, com mensagem que diz o que houve", () => {
  assert.throws(() => abrirZip(Buffer.from("isto é um PDF, não um ZIP")), /não é um ZIP válido/);
});

test("entrada inexistente é erro nomeado, não leitura de lixo", () => {
  const zip = abrirZip(montarZip({ "a.txt": "x" }));
  assert.throws(() => zip.extrair("b.txt"), /"b.txt" não existe/);
});

test("lê aba de XLSX com texto compartilhado e número", () => {
  const planilha = abrirPlanilha(montarXlsx({
    "Analítico": [["CODIGO", "DESCRICAO", "UNIDADE", "CUSTO"], ["88309", "PEDREIRO COM ENCARGOS", "H", 27.61]],
  }));
  assert.deepEqual(planilha.abas, ["Analítico"]);
  const linhas = planilha.linhas("Analítico");
  assert.deepEqual(linhas[0], ["CODIGO", "DESCRICAO", "UNIDADE", "CUSTO"]);
  assert.deepEqual(linhas[1], ["88309", "PEDREIRO COM ENCARGOS", "H", "27.61"]);
});

test("célula vazia no meio não desloca a linha", () => {
  // Numa planilha da Caixa uma coluna sem valor é comum; se a leitura empurrasse as
  // seguintes, todo preço sairia na coluna errada — e errado em silêncio.
  const planilha = abrirPlanilha(montarXlsx({ "P": [["A", "", "C", "", "E"]] }));
  assert.deepEqual(planilha.linhas("P")[0], ["A", "", "C", "", "E"]);
});

test("coluna além de Z é endereçada certo", () => {
  const largura = 30;
  const cabecalho = Array.from({ length: largura }, (_, i) => `col${i}`);
  const planilha = abrirPlanilha(montarXlsx({ "P": [cabecalho] }));
  const lida = planilha.linhas("P")[0];
  assert.equal(lida.length, largura, "as 27 UFs em colunas passam de Z; AA em diante precisa funcionar");
  assert.equal(lida[29], "col29");
});

test("acento e e-comercial voltam decodificados", () => {
  const planilha = abrirPlanilha(montarXlsx({ "P": [["CONCRETO & AÇO", "ALVENARIA <ESTRUTURAL>"]] }));
  assert.deepEqual(planilha.linhas("P")[0], ["CONCRETO & AÇO", "ALVENARIA <ESTRUTURAL>"]);
});

test("o limite de linhas evita abrir a planilha inteira", () => {
  const muitas = Array.from({ length: 500 }, (_, i) => [`linha ${i}`]);
  const planilha = abrirPlanilha(montarXlsx({ "P": muitas }));
  assert.equal(planilha.linhas("P", 5).length, 5);
  assert.equal(planilha.linhas("P").length, 500);
});

test("aba inexistente diz quais existem", () => {
  const planilha = abrirPlanilha(montarXlsx({ "Real": [["x"]] }));
  assert.throws(() => planilha.linhas("Inventada"), /"Inventada" não existe; há "Real"/);
});
