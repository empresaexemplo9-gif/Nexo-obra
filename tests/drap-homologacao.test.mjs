import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFile(`${root}/${path}`, "utf8");

// O roteiro de homologação toca uma API real com uma credencial real. Um
// script assim erra de dois jeitos caros: vazando a chave na saída ou
// escrevendo no tenant de alguém sem ser pedido. Os dois estão travados aqui.

test("a homologação nunca imprime a credencial", async () => {
  const script = await source("scripts/homologar-drap.mjs");

  for (const linha of script.split("\n")) {
    if (!/console\.(log|error|warn)/.test(linha)) continue;
    assert.doesNotMatch(linha, /\bTOKEN\b/, `credencial na saída: ${linha.trim()}`);
  }
});

test("escrita é opt-in e a sonda de escopo não apaga dado real", async () => {
  const script = await source("scripts/homologar-drap.mjs");

  assert.match(script, /const ESCRITA = process\.argv\.includes\("--escrita"\)/);
  assert.match(script, /if \(!ESCRITA\)/);

  // A sonda descobre o escopo da chave mandando DELETE num id que não existe:
  // 403 = não pode apagar, 404 = pode. Nos dois casos nada é apagado.
  assert.match(script, /"\/lancamentos\/0{8}-0{4}-0{4}-0{4}-0{12}", \{ method: "DELETE" \}/);
});

test("a homologação fala com a Drap do mesmo jeito que o adaptador", async () => {
  const script = await source("scripts/homologar-drap.mjs");

  assert.match(script, /DRAP_API_URL/);
  assert.match(script, /DRAP_API_KEY_HEADER/);
  assert.match(script, /Authorization = `Bearer \$\{TOKEN\}`/);
  assert.match(script, /startsWith\("https:\/\/"\)/);

  // Tenant sai da chave, no servidor da Drap. Mandar identificador de empresa
  // na chamada seria pedir pro outro lado confiar em quem chama.
  assert.doesNotMatch(script, /company_id|organization_id|companyId/);
});

test("a homologação não entra no npm test — precisa de rede e de chave real", async () => {
  const pkg = JSON.parse(await source("package.json"));

  assert.equal(pkg.scripts["homologar:drap"], "node scripts/homologar-drap.mjs");
  assert.doesNotMatch(pkg.scripts.test, /homologar/);
});

test("o roteiro aponta o preset de escopo correto e o tenant de teste", async () => {
  const doc = await source("docs/HOMOLOGACAO-DRAP.md");

  assert.match(doc, /Leitura e escrita/);
  assert.match(doc, /tenant de teste|Tenant de teste/i);
  assert.match(doc, /NEXT_PUBLIC/);
  // Os dois avisos esperados hoje são a fatia seguinte, não falha de credencial.
  assert.match(doc, /centro_custo/);
});
