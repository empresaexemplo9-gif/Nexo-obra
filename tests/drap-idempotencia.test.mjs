// Escrita financeira é operação distribuída (regra 5 do CLAUDE.md). Um tempo esgotado
// numa requisição que a Drap já efetivou faz a tentativa seguinte duplicar o lançamento.
// `createDrapCharge` já mandava chave de idempotência; as rotas operacionais, que a nova
// tela de Lançamentos usa, não mandavam nenhuma.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { chaveIdempotenciaDe } = await vite.ssrLoadModule("/lib/server/drap-operational.ts");
after(() => vite.close());

const comCabecalho = (valor) => new Request("https://plataforma.test/x", { headers: valor === null ? {} : { "Idempotency-Key": valor } });

test("uma chave válida atravessa", () => {
  const chave = "3f2b9c10-77ab-4f0e-9d21-8a1b2c3d4e5f";
  assert.equal(chaveIdempotenciaDe(comCabecalho(chave)), chave);
});

test("ausência devolve indefinido, não string vazia", () => {
  // String vazia como chave faria a Drap tratar envios distintos como o mesmo.
  assert.equal(chaveIdempotenciaDe(comCabecalho(null)), undefined);
  assert.equal(chaveIdempotenciaDe(comCabecalho("   ")), undefined);
});

test("nada além de identificador atravessa até a Drap", () => {
  // Quebra de linha não entra: a própria plataforma recusa o cabeçalho antes do código
  // ver, então testá-la seria testar o runtime, não a higienização.
  for (const sujo of ["curta", "com espaço no meio", "a".repeat(200), "aspas\"e'coisas", "../../etc/passwd", "chave;com;ponto;e;virgula"]) {
    assert.equal(chaveIdempotenciaDe(comCabecalho(sujo)), undefined, `deixou passar: ${JSON.stringify(sujo).slice(0, 30)}`);
  }
});

test("a rota de lançamentos repassa a chave para a Drap", async () => {
  const fonte = await (await import("node:fs/promises")).readFile(new URL("../app/api/integrations/drap/lancamentos/route.ts", import.meta.url), "utf8");
  assert.match(fonte, /idempotencyKey: chaveIdempotenciaDe\(request\)/,
    "sem isso o cabeçalho enviado pela tela morre na rota e não protege nada");
});

test("o adaptador põe a chave no cabeçalho da chamada à Drap", async () => {
  const fonte = await (await import("node:fs/promises")).readFile(new URL("../lib/integrations/drap.ts", import.meta.url), "utf8");
  assert.match(fonte, /if \(init\.idempotencyKey\) headers\.set\("Idempotency-Key", init\.idempotencyKey\)/);
});
