import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

// Cifra das fotos do diário.
//
// O Vercel Blob publica cada objeto numa URL aleatória e não oferece leitura assinada
// com expiração: quem tiver a URL exata busca o arquivo sem passar pela autorização das
// rotas. Guardar a foto em claro ali seria trocar garantia criptográfica por "ninguém vai
// descobrir o endereço". Estes testes verificam o que está gravado, não só o que volta.

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformEnvOverride = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const storage = await vite.ssrLoadModule("/lib/server/storage.ts");
after(async () => { await vite.close(); delete globalThis.__platformEnvOverride; });

const CHAVE = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const OUTRA = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY=";
// Uma foto JPEG mínima: o que importa é serem bytes reconhecíveis no armazenamento.
const foto = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9]);

let guardado;
function memoria() {
  return {
    async put(path, value) { guardado.set(path, new Uint8Array(value)); return path; },
    async get(key) { return guardado.has(key) ? { body: new Response(guardado.get(key)).body } : null; },
    async delete(key) { guardado.delete(key); },
  };
}
const bytesDe = (objeto) => new Response(objeto.body).arrayBuffer().then((buffer) => new Uint8Array(buffer));

beforeEach(() => {
  guardado = new Map();
  Object.assign(runtime, { FILES: memoria(), MEDIA_ENCRYPTION_KEY: CHAVE });
});

test("o que fica no armazenamento não é a foto: é envelope cifrado", async () => {
  const chave = await storage.putObject("diary/org/entrada/uuid", foto.buffer.slice(0), "image/jpeg");
  const cru = guardado.get(chave);

  assert.ok(cru, "algo foi gravado");
  assert.equal(String.fromCharCode(...cru.subarray(0, 4)), "NXO1", "cabeçalho do envelope");
  // Nem o começo do JPEG aparece: o conteúdo não está em claro em nenhum deslocamento.
  const cruTexto = Array.from(cru).join(",");
  assert.doesNotMatch(cruTexto, new RegExp(Array.from(foto).join(",")), "a foto não pode aparecer em claro");
  assert.ok(cru.byteLength > foto.byteLength + 16, "envelope traz vetor de inicialização e etiqueta");

  // E a volta devolve exatamente os bytes originais.
  assert.deepEqual(await bytesDe(await storage.getObject(chave)), foto);
});

test("o vetor de inicialização é sorteado por objeto: dois envios iguais não geram o mesmo texto cifrado", async () => {
  const primeira = await storage.putObject("diary/org/entrada/a", foto.buffer.slice(0), "image/jpeg");
  const segunda = await storage.putObject("diary/org/entrada/b", foto.buffer.slice(0), "image/jpeg");
  assert.notDeepEqual(guardado.get(primeira), guardado.get(segunda),
    "cifrar a mesma foto duas vezes com o mesmo resultado revelaria que são iguais");
  for (const chave of [primeira, segunda]) {
    assert.deepEqual(await bytesDe(await storage.getObject(chave)), foto);
  }
});

test("objeto adulterado não é servido como se fosse a foto", async () => {
  const chave = await storage.putObject("diary/org/entrada/uuid", foto.buffer.slice(0), "image/jpeg");
  const envelope = guardado.get(chave);

  // Um byte trocado no meio do texto cifrado.
  const alterado = Uint8Array.from(envelope);
  alterado[alterado.byteLength - 20] ^= 0xff;
  guardado.set(chave, alterado);
  assert.equal(await storage.getObject(chave), null, "a etiqueta de autenticação precisa reprovar");

  // Truncado.
  guardado.set(chave, envelope.subarray(0, envelope.byteLength - 5));
  assert.equal(await storage.getObject(chave), null);

  // Sem o cabeçalho: bytes arbitrários não passam por foto.
  guardado.set(chave, foto);
  assert.equal(await storage.getObject(chave), null);
});

test("a chave errada não abre o envelope", async () => {
  const chave = await storage.putObject("diary/org/entrada/uuid", foto.buffer.slice(0), "image/jpeg");
  runtime.MEDIA_ENCRYPTION_KEY = OUTRA;
  assert.equal(await storage.getObject(chave), null, "outra chave não decifra");
  runtime.MEDIA_ENCRYPTION_KEY = CHAVE;
  assert.deepEqual(await bytesDe(await storage.getObject(chave)), foto, "com a chave certa, volta");
});

test("sem chave configurada, nada é gravado em claro por omissão", async () => {
  for (const configurada of [undefined, "", "chave-curta", "bm9wZQ=="]) {
    runtime.MEDIA_ENCRYPTION_KEY = configurada;
    await assert.rejects(
      storage.putObject("diary/org/entrada/uuid", foto.buffer.slice(0), "image/jpeg"),
      (error) => error.status === 503 && error.code === "storage_unavailable",
      `deveria recusar com ${JSON.stringify(configurada)}`,
    );
    assert.equal(guardado.size, 0, "nenhum byte pode chegar ao armazenamento sem cifra");
  }
});

test("apagar remove o objeto, e ler o que não existe devolve vazio", async () => {
  const chave = await storage.putObject("diary/org/entrada/uuid", foto.buffer.slice(0), "image/jpeg");
  await storage.deleteObject(chave);
  assert.equal(guardado.size, 0);
  assert.equal(await storage.getObject(chave), null);
});
