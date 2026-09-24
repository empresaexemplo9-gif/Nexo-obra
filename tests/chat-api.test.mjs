import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB, params, permissions } from "./helpers/api-harness.mjs";

const h = await createHarness();
const conversas = await h.load("/app/api/conversas/route.ts");
const diretas = await h.load("/app/api/conversas/diretas/route.ts");
const canal = await h.load("/app/api/conversas/[channelId]/route.ts");
const mensagens = await h.load("/app/api/conversas/[channelId]/mensagens/route.ts");
const mensagem = await h.load("/app/api/conversas/mensagens/[messageId]/route.ts");
const lembrete = await h.load("/app/api/conversas/lembretes/[reminderId]/route.ts");
const arquivos = await h.load("/app/api/arquivos/route.ts");
const parte = await h.load("/app/api/arquivos/[fileId]/partes/[index]/route.ts");
const concluir = await h.load("/app/api/arquivos/[fileId]/concluir/route.ts");
const agenda = await h.load("/app/api/reminders/route.ts");

let colab, terceiro;
beforeEach(() => {
  h.reset();
  // Colaborador sem acesso à Prancheta: conversar não depende de módulo.
  colab = h.member("colab", orgA, "Carla Colab", "member", permissions({ overview: { view: true, edit: false } }, false));
  terceiro = h.member("terceiro", orgA, "Téo Terceiro", "member", permissions({}, false));
});
after(() => h.close());

const json = async (response) => ({ status: response.status, body: response.status === 204 ? null : await response.json() });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function list(user, org = orgA) { return json(await conversas.GET(h.request(user, "/api/conversas", { org }))); }
async function geral(user = "owner") { return (await list(user)).body.conversations.find((item) => item.name === "Geral").id; }
async function send(user, channelId, payload, org = orgA) {
  return json(await mensagens.POST(h.request(user, `/api/conversas/${channelId}/mensagens`, { method: "POST", json: { clientKey: crypto.randomUUID(), ...payload }, org }), params({ channelId })));
}
async function read(user, channelId, query = "", org = orgA) {
  return json(await mensagens.GET(h.request(user, `/api/conversas/${channelId}/mensagens${query}`, { org }), params({ channelId })));
}
async function direct(user, memberId, org = orgA) {
  return json(await diretas.POST(h.request(user, "/api/conversas/diretas", { method: "POST", json: { memberId }, org })));
}
async function uploadFor(user, name, bytes, area = "conversa") {
  const created = await (await arquivos.POST(h.request(user, "/api/arquivos", { method: "POST", json: { name, sizeBytes: bytes.byteLength, area } }))).json();
  const id = created.upload.id;
  await parte.PUT(h.request(user, `/api/arquivos/${id}/partes/0`, { method: "PUT", body: bytes }), params({ fileId: id, index: "0" }));
  return (await (await concluir.POST(h.request(user, `/api/arquivos/${id}/concluir`, { method: "POST", json: { area } }), params({ fileId: id }))).json()).file;
}
async function fetchPart(user, fileId, org = orgA) {
  return parte.GET(h.request(user, `/api/arquivos/${fileId}/partes/0`, { org }), params({ fileId, index: "0" }));
}

test("a empresa já nasce com o canal Geral e a mensagem conta como não lida para os outros", async () => {
  const channelId = await geral();
  const sent = await send("owner", channelId, { body: "Bom dia, equipe. Medição da Casa Alfa na sexta." });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.authorName, "Ana Dona");

  const before = await list("colab");
  assert.equal(before.body.unreadTotal, 1);
  assert.match(before.body.conversations[0].lastPreview, /Ana Dona: Bom dia/);
  const opened = await read("colab", channelId);
  assert.equal(opened.body.messages.length, 1);
  assert.equal(opened.body.messages[0].mine, false);
  assert.equal((await list("colab")).body.unreadTotal, 0);
  assert.equal((await list("owner")).body.unreadTotal, 0, "a própria mensagem não conta como não lida");
});

test("conversa direta é visível só aos dois participantes", async () => {
  const opened = await direct("owner", colab);
  assert.equal(opened.status, 200);
  const again = await direct("colab", "owner@" + orgA);
  assert.equal(again.body.channelId, opened.body.channelId, "a mesma dupla reaproveita a conversa");
  await send("owner", opened.body.channelId, { body: "Consegue revisar o quadro de cargas?" });

  const colabView = await list("colab");
  const conversation = colabView.body.conversations.find((item) => item.kind === "direta");
  assert.equal(conversation.name, "Ana Dona");
  assert.equal(conversation.unread, 1);

  assert.equal((await list("terceiro")).body.conversations.some((item) => item.kind === "direta"), false);
  assert.equal((await read("terceiro", opened.body.channelId)).status, 404);
  assert.equal((await send("terceiro", opened.body.channelId, { body: "oi" })).status, 404);
});

test("outra empresa não lê canal, não abre conversa e não vê membros daqui", async () => {
  const channelId = await geral();
  await send("owner", channelId, { body: "Interno" });
  assert.equal((await read("owner-b", channelId, "", orgB)).status, 404);
  assert.equal((await send("owner-b", channelId, { body: "invasão" }, orgB)).status, 404);
  assert.equal((await direct("owner-b", colab, orgB)).status, 404);
  const listB = await list("owner-b", orgB);
  assert.deepEqual(listB.body.conversations.map((item) => item.name), ["Geral"]);
  assert.equal(listB.body.members.length, 0);
});

test("anexo vai no formato original e só quem está na conversa baixa", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7 memorial descritivo");
  const file = await uploadFor("colab", "Memorial Descritivo.pdf", bytes);
  // Antes de enviar, só quem subiu enxerga o anexo.
  assert.equal((await fetchPart("owner", file.id)).status, 404);

  const opened = await direct("colab", "owner@" + orgA);
  const sent = await send("colab", opened.body.channelId, { body: "Segue o memorial.", fileIds: [file.id] });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.files[0].name, "Memorial Descritivo.pdf");
  assert.equal(sent.body.message.files[0].mimeType, "application/pdf");

  const got = await fetchPart("owner", file.id);
  assert.equal(got.status, 200);
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), bytes);
  assert.equal((await fetchPart("terceiro", file.id)).status, 404);
  assert.equal((await fetchPart("owner-b", file.id, orgB)).status, 404);
});

test("anexar arquivo alheio que não foi compartilhado é recusado", async () => {
  const file = await uploadFor("colab", "rascunho.dwg", new Uint8Array([1, 2, 3]));
  const channelId = await geral();
  const sent = await send("terceiro", channelId, { body: "peguei", fileIds: [file.id] });
  assert.equal(sent.status, 404);
});

test("arquivo da Prancheta compartilhado numa conversa abre para quem não tem a Prancheta", async () => {
  const file = await uploadFor("owner", "Planta Elétrica.dxf", new TextEncoder().encode("0\nSECTION\n"), "prancheta");
  assert.equal((await fetchPart("colab", file.id)).status, 404);
  const opened = await direct("owner", colab);
  await send("owner", opened.body.channelId, { body: "Planta para conferência", fileIds: [file.id] });
  assert.equal((await fetchPart("colab", file.id)).status, 200);
  assert.equal((await fetchPart("terceiro", file.id)).status, 404);
});

test("reenviar com a mesma chave não duplica a mensagem", async () => {
  const channelId = await geral();
  const clientKey = crypto.randomUUID();
  const first = await send("owner", channelId, { clientKey, body: "Concreto chega às 7h." });
  const second = await send("owner", channelId, { clientKey, body: "Concreto chega às 7h." });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.message.id, first.body.message.id);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM chat_messages").get().n, 1);
});

test("mensagem vazia e mensagem longa demais são recusadas", async () => {
  const channelId = await geral();
  assert.equal((await send("owner", channelId, { body: "   " })).status, 400);
  assert.equal((await send("owner", channelId, { body: "x".repeat(4001) })).status, 400);
});

test("lembrete para uma pessoa entra nos Lembretes do dia dela e sai ao concluir", async () => {
  const channelId = await geral();
  const sent = await send("owner", channelId, { reminder: { text: "Enviar ART do projeto elétrico", dueDay: today(), targetMemberId: colab } });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.kind, "lembrete");
  assert.equal(sent.body.message.reminder.targetName, "Carla Colab");

  const colabAgenda = await (await agenda.GET(h.request("colab", "/api/reminders"))).json();
  const item = colabAgenda.reminders.find((entry) => entry.group === "recado");
  assert.equal(item.title, "Enviar ART do projeto elétrico");
  assert.equal(item.severity, "hoje");
  const terceiroAgenda = await (await agenda.GET(h.request("terceiro", "/api/reminders"))).json();
  assert.equal(terceiroAgenda.reminders.some((entry) => entry.group === "recado"), false);

  const reminderId = sent.body.message.reminder.id;
  const denied = await lembrete.PATCH(h.request("terceiro", `/api/conversas/lembretes/${reminderId}`, { method: "PATCH", json: { done: true } }), params({ reminderId }));
  assert.equal(denied.status, 403);
  const doneResponse = await lembrete.PATCH(h.request("colab", `/api/conversas/lembretes/${reminderId}`, { method: "PATCH", json: { done: true } }), params({ reminderId }));
  assert.equal(doneResponse.status, 204);
  const after = await (await agenda.GET(h.request("colab", "/api/reminders"))).json();
  assert.equal(after.reminders.some((entry) => entry.group === "recado"), false);
});

test("lembrete em conversa direta só pode ser para quem participa dela", async () => {
  const opened = await direct("owner", colab);
  const sent = await send("owner", opened.body.channelId, { reminder: { text: "Ligar para o cliente", dueDay: today(), targetMemberId: terceiro } });
  assert.equal(sent.status, 400);
});

test("atualização por cursor traz edição e exclusão; só o autor edita", async () => {
  const channelId = await geral();
  const first = await read("colab", channelId);
  const sent = await send("owner", channelId, { body: "Reunião às 10h" });
  const messageId = sent.body.message.id;
  const denied = await mensagem.PATCH(h.request("colab", `/api/conversas/mensagens/${messageId}`, { method: "PATCH", json: { body: "hackeado" } }), params({ messageId }));
  assert.equal(denied.status, 403);
  const edited = await mensagem.PATCH(h.request("owner", `/api/conversas/mensagens/${messageId}`, { method: "PATCH", json: { body: "Reunião às 11h" } }), params({ messageId }));
  assert.equal(edited.status, 204);

  const update = await read("colab", channelId, `?since=${encodeURIComponent(first.body.cursor)}`);
  const changed = update.body.messages.find((message) => message.id === messageId);
  assert.equal(changed.body, "Reunião às 11h");
  assert.ok(changed.editedAt);
});

test("apagar a mensagem apaga o anexo enviado só nela; o da biblioteca continua", async () => {
  const channelId = await geral();
  const onlyChat = await uploadFor("owner", "foto-obra.jpg", new Uint8Array([0xff, 0xd8, 0xff, 1]));
  const library = await uploadFor("owner", "planta.pdf", new Uint8Array([0x25, 0x50]), "prancheta");
  const sent = await send("owner", channelId, { body: "Fotos e planta", fileIds: [onlyChat.id, library.id] });
  assert.equal(h.objects.size, 2);

  const messageId = sent.body.message.id;
  const denied = await mensagem.DELETE(h.request("colab", `/api/conversas/mensagens/${messageId}`, { method: "DELETE" }), params({ messageId }));
  assert.equal(denied.status, 403);
  const removed = await mensagem.DELETE(h.request("owner", `/api/conversas/mensagens/${messageId}`, { method: "DELETE" }), params({ messageId }));
  assert.equal(removed.status, 204);
  assert.equal(h.objects.size, 1, "o anexo exclusivo da conversa foi apagado do armazenamento");
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM org_files WHERE id = ?").get(library.id).n, 1);
  const page = await read("colab", channelId);
  assert.equal(page.body.messages[0].deleted, true);
  assert.equal(page.body.messages[0].body, "");
  assert.deepEqual(page.body.messages[0].files, []);
});

test("canal criado por alguém só é excluído por quem criou ou pela administração; Geral é protegido", async () => {
  const created = await json(await conversas.POST(h.request("colab", "/api/conversas", { method: "POST", json: { name: "Obra Casa Alfa" } })));
  assert.equal(created.status, 201);
  const duplicate = await json(await conversas.POST(h.request("owner", "/api/conversas", { method: "POST", json: { name: "obra casa alfa" } })));
  assert.equal(duplicate.status, 409);
  const channelId = created.body.channelId;
  const denied = await canal.DELETE(h.request("terceiro", `/api/conversas/${channelId}`, { method: "DELETE" }), params({ channelId }));
  assert.equal(denied.status, 403);
  const byOwner = await canal.DELETE(h.request("owner", `/api/conversas/${channelId}`, { method: "DELETE" }), params({ channelId }));
  assert.equal(byOwner.status, 204);
  const general = await geral();
  const protectedResponse = await canal.DELETE(h.request("owner", `/api/conversas/${general}`, { method: "DELETE" }), params({ channelId: general }));
  assert.equal(protectedResponse.status, 400);
});

test("anexo que subiu e não foi enviado pode ser descartado por quem subiu; o enviado fica", async () => {
  const arquivoItem = await h.load("/app/api/arquivos/[fileId]/route.ts");
  const solto = await uploadFor("colab", "rascunho.pdf", new Uint8Array([1, 2]));
  const enviado = await uploadFor("colab", "final.pdf", new Uint8Array([3, 4]));
  await send("colab", await geral("colab"), { body: "final", fileIds: [enviado.id] });
  const alheio = await arquivoItem.DELETE(h.request("terceiro", `/api/arquivos/${solto.id}`, { method: "DELETE" }), params({ fileId: solto.id }));
  assert.notEqual(alheio.status, 204);
  for (const file of [solto, enviado]) {
    const response = await arquivoItem.DELETE(h.request("colab", `/api/arquivos/${file.id}`, { method: "DELETE" }), params({ fileId: file.id }));
    assert.equal(response.status, 204);
  }
  const restantes = h.db.sqlite.prepare("SELECT name FROM org_files").all().map((row) => row.name);
  assert.deepEqual(restantes, ["final.pdf"]);
});
