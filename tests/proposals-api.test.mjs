import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB, params, permissions } from "./helpers/api-harness.mjs";

const h = await createHarness();
const lista = await h.load("/app/api/proposals/route.ts");
const item = await h.load("/app/api/proposals/[proposalId]/route.ts");
const envio = await h.load("/app/api/proposals/[proposalId]/send/route.ts");
const agenda = await h.load("/app/api/proposals/[proposalId]/schedule/route.ts");
const abertura = await h.load("/app/api/proposta/[token]/view/route.ts");
const aceite = await h.load("/app/api/proposta/[token]/accept/route.ts");
const lembretes = await h.load("/app/api/reminders/route.ts");
const servidor = await h.load("/lib/server/proposals.ts");
const regras = await h.load("/lib/proposals.ts");
after(() => h.close());

beforeEach(() => {
  h.reset();
  h.runtime.SESSION_SECRET = "segredo-de-sessao-com-mais-de-32-caracteres";
  const db = h.db.sqlite;
  db.prepare("INSERT INTO clients(id,organization_id,name,email,phone,created_at,updated_at) VALUES ('cli-a',?,'Marina Costa','marina@example.test','(62) 99999-0000',0,0)").run(orgA);
  db.prepare("UPDATE projects SET client_id = 'cli-a' WHERE id = 'p-a'").run();
  db.prepare("INSERT INTO budget_versions(id,organization_id,project_id,code,version,status,total_cents,created_at,updated_at) VALUES ('orc-a',?,'p-a','ORC-1',1,'draft',0,0,0)").run(orgA);
  db.prepare("INSERT INTO budget_items(id,budget_version_id,sort_order,description,unit,quantity,unit_cost_cents,unit_price_cents) VALUES ('i1','orc-a',0,'Projeto executivo','vb',1,100000,250000)").run();
  db.prepare("INSERT INTO budget_items(id,budget_version_id,sort_order,description,unit,quantity,unit_cost_cents,unit_price_cents) VALUES ('i2','orc-a',1,'Acompanhamento de obra','visita',4,20000,45000)").run();
});

const json = async (response) => ({ status: response.status, body: await response.json() });
const criar = async (corpo, user = "owner", org = orgA) => json(await lista.POST(h.request(user, "/api/proposals", { method: "POST", json: corpo, org })));
const enviar = async (id, channel = "whatsapp") => json(await envio.POST(h.request("owner", `/api/proposals/${id}/send`, { method: "POST", json: { channel } }), params({ proposalId: id })));
const anonimo = (path, corpo) => new Request(`https://platform.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
const tokenDe = (link) => link.split("/proposta/")[1];

test("cria a partir do orçamento com itens, cliente do projeto e numeração própria", async () => {
  const { status, body } = await criar({ title: "Projeto Casa Alfa", budgetVersionId: "orc-a" });
  assert.equal(status, 201);
  const proposta = body.proposal;
  assert.equal(proposta.code, "PROP-0001");
  assert.equal(proposta.status, "draft");
  assert.equal(proposta.recipientName, "Marina Costa");
  assert.equal(proposta.recipientPhone, "(62) 99999-0000");
  assert.equal(proposta.content.items.length, 2);
  assert.equal(proposta.totalCents, 250000 + 4 * 45000);
  assert.equal(proposta.link, null, "rascunho não tem link no ar");
  assert.equal((await criar({ title: "Outra" })).body.proposal.code, "PROP-0002");
});

test("outra empresa não lê e quem só vê orçamento não cria nem edita", async () => {
  const { body } = await criar({ title: "Projeto Casa Alfa", budgetVersionId: "orc-a" });
  const id = body.proposal.id;
  const deB = await item.GET(h.request("owner-b", `/api/proposals/${id}`, { org: orgB }), params({ proposalId: id }));
  assert.equal(deB.status, 404);
  assert.equal((await criar({ title: "Invasão", budgetVersionId: "orc-a" }, "owner-b", orgB)).status, 404, "orçamento de outra empresa não serve de origem");

  h.member("leitor", orgA, "Leitor", "member", permissions({ budgets: { view: true, edit: false } }));
  assert.equal((await criar({ title: "Sem permissão" }, "leitor")).status, 403);
  const edicao = await item.PATCH(h.request("leitor", `/api/proposals/${id}`, { method: "PATCH", json: { title: "Mudei" } }), params({ proposalId: id }));
  assert.equal(edicao.status, 403);
  assert.equal((await item.GET(h.request("leitor", `/api/proposals/${id}`), params({ proposalId: id }))).status, 200);
});

test("o total é sempre do servidor e qualquer parte do texto é editável", async () => {
  const { body } = await criar({ title: "Projeto Casa Alfa", budgetVersionId: "orc-a" });
  const content = { ...body.proposal.content, heading: "Proposta de arquitetura", discountCents: 30000,
    items: [{ id: "x", description: "Projeto legal", unit: "vb", quantity: 2, unitPriceCents: 100000 }],
    sectionsAfter: [{ id: "s", title: "Prazo", body: "45 dias." }] };
  const resposta = await item.PATCH(h.request("owner", `/api/proposals/${body.proposal.id}`, { method: "PATCH", json: { content, totalCents: 1 } }), params({ proposalId: body.proposal.id }));
  assert.equal(resposta.status, 400, "total vindo do navegador é recusado");
  const ok = await json(await item.PATCH(h.request("owner", `/api/proposals/${body.proposal.id}`, { method: "PATCH", json: { content, validityDays: 30 } }), params({ proposalId: body.proposal.id })));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.proposal.totalCents, 200000 - 30000);
  assert.equal(ok.body.proposal.content.heading, "Proposta de arquitetura");
  assert.equal(ok.body.proposal.validityDays, 30);
});

test("enviar data a proposta, põe o link no ar e o link adulterado não abre nada", async () => {
  const vazia = await criar({ title: "Sem itens" });
  assert.equal((await enviar(vazia.body.proposal.id)).status, 409, "proposta sem item não sai");

  const { body } = await criar({ title: "Projeto Casa Alfa", budgetVersionId: "orc-a" });
  const antes = Date.now();
  const enviada = await enviar(body.proposal.id);
  assert.equal(enviada.status, 200);
  assert.equal(enviada.body.proposal.status, "sent");
  assert.ok(enviada.body.proposal.issuedAt >= antes, "data e hora automáticas no envio");
  assert.equal(enviada.body.proposal.sentChannel, "whatsapp");
  const token = tokenDe(enviada.body.proposal.link);
  assert.ok(await servidor.loadProposalByToken(h.db, token));

  const adulterado = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.equal(await servidor.loadProposalByToken(h.db, adulterado), null);
  const reenvio = await enviar(body.proposal.id, "email");
  assert.equal(reenvio.body.proposal.issuedAt, enviada.body.proposal.issuedAt, "reenviar não muda a emissão");
});

test("abertura pelo cliente avisa a equipe; a própria equipe e recarregar não contam", async () => {
  const { body } = await criar({ title: "Projeto Casa Alfa", budgetVersionId: "orc-a" });
  const link = (await enviar(body.proposal.id)).body.proposal.link;
  const token = tokenDe(link);

  const daEquipe = await json(await abertura.POST(h.request("owner", `/api/proposta/${token}/view`, { method: "POST" }), params({ token })));
  assert.equal(daEquipe.body.recorded, false);
  assert.equal((await json(await abertura.POST(anonimo(`/api/proposta/${token}/view`), params({ token })))).body.recorded, true);
  assert.equal((await json(await abertura.POST(anonimo(`/api/proposta/${token}/view`), params({ token })))).body.recorded, false, "recarregar em seguida não soma");
  const linha = h.db.sqlite.prepare("SELECT view_count, first_viewed_at FROM proposals WHERE id = ?").get(body.proposal.id);
  assert.equal(linha.view_count, 1);
  assert.ok(linha.first_viewed_at);

  const agenda = await (await lembretes.GET(h.request("owner", "/api/reminders"))).json();
  assert.ok(agenda.reminders.some((lembrete) => lembrete.key === `proposta-aberta:${body.proposal.id}`));
  const detalhe = await json(await item.GET(h.request("owner", `/api/proposals/${body.proposal.id}`), params({ proposalId: body.proposal.id })));
  assert.equal(detalhe.body.proposal.unseenNotice, true);
  const depois = await (await lembretes.GET(h.request("owner", "/api/reminders"))).json();
  assert.equal(depois.reminders.some((lembrete) => lembrete.group === "proposta"), false, "abrir a proposta dá o aviso por visto");
});

test("aceite do cliente guarda a versão lida, trava a edição e avisa", async () => {
  const { body } = await criar({ title: "Projeto Casa Alfa", budgetVersionId: "orc-a" });
  const id = body.proposal.id;
  const token = tokenDe((await enviar(id)).body.proposal.link);
  const versao = h.db.sqlite.prepare("SELECT updated_at FROM proposals WHERE id = ?").get(id).updated_at;

  const semConcordar = await aceite.POST(anonimo(`/api/proposta/${token}/accept`, { name: "Marina Costa", agree: false, version: versao }), params({ token }));
  assert.equal(semConcordar.status, 400);
  const versaoVelha = await json(await aceite.POST(anonimo(`/api/proposta/${token}/accept`, { name: "Marina Costa", agree: true, version: versao - 1 }), params({ token })));
  assert.equal(versaoVelha.status, 409, "não aceita versão que o cliente não leu");

  const aceita = await json(await aceite.POST(anonimo(`/api/proposta/${token}/accept`, { name: "Marina Costa", document: "123.456.789-00", agree: true, version: versao }), params({ token })));
  assert.equal(aceita.status, 200);
  const linha = h.db.sqlite.prepare("SELECT status, accepted_name, accepted_document, accepted_snapshot_json, accepted_ip_hash FROM proposals WHERE id = ?").get(id);
  assert.equal(linha.status, "accepted");
  assert.equal(linha.accepted_document, "123.456.789-00");
  assert.equal(JSON.parse(linha.accepted_snapshot_json).totalCents, 250000 + 4 * 45000);
  assert.ok(linha.accepted_ip_hash);

  const segunda = await aceite.POST(anonimo(`/api/proposta/${token}/accept`, { name: "Outra pessoa", agree: true, version: versao }), params({ token }));
  assert.equal(segunda.status, 409);
  const edicao = await item.PATCH(h.request("owner", `/api/proposals/${id}`, { method: "PATCH", json: { title: "Mudei" } }), params({ proposalId: id }));
  assert.equal(edicao.status, 409, "aceita fica travada");
  const agendaAceita = await (await lembretes.GET(h.request("owner", "/api/reminders"))).json();
  assert.ok(agendaAceita.reminders.some((lembrete) => lembrete.key === `proposta-aceita:${id}`));
});

test("proposta vencida não aceita e cancelada sai do ar", async () => {
  const { body } = await criar({ title: "Projeto Casa Alfa", budgetVersionId: "orc-a" });
  const id = body.proposal.id;
  const token = tokenDe((await enviar(id)).body.proposal.link);
  h.db.sqlite.prepare("UPDATE proposals SET issued_at = ?, validity_days = 1 WHERE id = ?").run(Date.now() - 3 * 86_400_000, id);
  const versao = h.db.sqlite.prepare("SELECT updated_at FROM proposals WHERE id = ?").get(id).updated_at;
  const vencida = await aceite.POST(anonimo(`/api/proposta/${token}/accept`, { name: "Marina Costa", agree: true, version: versao }), params({ token }));
  assert.equal(vencida.status, 410);

  await item.DELETE(h.request("owner", `/api/proposals/${id}`, { method: "DELETE" }), params({ proposalId: id }));
  assert.equal(await servidor.loadProposalByToken(h.db, token), null);
});

test("agendar deixa o link fora do ar e avisa na hora de enviar", async () => {
  const { body } = await criar({ title: "Projeto Casa Alfa", budgetVersionId: "orc-a" });
  const id = body.proposal.id;
  const agendar = (at, channel = "whatsapp") => agenda.POST(h.request("owner", `/api/proposals/${id}/schedule`, { method: "POST", json: { channel, at } }), params({ proposalId: id }));
  assert.equal((await agendar(new Date(Date.now() - 60_000).toISOString())).status, 400, "horário passado é recusado");
  const futuro = await json(await agendar(new Date(Date.now() + 3 * 3_600_000).toISOString()));
  assert.equal(futuro.status, 200);
  assert.equal(futuro.body.proposal.status, "scheduled");
  assert.equal(futuro.body.proposal.link, null);

  h.db.sqlite.prepare("UPDATE proposals SET scheduled_at = ? WHERE id = ?").run(Date.now() - 60_000, id);
  const agendaDoDia = await (await lembretes.GET(h.request("owner", "/api/reminders"))).json();
  const lembrete = agendaDoDia.reminders.find((linha) => linha.key === `proposta-envio:${id}`);
  assert.ok(lembrete);
  assert.match(lembrete.title, /Hora de enviar/);

  const enviada = await enviar(id);
  assert.equal(enviada.body.proposal.status, "sent");
  assert.equal(enviada.body.proposal.scheduledAt, null);
});

test("número de WhatsApp, links de envio e total com desconto", () => {
  assert.equal(regras.whatsappNumber("(62) 99999-0000"), "5562999990000");
  assert.equal(regras.whatsappNumber("+55 62 3333-4444"), "556233334444");
  assert.equal(regras.whatsappNumber("123"), null);
  assert.match(regras.whatsappUrl("(62) 99999-0000", "Olá", "https://x.test/proposta/t"), /^https:\/\/wa\.me\/5562999990000\?text=Ol%C3%A1/);
  assert.match(regras.emailUrl("a@b.test", "Proposta", "Olá", "https://x.test/p"), /^mailto:a%40b\.test\?subject=Proposta&body=/);
  const totais = regras.proposalTotals({ items: [{ quantity: 1.5, unitPriceCents: 1001 }], discountCents: 99_999 });
  assert.deepEqual(totais, { subtotalCents: 1502, discountCents: 1502, totalCents: 0 });
});

test("lembretes continuam funcionando antes da migração das propostas", async () => {
  h.db.sqlite.exec("DROP TABLE proposals");
  const resposta = await lembretes.GET(h.request("owner", "/api/reminders"));
  assert.equal(resposta.status, 200);
});
