// Documentos e PDF. O que se testa é o que erra em silêncio: página perdida ao juntar,
// giro que não soma, intervalo aceito quando não existe, acento que vira lixo no PDF e
// ZIP que o programa de descompactar recusa.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";
import { PDFDocument, degrees } from "pdf-lib";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const pdf = await vite.ssrLoadModule("/lib/documentos-pdf.ts");
const md = await vite.ssrLoadModule("/lib/markdown-doc.ts");
const { abrirZip } = await vite.ssrLoadModule("/lib/integrations/planilha-zip.ts");
after(() => vite.close());

async function pdfCom(paginas, giro = 0) {
  const documento = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) {
    const pagina = documento.addPage([300 + i, 400]);
    if (giro) pagina.setRotation(degrees(giro));
  }
  return documento.save();
}
const larguras = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

test("juntar mantém todas as páginas na ordem dos arquivos", async () => {
  const saida = await pdf.juntarPdfs([{ nome: "a.pdf", bytes: await pdfCom(2) }, { nome: "b.pdf", bytes: await pdfCom(3) }]);
  assert.deepEqual(await larguras(saida), [300, 301, 300, 301, 302]);
});

test("juntar recusa um arquivo só e PDF inválido, com o nome do arquivo", async () => {
  await assert.rejects(pdf.juntarPdfs([{ nome: "a.pdf", bytes: await pdfCom(1) }]), /pelo menos dois/);
  await assert.rejects(pdf.juntarPdfs([{ nome: "a.pdf", bytes: await pdfCom(1) }, { nome: "planta.pdf", bytes: new TextEncoder().encode("não é pdf") }]), /“planta.pdf” não é um PDF válido/);
});

test("organizar reordena, exclui e soma o giro ao que a página já tinha", async () => {
  const saida = await pdf.organizarPdf(await pdfCom(3, 90), [{ indice: 2, giro: 0 }, { indice: 0, giro: 270 }]);
  const documento = await PDFDocument.load(saida);
  assert.deepEqual(documento.getPages().map((p) => p.getWidth()), [302, 300]);
  assert.deepEqual(documento.getPages().map((p) => p.getRotation().angle), [90, 0]);
  await assert.rejects(pdf.organizarPdf(await pdfCom(1), []), /pelo menos uma página/);
  await assert.rejects(pdf.organizarPdf(await pdfCom(1), [{ indice: 4, giro: 0 }]), /fora do arquivo/);
});

test("intervalos aceitam página solta, faixa e faixa aberta; recusam o que não existe", () => {
  assert.deepEqual(pdf.lerIntervalos("1-3, 5, 8-", 9), [[0, 1, 2], [4], [7, 8]]);
  assert.deepEqual(pdf.lerIntervalos("-2", 4), [[0, 1]]);
  assert.throws(() => pdf.lerIntervalos("2-12", 10), /tem 10 página/);
  assert.throws(() => pdf.lerIntervalos("4-2", 10), /não existe/);
  assert.throws(() => pdf.lerIntervalos("a", 10), /Não entendi/);
  assert.throws(() => pdf.lerIntervalos(" ", 10), /Informe as páginas/);
});

test("dividir gera um PDF por grupo, só com as páginas pedidas", async () => {
  const saidas = await pdf.dividirPdf(await pdfCom(5), [[0, 1], [4]]);
  assert.equal(saidas.length, 2);
  assert.deepEqual(await larguras(saidas[0]), [300, 301]);
  assert.deepEqual(await larguras(saidas[1]), [304]);
});

test("carimbo numera e aplica marca d'água inclusive em página girada", async () => {
  const saida = await pdf.carimbarPdf(await pdfCom(2, 90), { numeros: { posicao: "rodape-centro", formato: "n-de-total", primeiro: 1 }, marca: { texto: "CÓPIA – NÃO APROVADA", opacidade: 0.2, tamanho: 48 } });
  const documento = await PDFDocument.load(saida);
  assert.equal(documento.getPageCount(), 2);
  await assert.rejects(pdf.carimbarPdf(await pdfCom(1), {}), /Escolha numerar/);
});

test("texto seguro mantém acento e cedilha e troca o que a fonte padrão não escreve", () => {
  assert.equal(pdf.textoSeguro("Ação — “memorial” € ≥ 2 🏠"), "Ação — “memorial” € >= 2 ?");
});

test("imagens viram uma página A4 por imagem, deitada quando a foto é larga", async () => {
  // PNG 2×1 vermelho, gerado à mão.
  const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAHAgEB0j7uSQAAAABJRU5ErkJggg==", "base64"));
  const saida = await pdf.imagensParaPdf([{ bytes, tipo: "png" }, { bytes, tipo: "png" }], { pagina: "a4", orientacao: "auto", margem: 20 });
  const documento = await PDFDocument.load(saida);
  assert.equal(documento.getPageCount(), 2);
  assert.ok(documento.getPage(0).getWidth() > documento.getPage(0).getHeight());
  await assert.rejects(pdf.imagensParaPdf([], { pagina: "a4", orientacao: "auto", margem: 0 }), /pelo menos uma imagem/);
});

test("Markdown vira blocos com títulos, listas, tabela e código, sem interpretar HTML", () => {
  const blocos = md.lerMarkdown("# Memorial\n\nTexto **forte** e *leve* com [link](https://drap.com.br).\n\n- um\n- dois\n\n1. primeiro\n2. segundo\n\n| Item | Valor |\n| --- | --- |\n| Piso | 10 |\n\n```\n<script>x</script>\n```\n\n> nota\n\n---\n<b>texto</b>");
  assert.deepEqual(blocos.map((b) => b.tipo), ["titulo", "paragrafo", "lista", "lista", "tabela", "codigo", "citacao", "divisoria", "paragrafo"]);
  assert.deepEqual(blocos[1].trechos, [{ texto: "Texto " }, { texto: "forte", negrito: true }, { texto: " e " }, { texto: "leve", italico: true }, { texto: " com " }, { texto: "link" }, { texto: " (https://drap.com.br)" }, { texto: "." }]);
  assert.equal(blocos[3].ordenada, true);
  assert.deepEqual(blocos[5].linhas, ["<script>x</script>"]);
  assert.equal(blocos[8].trechos[0].texto, "<b>texto</b>");
  assert.equal(md.tituloDoMarkdown("texto\n\n## Ata de obra\n"), "Ata de obra");
  // Linha escrita é linha: "Cliente" e "Endereço" não se fundem no mesmo parágrafo corrido.
  assert.deepEqual(md.lerMarkdown("Cliente: Ana\nEndereço: Rua 1")[0].trechos.map((t) => t.texto), ["Cliente: Ana", "\n", "Endereço: Rua 1"]);
});

test("Markdown gera PDF com título, várias páginas quando precisa e numeração", async () => {
  const longo = `# Memorial descritivo\n\n${Array.from({ length: 120 }, (_, i) => `Parágrafo ${i + 1} com acentuação: fundação, alvenaria e revestimento.`).join("\n\n")}\n\n| A | B |\n|---|---|\n| 1 | 2 |`;
  const saida = await pdf.markdownParaPdf(longo, { titulo: "Memorial descritivo", numerarPaginas: true });
  const documento = await PDFDocument.load(saida);
  assert.ok(documento.getPageCount() >= 3);
  assert.equal(documento.getTitle(), "Memorial descritivo");
  await assert.rejects(pdf.markdownParaPdf("   \n"), /Escreva o conteúdo/);
});

test("texto extraído de PDF volta como Markdown, com título pelo tamanho da letra", () => {
  const saida = md.paginasParaMarkdown([[
    { texto: "Ata", x: 50, y: 800, altura: 20 },
    { texto: "de reunião", x: 90, y: 800, altura: 20 },
    { texto: "Presentes: cliente e", x: 50, y: 760, altura: 10 },
    { texto: "arquiteta.", x: 160, y: 760, altura: 10 },
    { texto: "Decisões", x: 50, y: 700, altura: 13 },
    { texto: "Trocar o piso.", x: 50, y: 680, altura: 10 },
  ], [{ texto: "Página dois", x: 50, y: 800, altura: 10 }]]);
  assert.equal(saida, "# Ata de reunião\n\nPresentes: cliente e arquiteta.\n\n## Decisões\n\nTrocar o piso.\n\n---\n\nPágina dois\n");
});

test("título é reconhecido mesmo em página com poucas linhas", () => {
  const saida = md.paginasParaMarkdown([[
    { texto: "Planta baixa", x: 60, y: 760, altura: 28 },
    { texto: "Texto corrido da página para extrair.", x: 60, y: 700, altura: 12 },
  ]]);
  assert.equal(saida, "# Planta baixa\n\nTexto corrido da página para extrair.\n");
});

test("ZIP sem compressão abre no leitor da plataforma, com nomes repetidos separados", () => {
  const um = new TextEncoder().encode("primeiro");
  const dois = new TextEncoder().encode("segundo arquivo");
  const zip = pdf.criarZip([{ nome: "páginas 1-2.pdf", bytes: um }, { nome: "páginas 1-2.pdf", bytes: dois }]);
  const lido = abrirZip(Buffer.from(zip));
  assert.deepEqual(lido.entradas.map((e) => e.nome), ["páginas 1-2.pdf", "páginas 1-2 (2).pdf"]);
  assert.equal(lido.extrair("páginas 1-2 (2).pdf").toString(), "segundo arquivo");
  assert.equal(pdf.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
