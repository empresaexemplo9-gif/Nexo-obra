import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { buildPdf, pdfText, deflate } = await vite.ssrLoadModule("/lib/pdf-writer.ts");
const desenho = await vite.ssrLoadModule("/lib/prancheta-desenho.ts");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
after(() => vite.close());

// Uma sala 4 m × 3 m em milímetros, com porta em arco aproximado, texto em triângulo
// (como o visualizador entrega) e uma camada vermelha.
const sala = [
  { tipo: "linhas", cor: 0x000000, coords: [0, 0, 4000, 0, 4000, 0, 4000, 3000, 4000, 3000, 0, 3000, 0, 3000, 0, 0] },
  { tipo: "linhas", cor: 0xff0000, coords: [1000, 0, 1000, 800] },
  { tipo: "triangulos", cor: 0x0000ff, coords: [100, 100, 300, 100, 200, 250] },
];

async function abrir(bytes) {
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
}

test("PDF do desenho abre num leitor real, na folha pedida e deitado quando o desenho é largo", async () => {
  const bytes = await desenho.pdfDoDesenho(sala, { folha: "A3", monocromatico: false, titulo: "Planta Térreo — Área técnica" });
  const document = await abrir(bytes);
  assert.equal(document.numPages, 1);
  const page = await document.getPage(1);
  const [, , width, height] = page.view;
  assert.equal(Math.round(width / 72 * 25.4), 420);
  assert.equal(Math.round(height / 72 * 25.4), 297);
  const metadata = await document.getMetadata();
  assert.equal(metadata.info.Title, "Planta Térreo — Área técnica");
  const operators = await page.getOperatorList();
  assert.ok(operators.fnArray.length > 5, "o conteúdo vetorial foi interpretado");
});

test("o conteúdo é vetorial, encadeia segmentos e respeita a escala e a margem", async () => {
  const limites = desenho.limitesDe(sala);
  assert.deepEqual(limites, { minX: 0, minY: 0, maxX: 4000, maxY: 3000 });
  const { larguraPt, alturaPt } = desenho.orientacaoPara(limites, "A4");
  const content = desenho.conteudoPdf(sala, limites, larguraPt, alturaPt, { monocromatico: false });
  // O retângulo da sala é uma polilinha: um "m" e quatro "l".
  const primeiro = content.split("\n0 0 1 rg")[0];
  const retangulo = primeiro.slice(primeiro.indexOf("0 0 0 RG"), primeiro.indexOf("1 0 0 RG"));
  assert.equal((retangulo.match(/ m$/gm) ?? []).length, 1);
  assert.equal((retangulo.match(/ l$/gm) ?? []).length, 4);
  assert.match(content, /1 0 0 RG/, "a cor da camada vermelha foi mantida");
  assert.match(content, / l h\nf/, "texto e hachura saem preenchidos");
  // Margem de 10 mm: o canto do desenho começa em 10 mm ou mais da borda.
  const numeros = [...content.matchAll(/^([\d.]+) ([\d.]+) m$/gm)].map((match) => Number(match[1]));
  assert.ok(Math.min(...numeros) >= 10 * 72 / 25.4 - 0.01);
});

test("impressão em preto e branco troca todas as cores por preto", async () => {
  const limites = desenho.limitesDe(sala);
  const content = desenho.conteudoPdf(sala, limites, 800, 600, { monocromatico: true });
  assert.doesNotMatch(content, /1 0 0 RG/);
  assert.doesNotMatch(content, /0 0 1 rg/);
});

test("desenho vazio não gera PDF em branco", async () => {
  await assert.rejects(desenho.pdfDoDesenho([], { folha: "A4", monocromatico: false, titulo: "x" }), /nada visível/);
});

test("tabela xref aponta para cada objeto mesmo com título acentuado", async () => {
  const content = await deflate(new TextEncoder().encode("0 0 m 10 10 l S"));
  const bytes = buildPdf([{ width: 100, height: 100, content, contentCompressed: true }], { title: "Ação — Canteiro" });
  const text = Buffer.from(bytes).toString("latin1");
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(xref).startsWith("xref"));
  const entries = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  entries.forEach((offset, index) => assert.ok(text.slice(offset).startsWith(`${index + 1} 0 obj`), `objeto ${index + 1}`));
  const stream = /stream\n([\s\S]*?)\nendstream/.exec(text.slice(text.indexOf("5 0 obj")))[1];
  assert.equal(inflateSync(Buffer.from(stream, "latin1")).toString(), "0 0 m 10 10 l S");
  assert.equal(pdfText("Aé"), "<FEFF004100E9>");
});

test("imagem JPEG entra no PDF byte a byte, sem recompressão", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const content = new TextEncoder().encode("q 200 0 0 100 0 0 cm /Im0 Do Q");
  const bytes = buildPdf([{ width: 200, height: 100, content, contentCompressed: false, images: [{ name: "Im0", width: 2, height: 1, data: jpeg, filter: "DCTDecode", colorSpace: "DeviceRGB" }] }]);
  const text = Buffer.from(bytes).toString("latin1");
  assert.match(text, /\/Subtype \/Image \/Width 2 \/Height 1 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 9/);
  assert.ok(Buffer.from(bytes).includes(Buffer.from(jpeg)));
});

test("SVG do desenho é XML válido, em unidades do desenho e com o Y invertido", () => {
  const svg = desenho.svgDoDesenho(sala, { monocromatico: false, titulo: "Sala <térreo>" });
  const document = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  assert.equal(document.querySelector("parsererror"), null);
  const root = document.documentElement;
  assert.equal(root.getAttribute("viewBox"), "0 0 4000 3000");
  assert.equal(document.querySelector("title").textContent, "Sala <térreo>");
  const porta = [...document.querySelectorAll("path")].find((path) => path.getAttribute("stroke") === "#ff0000");
  // (1000,0)→(1000,800) no CAD vira (1000,3000)→(1000,2200) no SVG.
  assert.equal(porta.getAttribute("d"), "M1000 3000L1000 2200");
});

test("JPEG vira PDF com os bytes originais e a página no tamanho da imagem", async () => {
  const { pdfDeImagem, jpegInfo } = await vite.ssrLoadModule("/lib/pdf-writer.ts");
  // JPEG mínimo: SOI, SOF0 de 300×150 com 3 canais, EOI.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x96, 0x01, 0x2c, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  assert.deepEqual(jpegInfo(jpeg), { width: 300, height: 150, components: 3 });
  const bytes = await pdfDeImagem({ tipo: "jpeg", bytes: jpeg }, "Fachada");
  const text = Buffer.from(bytes).toString("latin1");
  assert.match(text, /\/MediaBox \[0 0 144 72\]/, "300×150 px a 150 dpi = 144×72 pt");
  assert.ok(Buffer.from(bytes).includes(Buffer.from(jpeg)));
  await assert.rejects(pdfDeImagem({ tipo: "jpeg", bytes: new Uint8Array([1, 2, 3]) }, "x"), /CMYK ou inválido/);
});

test("imagem decodificada vira PDF sem perda e abre no leitor", async () => {
  const { pdfDeImagem } = await vite.ssrLoadModule("/lib/pdf-writer.ts");
  const rgb = new Uint8Array(4 * 2 * 3).fill(200);
  const bytes = await pdfDeImagem({ tipo: "rgb", rgb, largura: 4, altura: 2 }, "Detalhe");
  const document = await abrir(bytes);
  assert.equal(document.numPages, 1);
  const operators = await (await document.getPage(1)).getOperatorList();
  assert.ok(operators.fnArray.includes(pdfjs.OPS.paintImageXObject), "a imagem é desenhada na página");
});

test("texto com acento vai no fluxo do PDF em WinAnsi e o leitor devolve igual", async () => {
  const { buildPdf, textoWinAnsi } = await vite.ssrLoadModule("/lib/pdf-writer.ts");
  assert.equal(textoWinAnsi("Ação — m²"), "<41E7E36F2097206DB2>");
  const titulo = "Proposta — Cozinha e Área de Serviço";
  const conteudo = new TextEncoder().encode(`BT /F2 18 Tf 40 60 Td ${textoWinAnsi(titulo)} Tj ET`);
  const bytes = buildPdf([{ width: 600, height: 100, content: conteudo, contentCompressed: false, fonts: true }]);
  const document = await abrir(bytes);
  const texto = await (await document.getPage(1)).getTextContent();
  assert.equal(texto.items.map((item) => item.str).join(""), titulo);
});
