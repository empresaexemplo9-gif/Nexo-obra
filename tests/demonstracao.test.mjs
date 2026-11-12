import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

import { createHarness, params, root } from "./helpers/api-harness.mjs";

// Demonstração pública e pedido de reunião.
//
// Duas garantias: (1) o dado fictício fica confinado à rota /demonstracao e nenhuma
// ferramenta em modo de demonstração fala com o servidor; (2) o pedido de reunião, única
// escrita pública sem link assinado, valida, limita repetição e só o superadministrador lê.

const h = await createHarness();
const pedidos = await h.load("/app/api/reunioes/route.ts");
const lista = await h.load("/app/api/superadmin/reunioes/route.ts");
const item = await h.load("/app/api/superadmin/reunioes/[requestId]/route.ts");
const superadmin = await h.load("/lib/server/superadmin.ts");
const regras = await h.load("/lib/reunioes.ts");
const dados = await h.load("/lib/demonstracao/dados.ts");
const prancheta = await h.load("/lib/prancheta.ts");
const demo = await h.load("/lib/demonstracao/servidor.ts");
const capturado = JSON.parse(await readFile(join(root, "lib/demonstracao/respostas.json"), "utf8"));
after(() => h.close());

let cookie;
beforeEach(async () => {
  h.reset();
  Object.assign(h.runtime, { SUPERADMIN_EMAIL: "admin@example.test", SUPERADMIN_PASSWORD_HASH: "test-only", SUPERADMIN_SESSION_SECRET: "test-only-shared-secret-at-least-32-characters" });
  cookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
});

/** Próximo dia útil a pelo menos `dias` de hoje, no formato do formulário. */
function diaUtilEm(dias) {
  let dia = regras.hojeEmBrasilia(new Date(Date.now() + dias * 86_400_000));
  while (!regras.diaUtil(dia)) dia = regras.hojeEmBrasilia(new Date(new Date(`${dia}T12:00:00Z`).getTime() + 86_400_000));
  return dia;
}
const valido = (extra = {}) => ({
  name: "Pessoa Visitante", company: "Escritório Visitante", email: "Visitante@Example.test", phone: "(62) 99999-0000",
  teamSize: "2-5", preferredDay: diaUtilEm(3), preferredPeriod: "tarde", origin: "cad", ...extra,
});
const pedir = async (corpo, headers = {}) => {
  const resposta = await pedidos.POST(new Request("https://platform.test/api/reunioes", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers }, body: JSON.stringify(corpo),
  }));
  return { status: resposta.status, body: await resposta.json() };
};
const gravados = () => h.db.sqlite.prepare("SELECT * FROM meeting_requests ORDER BY created_at").all();

test("pedido válido é gravado uma vez, com e-mail normalizado e IP só em hash", async () => {
  const primeiro = await pedir(valido());
  assert.equal(primeiro.status, 201);
  assert.deepEqual(primeiro.body, { received: true });
  const [linha] = gravados();
  assert.equal(linha.email, "visitante@example.test");
  assert.equal(linha.origin, "cad");
  assert.equal(linha.status, "new");
  assert.doesNotMatch(JSON.stringify(linha), /203\.0\.113\.7/, "IP bruto não é guardado");
  // Duplo clique ou reenvio: mesma pessoa, mesmo dia e período não viram dois pedidos.
  assert.equal((await pedir(valido())).status, 200);
  assert.equal(gravados().length, 1);
});

test("recusa campo inválido, dia fora da agenda, corpo com campo a mais e origem de outro site", async () => {
  assert.equal((await pedir(valido({ email: "sem-arroba" }))).body.details.email.length, 1);
  assert.equal((await pedir(valido({ phone: "123" }))).status, 400);
  assert.equal((await pedir(valido({ teamSize: "mil" }))).status, 400);
  assert.match((await pedir(valido({ preferredDay: regras.hojeEmBrasilia() }))).body.details.preferredDay[0], /amanhã/);
  assert.match((await pedir(valido({ preferredDay: "2099-01-05" }))).body.details.preferredDay[0], /60 dias/);
  let fim = diaUtilEm(3);
  while (regras.diaUtil(fim)) fim = regras.hojeEmBrasilia(new Date(new Date(`${fim}T12:00:00Z`).getTime() + 86_400_000));
  assert.match((await pedir(valido({ preferredDay: fim }))).body.details.preferredDay[0], /segunda a sexta/);
  assert.equal((await pedir(valido({ status: "closed" }))).status, 400, "o visitante não escolhe o andamento");
  assert.equal((await pedir(valido({ organizationId: "x" }))).status, 400);
  assert.equal((await pedir(valido(), { origin: "https://outro.test" })).status, 403);
  assert.equal(gravados().length, 0);
});

test("campo-isca preenchido responde sucesso sem gravar; teto por IP devolve 429", async () => {
  const robo = await pedir(valido({ website: "https://spam.test" }));
  assert.equal(robo.status, 201);
  assert.equal(gravados().length, 0);
  for (let n = 0; n < 5; n += 1) assert.equal((await pedir(valido({ email: `p${n}@example.test` }))).status, 201);
  const sexto = await pedir(valido({ email: "p6@example.test" }));
  assert.equal(sexto.status, 429);
  assert.equal(sexto.body.code, "too_many_requests");
  assert.equal((await pedir(valido({ email: "outro@example.test" }), { "x-forwarded-for": "198.51.100.9" })).status, 201, "outro IP não paga pelo primeiro");
  assert.equal(gravados().length, 6);
});

test("só o superadministrador lê e muda o andamento dos pedidos", async () => {
  await pedir(valido({ message: "Queremos migrar 12 obras." }));
  const semSessao = await lista.GET(new Request("https://platform.test/api/superadmin/reunioes"));
  assert.ok([401, 403].includes(semSessao.status));
  const dono = await lista.GET(h.request("owner", "/api/superadmin/reunioes"));
  assert.ok([401, 403].includes(dono.status), "dono de empresa não lê contatos da plataforma");

  const resposta = await lista.GET(new Request("https://platform.test/api/superadmin/reunioes", { headers: { cookie } }));
  assert.equal(resposta.status, 200);
  const { requests } = await resposta.json();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].company, "Escritório Visitante");
  assert.equal(requests[0].message, "Queremos migrar 12 obras.");
  assert.equal(requests[0].ipHash, undefined, "hash de IP não sai na listagem");

  const mudar = (headers, status = "contacted", id = requests[0].id) => item.PATCH(new Request(`https://platform.test/api/superadmin/reunioes/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ status }),
  }), params({ requestId: id }));
  assert.ok([401, 403].includes((await mudar({})).status));
  assert.equal((await mudar({ cookie }, "inventado")).status, 400);
  assert.equal((await mudar({ cookie }, "contacted", "nao-existe")).status, 404);
  assert.equal((await mudar({ cookie })).status, 200);
  assert.equal(gravados()[0].status, "contacted");
});

test("pedido de proposta dispensa dia e período e fica separado do pedido de reunião", async () => {
  const proposta = await pedir({ ...valido({ kind: "proposal" }), preferredDay: undefined, preferredPeriod: undefined });
  assert.equal(proposta.status, 201);
  const [linha] = gravados();
  assert.equal(linha.kind, "proposal");
  assert.equal(linha.preferred_day, "", "proposta não tem data inventada");
  // Reunião sem dia continua recusada; e a mesma pessoa pode pedir as duas coisas.
  assert.equal((await pedir({ ...valido(), preferredDay: undefined })).body.details.preferredDay[0], "Escolha um dia.");
  assert.equal((await pedir(valido())).status, 201);
  assert.equal((await pedir(valido({ kind: "outro" }))).status, 400);
  const resposta = await lista.GET(new Request("https://platform.test/api/superadmin/reunioes", { headers: { cookie } }));
  assert.deepEqual((await resposta.json()).requests.map((item) => item.kind).sort(), ["meeting", "proposal"]);
});

// ── servidor da demonstração: roda no navegador; aqui, com um sessionStorage de teste ──
function navegadorDeTeste() {
  const guardado = new Map();
  globalThis.window = { sessionStorage: { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => { guardado.set(k, v); }, removeItem: (k) => { guardado.delete(k); } } };
  return guardado;
}

test("a demonstração responde no formato real e com datas trazidas para hoje", () => {
  navegadorDeTeste();
  const servidor = new demo.ServidorDemo();
  const sessao = servidor.responder("GET", "/api/session", null);
  assert.equal(sessao.status, 200);
  assert.equal(sessao.body.authenticated, true);
  assert.equal(sessao.body.organization.name, "Escritório Modelo Arquitetura");
  for (const [caminho, campo] of [["/api/clients", "clients"], ["/api/projects", "projects"], ["/api/tasks", "tasks"], ["/api/crm", "opportunities"], ["/api/budgets", "budgets"], ["/api/layouts", "layouts"], ["/api/studio", "pranchas"], ["/api/proposals", "proposals"]]) {
    const resposta = servidor.responder("GET", caminho, null);
    assert.equal(resposta.status, 200, caminho);
    assert.ok(resposta.body[campo].length > 0, `${caminho} traz dados de exemplo`);
    assert.deepEqual(Object.keys(resposta.body[campo][0]).sort(), Object.keys(capturado.respostas[caminho].body[campo][0]).sort(), `${caminho} mantém o formato da API`);
  }
  const hoje = new Date().toISOString().slice(0, 10);
  assert.equal(servidor.responder("GET", "/api/reminders", null).body.day.slice(0, 7), hoje.slice(0, 7), "o dia dos lembretes acompanha o calendário");
  const prancha = servidor.responder("GET", `/api/studio/${servidor.responder("GET", "/api/studio", null).body.pranchas[0].id}`, null).body.prancha;
  assert.equal(prancheta.documentoSchema.safeParse(prancha.documento).success, true);
  assert.ok(prancha.documento.elementos.length > 30, "a prancha de exemplo abre com desenho");
  assert.equal(servidor.responder("GET", "/api/nao-existe", null).status, 404);
});

test("edições do visitante valem só na aba e somem ao recomeçar", () => {
  const guardado = navegadorDeTeste();
  const servidor = new demo.ServidorDemo();
  const projeto = servidor.responder("GET", "/api/projects", null).body.projects[0];
  const antes = servidor.responder("GET", "/api/tasks", null).body.tasks.length;
  const criada = servidor.responder("POST", "/api/tasks", { projectId: projeto.id, title: "Tarefa criada no teste", priority: "high" });
  assert.equal(criada.status, 201);
  assert.equal(criada.body.task.projectName, projeto.name);
  assert.equal(servidor.responder("GET", "/api/tasks", null).body.tasks.length, antes + 1);
  const feita = servidor.responder("PATCH", `/api/tasks/${criada.body.task.id}`, { status: "done" });
  assert.ok(feita.body.task.completedAt);
  assert.equal(servidor.responder("POST", "/api/tasks", { title: "x" }).status, 400, "validação continua valendo");

  const negocio = servidor.responder("GET", "/api/crm", null).body.opportunities[0];
  const convertido = servidor.responder("POST", `/api/crm/${negocio.id}`, { code: "TST-01", kind: "work" });
  assert.equal(convertido.status, 201);
  assert.equal(convertido.body.opportunity.stage, "won");
  assert.ok(servidor.responder("GET", "/api/projects", null).body.projects.some((item) => item.id === convertido.body.projectId));

  // Outra página da mesma aba (central do projeto, prancha) enxerga a edição…
  const outraPagina = new demo.ServidorDemo();
  assert.equal(outraPagina.responder("GET", "/api/tasks", null).body.tasks.length, antes + 1);
  // …e recomeçar, ou fechar a aba, devolve os dados de exemplo.
  demo.ServidorDemo.recomecar();
  assert.equal(guardado.size, 0);
  assert.equal(new demo.ServidorDemo().responder("GET", "/api/tasks", null).body.tasks.length, antes);
});

test("o que não é emulado é recusado, nunca dado como feito", () => {
  navegadorDeTeste();
  const servidor = new demo.ServidorDemo();
  for (const [metodo, caminho] of [
    ["POST", "/api/integrations/drap/charges"], ["POST", "/api/integrations/drap/nfse"], ["POST", "/api/integrations/drap/lancamentos"],
    ["POST", "/api/organization-invitations"], ["POST", "/api/onboarding"], ["POST", "/api/auth/password"], ["POST", "/api/arquivos"], ["POST", "/api/proposals"],
  ]) {
    const resposta = servidor.responder(metodo, caminho, { qualquer: 1 });
    assert.equal(resposta.status, 403, `${metodo} ${caminho}`);
    assert.equal(resposta.body.code, "demonstracao");
    assert.equal(resposta.body.error, demo.RECUSA_DEMO);
  }
  assert.equal(servidor.responder("GET", "/api/integrations/drap/summary", null).body.source, "drap");
});

test("a planta de exemplo é válida pelas regras reais", () => {
  const planta = dados.plantaDeExemplo();
  assert.equal(prancheta.documentoSchema.safeParse(planta).success, true);
  assert.ok(prancheta.quantitativo(planta));
});

async function fontes(dir) {
  const saida = [];
  for (const entrada of await readdir(join(root, dir), { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) saida.push(...await fontes(caminho));
    else if (/\.(ts|tsx)$/.test(entrada.name)) saida.push(caminho);
  }
  return saida;
}

test("dado fictício fica confinado à demonstração e não chega a API nem a tela de empresa", async () => {
  const importadores = [];
  for (const arquivo of [...await fontes("app"), ...await fontes("components"), ...await fontes("lib"), ...await fontes("db")]) {
    if (arquivo.startsWith("lib/demonstracao/")) continue;
    if (/lib\/demonstracao\//.test(await readFile(join(root, arquivo), "utf8"))) importadores.push(arquivo);
  }
  assert.deepEqual(importadores, ["components/visitante/demonstracao-app.tsx"], "só a moldura da demonstração usa os dados fictícios");
  for (const arquivo of await fontes("app/api")) {
    assert.doesNotMatch(await readFile(join(root, arquivo), "utf8"), /demonstracao|visitante\//, `${arquivo} não conhece a demonstração`);
  }
  // A moldura só existe nas rotas /demonstracao: nenhuma outra página a monta.
  for (const arquivo of await fontes("app")) {
    if (arquivo.startsWith("app/demonstracao/")) continue;
    assert.doesNotMatch(await readFile(join(root, arquivo), "utf8"), /demonstracao-app/, `${arquivo} não monta a demonstração`);
  }
});

test("dentro da demonstração só o pedido de reunião ou proposta chega ao servidor de verdade", async () => {
  const moldura = await readFile(join(root, "components/visitante/demonstracao-app.tsx"), "utf8");
  assert.match(moldura, /const REAIS = \["\/api\/reunioes"\];/);
  assert.match(moldura, /window\.fetch = original/, "sair da demonstração devolve o fetch do navegador");
});
