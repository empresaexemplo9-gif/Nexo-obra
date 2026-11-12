import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
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

test("a planta e os números de exemplo são válidos pelas regras reais", () => {
  const planta = dados.plantaDeExemplo();
  assert.equal(prancheta.documentoSchema.safeParse(planta).success, true);
  assert.ok(planta.elementos.length > 30);
  assert.ok(prancheta.quantitativo(planta));
  const { custo, venda } = dados.totalDoOrcamento(dados.itensOrcamentoExemplo, 25);
  assert.equal(venda, Math.round(custo * 1.25));
  assert.ok(Number.isInteger(custo), "dinheiro em centavos inteiros");
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
  const permitidos = new Set(["components/visitante/demonstracao-app.tsx", "components/visitante/painel-exemplo.tsx"]);
  const importadores = [];
  for (const arquivo of [...await fontes("app"), ...await fontes("components"), ...await fontes("lib"), ...await fontes("db")]) {
    const caminho = relative(root, join(root, arquivo));
    if (caminho.startsWith("lib/demonstracao/")) continue;
    if (/lib\/demonstracao\/dados/.test(await readFile(join(root, arquivo), "utf8"))) importadores.push(caminho);
  }
  assert.deepEqual(importadores.sort(), [...permitidos].sort());
  for (const arquivo of await fontes("app/api")) {
    assert.doesNotMatch(await readFile(join(root, arquivo), "utf8"), /demonstracao|visitante\//, `${arquivo} não conhece a demonstração`);
  }
});

test("as telas da demonstração não chamam o servidor e os editores não gravam em modo de demonstração", async () => {
  for (const arquivo of ["components/visitante/demonstracao-app.tsx", "components/visitante/painel-exemplo.tsx", "components/visitante/home-visitante.tsx"]) {
    assert.doesNotMatch(await readFile(join(root, arquivo), "utf8"), /fetch\(|\/api\//, `${arquivo} não faz chamada de rede`);
  }
  const cad = await readFile(join(root, "components/prancheta-editor.tsx"), "utf8");
  const salvarCad = cad.slice(cad.indexOf("async function salvar()"), cad.indexOf("function baixar("));
  assert.ok(salvarCad.indexOf("demonstracao.aoGravar()") > 0 && salvarCad.indexOf("demonstracao.aoGravar()") < salvarCad.indexOf("fetch("), "o CAD sai antes do pedido de gravação");
  const importarCad = cad.slice(cad.indexOf("async function importar("), cad.indexOf("async function importar(") + 400);
  assert.match(importarCad, /if \(demonstracao\) \{[^}]*return; \}/);
  const layout = await readFile(join(root, "components/layout/layout-workspace.tsx"), "utf8");
  const salvarLayout = layout.slice(layout.indexOf("const salvar = useCallback"), layout.indexOf("const apagarSelecao"));
  assert.ok(salvarLayout.indexOf("demonstracao.aoSalvar()") > 0 && salvarLayout.indexOf("demonstracao.aoSalvar()") < salvarLayout.indexOf("pedir<"), "o layout sai antes do pedido de gravação");
  assert.match(layout, /if \(!canEdit \|\| demonstracao\) \{ saveBlob\(blob, arquivo\); return; \}/, "exportação da demonstração é baixada, não enviada");
});
