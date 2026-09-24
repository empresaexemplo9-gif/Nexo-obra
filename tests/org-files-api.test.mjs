import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB, params, permissions } from "./helpers/api-harness.mjs";

const h = await createHarness();
const files = await h.load("/app/api/arquivos/route.ts");
const item = await h.load("/app/api/arquivos/[fileId]/route.ts");
const part = await h.load("/app/api/arquivos/[fileId]/partes/[index]/route.ts");
const done = await h.load("/app/api/arquivos/[fileId]/concluir/route.ts");
const convert = await h.load("/app/api/arquivos/[fileId]/converter/route.ts");
const { FILE_CHUNK_BYTES } = await h.load("/lib/org-files.ts");

beforeEach(() => h.reset());
after(() => h.close());

function randomBytes(size) {
  const bytes = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += 65536) crypto.getRandomValues(bytes.subarray(offset, Math.min(size, offset + 65536)));
  return bytes;
}

async function open(user, input, org = orgA) {
  return files.POST(h.request(user, "/api/arquivos", { method: "POST", json: input, org }));
}

async function upload(user, name, bytes, { area = "prancheta", org = orgA, extra = {} } = {}) {
  const created = await open(user, { name, sizeBytes: bytes.byteLength, area, ...extra }, org);
  assert.equal(created.status, 201, await created.clone().text());
  const { upload: info } = await created.json();
  for (let index = 0; index < info.chunkCount; index += 1) {
    const slice = bytes.slice(index * info.chunkSize, (index + 1) * info.chunkSize);
    const response = await part.PUT(h.request(user, `/api/arquivos/${info.id}/partes/${index}`, { method: "PUT", body: slice, org, headers: { "content-type": "application/octet-stream" } }), params({ fileId: info.id, index: String(index) }));
    assert.equal(response.status, 200, await response.clone().text());
  }
  const finished = await done.POST(h.request(user, `/api/arquivos/${info.id}/concluir`, { method: "POST", json: { area }, org }), params({ fileId: info.id }));
  assert.equal(finished.status, 200, await finished.clone().text());
  return (await finished.json()).file;
}

async function download(user, file, org = orgA) {
  const pieces = [];
  for (let index = 0; index < file.chunkCount; index += 1) {
    const response = await part.GET(h.request(user, `/api/arquivos/${file.id}/partes/${index}`, { org }), params({ fileId: file.id, index: String(index) }));
    if (response.status !== 200) return response;
    pieces.push(new Uint8Array(await response.arrayBuffer()));
  }
  return new Uint8Array(await new Blob(pieces).arrayBuffer());
}

test("arquivo maior que o limite da função sobe em partes e volta byte a byte", async () => {
  const original = randomBytes(FILE_CHUNK_BYTES * 2 + 12345);
  const file = await upload("owner", "Planta Térreo.dwg", original, { extra: { projectId: "p-a" } });
  assert.equal(file.chunkCount, 3);
  assert.equal(file.mimeType, "image/vnd.dwg", "DWG sem tipo do navegador recebe o tipo pela extensão");
  assert.equal(file.projectCode, "ARQ-1");
  assert.deepEqual(await download("owner", file), original);

  // O que foi gravado é o envelope cifrado, nunca o conteúdo em claro.
  const stored = [...h.objects.values()];
  assert.equal(stored.length, 3);
  for (const envelope of stored) assert.deepEqual([...envelope.subarray(0, 4)], [0x4e, 0x58, 0x4f, 0x31]);
  assert.notDeepEqual(stored[0].subarray(16, 48), original.subarray(0, 32));

  const listed = await (await files.GET(h.request("owner", "/api/arquivos"))).json();
  assert.deepEqual(listed.files.map((entry) => entry.name), ["Planta Térreo.dwg"]);
});

test("parte com tamanho errado e envio incompleto são recusados", async () => {
  const original = randomBytes(FILE_CHUNK_BYTES + 10);
  const { upload: info } = await (await open("owner", { name: "memorial.pdf", sizeBytes: original.byteLength, area: "prancheta" })).json();
  const wrong = await part.PUT(h.request("owner", `/api/arquivos/${info.id}/partes/1`, { method: "PUT", body: original.slice(0, 11) }), params({ fileId: info.id, index: "1" }));
  assert.equal(wrong.status, 400);
  const outside = await part.PUT(h.request("owner", `/api/arquivos/${info.id}/partes/2`, { method: "PUT", body: original.slice(0, 10) }), params({ fileId: info.id, index: "2" }));
  assert.equal(outside.status, 400);
  const incomplete = await done.POST(h.request("owner", `/api/arquivos/${info.id}/concluir`, { method: "POST", json: { area: "prancheta" } }), params({ fileId: info.id }));
  assert.equal(incomplete.status, 409);
  assert.match((await incomplete.json()).error, /Faltam 2 parte/);
  // Arquivo ainda não pronto não aparece na biblioteca.
  assert.equal((await (await files.GET(h.request("owner", "/api/arquivos"))).json()).files.length, 0);
});

test("reenviar a mesma parte substitui a anterior sem deixar objeto órfão", async () => {
  const original = randomBytes(1000);
  const { upload: info } = await (await open("owner", { name: "a.txt", sizeBytes: 1000, area: "prancheta" })).json();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await part.PUT(h.request("owner", `/api/arquivos/${info.id}/partes/0`, { method: "PUT", body: original }), params({ fileId: info.id, index: "0" }));
    assert.equal(response.status, 200);
  }
  assert.equal(h.objects.size, 1);
});

test("outra empresa não lista, não lê e não apaga o arquivo", async () => {
  const file = await upload("owner", "corte.pdf", randomBytes(2000));
  const listed = await (await files.GET(h.request("owner-b", "/api/arquivos", { org: orgB }))).json();
  assert.equal(listed.files.length, 0);
  const read = await download("owner-b", file, orgB);
  assert.equal(read.status, 404);
  const meta = await item.GET(h.request("owner-b", `/api/arquivos/${file.id}`, { org: orgB }), params({ fileId: file.id }));
  assert.equal(meta.status, 404);
  const removed = await item.DELETE(h.request("owner-b", `/api/arquivos/${file.id}`, { method: "DELETE", org: orgB }), params({ fileId: file.id }));
  assert.equal(removed.status, 404);
  assert.equal(h.objects.size, 1);
});

test("permissão da Prancheta: sem edição não envia à biblioteca, sem leitura não abre", async () => {
  h.member("leitor", orgA, "Leo Leitor", "member", permissions({ studio: { view: true, edit: false } }, false));
  h.member("sem", orgA, "Sara Sem", "member", permissions({}, false));
  const denied = await open("leitor", { name: "x.dwg", sizeBytes: 10, area: "prancheta" });
  assert.equal(denied.status, 403);

  const file = await upload("owner", "fachada.pdf", randomBytes(500));
  assert.equal((await download("leitor", file)).byteLength, 500);
  assert.equal((await download("sem", file)).status, 404);
  const blocked = await files.GET(h.request("sem", "/api/arquivos"));
  assert.equal(blocked.status, 403);
  const noDelete = await item.DELETE(h.request("leitor", `/api/arquivos/${file.id}`, { method: "DELETE" }), params({ fileId: file.id }));
  assert.equal(noDelete.status, 403);
});

test("executável é recusado mesmo com extensão dupla, e o limite de tamanho vale", async () => {
  for (const name of ["instalar.exe", "planta.pdf.exe", "script.ps1", "atalho.lnk"]) {
    const response = await open("owner", { name, sizeBytes: 10, area: "conversa" });
    assert.equal(response.status, 415, name);
  }
  const huge = await open("owner", { name: "nuvem.e57", sizeBytes: 151 * 1024 * 1024, area: "prancheta" });
  assert.equal(huge.status, 413);
});

test("excluir da biblioteca apaga os objetos quando nenhuma conversa usa o arquivo", async () => {
  const file = await upload("owner", "detalhe.dxf", randomBytes(FILE_CHUNK_BYTES + 1));
  assert.equal(h.objects.size, 2);
  const removed = await item.DELETE(h.request("owner", `/api/arquivos/${file.id}`, { method: "DELETE" }), params({ fileId: file.id }));
  assert.equal(removed.status, 204);
  assert.equal(h.objects.size, 0);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM org_files").get().n, 0);
  const audit = h.db.sqlite.prepare("SELECT action FROM audit_events ORDER BY created_at").all().map((row) => row.action);
  assert.deepEqual(audit, ["prancheta.file_added", "prancheta.file_removed"]);
});

test("conversão de desenho gerada no navegador entra ligada ao original", async () => {
  const source = await upload("owner", "planta.dxf", randomBytes(300));
  const pdf = await upload("owner", "planta.pdf", randomBytes(200), { extra: { sourceFileId: source.id, conversion: "dxf-pdf" } });
  assert.equal(pdf.sourceFileId, source.id);
  assert.equal(pdf.conversion, "dxf-pdf");
  const foreign = await open("owner-b", { name: "x.pdf", sizeBytes: 10, area: "prancheta", sourceFileId: source.id, conversion: "dxf-pdf" }, orgB);
  assert.equal(foreign.status, 404, "origem de outra empresa não é aceita");
});

test("DWG vira DXF no servidor, preserva a codificação do arquivo e não converte duas vezes", async () => {
  // Cabeçalho de DWG 2018 (AC1032) para o reconhecimento pelo conteúdo.
  const dwg = new Uint8Array(4096); dwg.set(new TextEncoder().encode("AC1032"), 0);
  const source = await upload("owner", "Planta Baixa.dwg", dwg, { extra: { projectId: "p-a" } });
  // "Cozinha — Área" em Windows-1252, como o LibreDWG grava planta brasileira.
  const dxf = Uint8Array.from([0x30, 0x0a, 0x53, 0x45, 0x43, 0x54, 0x49, 0x4f, 0x4e, 0x0a, 0xc1, 0x72, 0x65, 0x61]);
  let calls = 0;
  const realFetch = globalThis.fetch;
  h.runtime.DWG_CONVERTER_URL = "https://conversor.test/dwg";
  globalThis.fetch = async (url, init) => {
    calls += 1;
    assert.equal(String(url), "https://conversor.test/dwg");
    assert.equal(new Uint8Array(init.body).byteLength, 4096);
    return new Response(dxf, { status: 200 });
  };
  try {
    const first = await convert.POST(h.request("owner", `/api/arquivos/${source.id}/converter`, { method: "POST", json: { para: "dxf" } }), params({ fileId: source.id }));
    assert.equal(first.status, 201, await first.clone().text());
    const { file } = await first.json();
    assert.equal(file.name, "Planta Baixa.dxf");
    assert.equal(file.inLibrary, false, "cópia de visualização fica fora da biblioteca");
    assert.equal(file.projectId, "p-a");
    assert.deepEqual(await download("owner", file), dxf, "bytes do DXF intactos, acentos inclusive");

    const again = await convert.POST(h.request("owner", `/api/arquivos/${source.id}/converter`, { method: "POST", json: { para: "dxf", biblioteca: true } }), params({ fileId: source.id }));
    const reused = await again.json();
    assert.equal(reused.reused, true);
    assert.equal(reused.file.id, file.id);
    assert.equal(reused.file.inLibrary, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("DWG com conteúdo que não é DWG não é enviado ao conversor", async () => {
  const source = await upload("owner", "falso.dwg", new TextEncoder().encode("não sou um desenho"));
  const response = await convert.POST(h.request("owner", `/api/arquivos/${source.id}/converter`, { method: "POST", json: { para: "dxf" } }), params({ fileId: source.id }));
  assert.equal(response.status, 415);
});

test("a cópia de visualização some quando o DWG original é excluído", async () => {
  const dwg = new Uint8Array(64); dwg.set(new TextEncoder().encode("AC1027"), 0);
  const source = await upload("owner", "p.dwg", dwg);
  const realFetch = globalThis.fetch;
  h.runtime.DWG_CONVERTER_URL = "https://conversor.test/dwg";
  globalThis.fetch = async () => new Response("0\nSECTION\n", { status: 200 });
  try {
    await convert.POST(h.request("owner", `/api/arquivos/${source.id}/converter`, { method: "POST", json: { para: "dxf" } }), params({ fileId: source.id }));
  } finally { globalThis.fetch = realFetch; }
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM org_files").get().n, 2);
  await item.DELETE(h.request("owner", `/api/arquivos/${source.id}`, { method: "DELETE" }), params({ fileId: source.id }));
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM org_files").get().n, 0);
  assert.equal(h.objects.size, 0);
});
