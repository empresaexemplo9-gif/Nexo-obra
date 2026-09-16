import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const contract = await vite.ssrLoadModule("/lib/integrations/sinapi-contract.ts");
test.after(() => vite.close());

test("normaliza os parâmetros básicos do SINAPI", () => {
  assert.equal(contract.normalizeSinapiUf(" go "), "GO");
  assert.equal(contract.normalizeReferenceMonth("2024-12"), "2024-12");
  assert.equal(contract.referenceDate("2024-12"), "2024-12-01");
  assert.equal(contract.apiRegime("Desonerado"), "DESONERADO");
  assert.equal(contract.apiRegime("NaoDesonerado"), "NAO_DESONERADO");
  assert.throws(() => contract.normalizeSinapiUf("XX"));
  assert.throws(() => contract.normalizeReferenceMonth("2024-13"));
});

test("até 2024 não inventa URL da Caixa para nomes históricos irregulares", () => {
  assert.equal(contract.isLegacyCaixaReference("2024-12"), true);
  assert.throws(() => contract.sourceUrl("2024-12"), /envio manual/i);
});

test("a partir de 2025 usa o pacote consolidado XLSX da Caixa", () => {
  assert.equal(contract.isLegacyCaixaReference("2025-01"), false);
  assert.equal(contract.sourceUrl("2025-01"), "https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/SINAPI-2025-01-formato-xlsx.zip");
});
