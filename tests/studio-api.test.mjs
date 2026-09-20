// Prancheta: o que a API precisa garantir antes de ser um lugar onde alguém guarda
// trabalho — a empresa da sessão manda, a permissão do módulo manda, e duas abas abertas
// não se sobrescrevem em silêncio.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformEnvOverride = runtime;
runtime.TRUST_IDENTITY_HEADERS = "true";
runtime.MEDIA_ENCRYPTION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const indice = await vite.ssrLoadModule("/app/api/studio/route.ts");
const prancha = await vite.ssrLoadModule("/app/api/studio/[drawingId]/route.ts");
const biblioteca = await vite.ssrLoadModule("/app/api/studio/assets/route.ts");
const item = await vite.ssrLoadModule("/app/api/studio/assets/[assetId]/route.ts");
const importacao = await vite.ssrLoadModule("/app/api/studio/importar/route.ts");
const { CURRENT_TERMS_VERSION } = await vite.ssrLoadModule("/lib/terms.ts");
const { documentoVazio } = await vite.ssrLoadModule("/lib/prancheta.ts");
const migracoes = await Promise.all((await readdir(`${root}/drizzle`)).filter((arquivo) => arquivo.endsWith(".sql")).sort()
  .map((arquivo) => readFile(`${root}/drizzle/${arquivo}`, "utf8")));

class D1Local {
  sqlite = new DatabaseSync(":memory:");
  prepare(sql) {
    const sqlite = this.sqlite;
    return new (class {
      args = [];
      bind(...args) { this.args = args; return this; }
      execute() {
        const statement = sqlite.prepare(sql);
        const bindings = Object.fromEntries(this.args.map((valor, i) => [i + 1, valor]));
        const results = statement.all(bindings);
        return { success: true, results, meta: { changes: sqlite.prepare("SELECT changes() AS n").get().n } };
      }
      async all() { return this.execute(); }
      async run() { return this.execute(); }
      async first() { return this.execute().results[0] ?? null; }
    })();
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const resultado = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return resultado;
    } catch (erro) { this.sqlite.exec("ROLLBACK"); throw erro; }
  }
}

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const projetoA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projetoB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const pessoas = {
  dono: { id: "dono-a", email: "dono-a@exemplo.test", org: orgA, role: "owner", permissoes: "{}" },
  outro: { id: "dono-b", email: "dono-b@exemplo.test", org: orgB, role: "owner", permissoes: "{}" },
  leitor: { id: "leitor-a", email: "leitor@exemplo.test", org: orgA, role: "member", permissoes: JSON.stringify({ studio: { view: true, edit: false } }) },
  // Conta de colaborador com permissões já ajustadas à mão e sem a prancheta entre elas:
  // um módulo novo não pode se abrir sozinho para quem já teve o acesso recortado.
  negado: { id: "negado-a", email: "negado@exemplo.test", org: orgA, role: "member", permissoes: JSON.stringify({ overview: { view: true, edit: false } }) },
  desenhista: { id: "desenhista-a", email: "desenhista@exemplo.test", org: orgA, role: "member", permissoes: JSON.stringify({ studio: { view: true, edit: true } }) },
};

let db;
let bytes;
beforeEach(() => {
  db?.sqlite.close();
  db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migracao of migracoes) db.sqlite.exec(migracao);
  for (const [id, nome] of [[orgA, "Empresa A"], [orgB, "Empresa B"]]) {
    db.sqlite.prepare("INSERT INTO organizations(id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 0, 0)").run(id, nome, id);
  }
  for (const pessoa of Object.values(pessoas)) {
    db.sqlite.prepare("INSERT INTO users(id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, 0, 0)").run(pessoa.id, pessoa.email, pessoa.id);
    db.sqlite.prepare("INSERT INTO members(id, organization_id, external_user_id, name, email, role, permissions_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(pessoa.id, pessoa.org, pessoa.id, pessoa.id, pessoa.email, pessoa.role, pessoa.permissoes);
    db.sqlite.prepare("INSERT INTO terms_acceptances(id, organization_id, external_user_id, email, terms_version, ip_hash, user_agent_hash, accepted_at) VALUES (?, ?, ?, ?, ?, '', '', 1)")
      .run(pessoa.id, pessoa.org, pessoa.id, pessoa.email, CURRENT_TERMS_VERSION);
  }
  for (const [id, org, nome] of [[projetoA, orgA, "Obra A"], [projetoB, orgB, "Obra B"]]) {
    db.sqlite.prepare("INSERT INTO projects(id, organization_id, code, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, 'work', 0, 0)").run(id, org, nome, nome);
  }
  bytes = new Map();
  runtime.DB = db;
  runtime.FILES = {
    async put(caminho, valor) { bytes.set(caminho, valor); return caminho; },
    async get(chave) { return bytes.has(chave) ? { body: new Response(bytes.get(chave)).body } : null; },
    async delete(chave) { bytes.delete(chave); },
  };
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

function pedido(caminho = "/api/studio", { user = "dono", method = "GET", json, body, headers = {} } = {}) {
  const identidade = user ? pessoas[user] : null;
  return new Request(`https://prancheta.test${caminho}`, {
    method,
    headers: {
      ...(identidade ? { "oai-authenticated-user-id": identidade.id, "oai-authenticated-user-email": identidade.email } : {}),
      ...(json ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : body,
  });
}
const parametros = (drawingId, assetId) => ({ params: Promise.resolve({ drawingId, assetId }) });

async function criar(corpo = {}, user = "dono") {
  const resposta = await indice.POST(pedido("/api/studio", { method: "POST", user, json: { nome: "Planta térreo", ...corpo } }));
  assert.equal(resposta.status, 201, JSON.stringify(await resposta.clone().json()));
  return (await resposta.json()).prancha;
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1cAAAAASUVORK5CYII=", "base64");
function formulario({ tipo = "image/png", conteudo = png, categoria = "mobilia", larguraMm, alturaMm } = {}) {
  const form = new FormData();
  form.append("file", new Blob([conteudo], { type: tipo }), "sofa.png");
  form.append("categoria", categoria);
  if (larguraMm !== undefined) form.append("larguraMm", String(larguraMm));
  if (alturaMm !== undefined) form.append("alturaMm", String(alturaMm));
  return form;
}
const comArquivo = (form) => ({ body: form, headers: {} });

function comParede(base) {
  return {
    ...base,
    elementos: [
      { id: "p1", camada: "layout", tipo: "parede", a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, espessuraMm: 150 },
    ],
  };
}

test("sem sessão e sem permissão nenhuma porta da prancheta abre", async () => {
  const id = crypto.randomUUID();
  const portas = [
    (user) => indice.GET(pedido("/api/studio", { user })),
    (user) => indice.POST(pedido("/api/studio", { user, method: "POST", json: { nome: "Planta" } })),
    (user) => prancha.GET(pedido(`/api/studio/${id}`, { user }), parametros(id)),
    (user) => prancha.PUT(pedido(`/api/studio/${id}`, { user, method: "PUT", json: { documento: documentoVazio(), revisao: 1 } }), parametros(id)),
    (user) => prancha.DELETE(pedido(`/api/studio/${id}`, { user, method: "DELETE" }), parametros(id)),
    (user) => biblioteca.GET(pedido("/api/studio/assets", { user })),
    (user) => biblioteca.POST(pedido("/api/studio/assets", { user, method: "POST", ...comArquivo(formulario()) })),
    (user) => item.GET(pedido(`/api/studio/assets/${id}`, { user }), parametros(undefined, id)),
    (user) => item.DELETE(pedido(`/api/studio/assets/${id}`, { user, method: "DELETE" }), parametros(undefined, id)),
  ];
  for (const porta of portas) {
    assert.equal((await porta(null)).status, 401);
    assert.equal((await porta("negado")).status, 403);
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM studio_drawings").get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM studio_assets").get().n, 0);
});

test("quem só tem leitura enxerga a prancha e não a altera", async () => {
  const criada = await criar();
  assert.equal((await prancha.GET(pedido(`/api/studio/${criada.id}`, { user: "leitor" }), parametros(criada.id))).status, 200);
  assert.equal((await indice.GET(pedido("/api/studio", { user: "leitor" }))).status, 200);

  const escritas = [
    () => indice.POST(pedido("/api/studio", { user: "leitor", method: "POST", json: { nome: "Outra" } })),
    () => prancha.PUT(pedido(`/api/studio/${criada.id}`, { user: "leitor", method: "PUT", json: { documento: documentoVazio(), revisao: 1 } }), parametros(criada.id)),
    () => prancha.DELETE(pedido(`/api/studio/${criada.id}`, { user: "leitor", method: "DELETE" }), parametros(criada.id)),
    () => biblioteca.POST(pedido("/api/studio/assets", { user: "leitor", method: "POST", ...comArquivo(formulario()) })),
  ];
  for (const escrita of escritas) assert.equal((await escrita()).status, 403);
  assert.equal(db.sqlite.prepare("SELECT revisao FROM studio_drawings WHERE id = ?").get(criada.id).revisao, 1);
});

test("quem tem edição desenha, grava e apaga", async () => {
  const criada = await criar({}, "desenhista");
  const salva = await prancha.PUT(pedido(`/api/studio/${criada.id}`, {
    user: "desenhista", method: "PUT", json: { documento: comParede(documentoVazio()), revisao: 1 },
  }), parametros(criada.id));
  assert.equal(salva.status, 200);
  const corpo = await salva.json();
  assert.equal(corpo.prancha.revisao, 2);
  assert.equal(corpo.prancha.documento.elementos.length, 1);
  assert.equal((await prancha.DELETE(pedido(`/api/studio/${criada.id}`, { user: "desenhista", method: "DELETE" }), parametros(criada.id))).status, 204);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM studio_drawings").get().n, 0);
});

test("a prancha de outra empresa não existe para quem pergunta", async () => {
  const daA = await criar({ projectId: projetoA });
  const daB = await criar({ nome: "Segredo da empresa B" }, "outro");

  assert.equal((await prancha.GET(pedido(`/api/studio/${daB.id}`, { user: "dono" }), parametros(daB.id))).status, 404);
  assert.equal((await prancha.PUT(pedido(`/api/studio/${daB.id}`, { user: "dono", method: "PUT", json: { documento: documentoVazio(), revisao: 1 } }), parametros(daB.id))).status, 404);
  assert.equal((await prancha.DELETE(pedido(`/api/studio/${daB.id}`, { user: "dono", method: "DELETE" }), parametros(daB.id))).status, 404);

  const lista = await (await indice.GET(pedido("/api/studio", { user: "dono" }))).json();
  assert.deepEqual(lista.pranchas.map((linha) => linha.id), [daA.id]);
  assert.ok(!JSON.stringify(lista).includes("Segredo da empresa B"));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM studio_drawings").get().n, 2, "nada da empresa B foi apagado pela tentativa");
});

test("não se pendura uma prancha em projeto de outra empresa", async () => {
  const recusado = await indice.POST(pedido("/api/studio", { method: "POST", json: { nome: "Planta", projectId: projetoB } }));
  assert.equal(recusado.status, 400);
  assert.equal((await recusado.json()).code, "invalid_project");

  const criada = await criar();
  const mudanca = await prancha.PUT(pedido(`/api/studio/${criada.id}`, {
    method: "PUT", json: { documento: documentoVazio(), revisao: 1, projectId: projetoB },
  }), parametros(criada.id));
  assert.equal(mudanca.status, 400);
  assert.equal(db.sqlite.prepare("SELECT project_id FROM studio_drawings WHERE id = ?").get(criada.id).project_id, null);
});

test("duas abas abertas não se sobrescrevem em silêncio", async () => {
  const criada = await criar();
  const primeira = await prancha.PUT(pedido(`/api/studio/${criada.id}`, {
    method: "PUT", json: { documento: comParede(documentoVazio()), revisao: 1 },
  }), parametros(criada.id));
  assert.equal(primeira.status, 200);

  // A segunda aba ainda acha que está na revisão 1 e tenta gravar por cima.
  const segunda = await prancha.PUT(pedido(`/api/studio/${criada.id}`, {
    method: "PUT", json: { documento: documentoVazio(), revisao: 1 },
  }), parametros(criada.id));
  assert.equal(segunda.status, 409);
  assert.equal((await segunda.json()).code, "revision_conflict");

  const guardado = JSON.parse(db.sqlite.prepare("SELECT documento FROM studio_drawings WHERE id = ?").get(criada.id).documento);
  assert.equal(guardado.elementos.length, 1, "o desenho da primeira aba foi perdido");
});

test("desenho inválido é recusado na borda, com o campo que falhou", async () => {
  const criada = await criar();
  const foraDeFaixa = {
    ...documentoVazio(),
    elementos: [{ id: "p1", camada: "layout", tipo: "parede", a: { x: 3e9, y: 0 }, b: { x: 3000, y: 0 }, espessuraMm: 150 }],
  };
  const recusado = await prancha.PUT(pedido(`/api/studio/${criada.id}`, { method: "PUT", json: { documento: foraDeFaixa, revisao: 1 } }), parametros(criada.id));
  assert.equal(recusado.status, 400);
  const corpo = await recusado.json();
  assert.equal(corpo.code, "validation_error");
  assert.ok(Object.keys(corpo.details ?? {}).length > 0, "a resposta precisa dizer qual campo recusou");
  assert.equal(db.sqlite.prepare("SELECT revisao FROM studio_drawings WHERE id = ?").get(criada.id).revisao, 1);
});

test("prancha com desenho corrompido no banco falha com nome, não com tela branca", async () => {
  const criada = await criar();
  db.sqlite.prepare("UPDATE studio_drawings SET documento = ? WHERE id = ?").run("{isso não é json", criada.id);
  const resposta = await prancha.GET(pedido(`/api/studio/${criada.id}`), parametros(criada.id));
  assert.equal(resposta.status, 422);
  assert.equal((await resposta.json()).code, "drawing_unreadable");
});

test("a criação registra auditoria e nasce com a folha padrão e as cinco camadas", async () => {
  const criada = await criar();
  assert.equal(criada.revisao, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action = 'studio.drawing.created'").get().n, 1);
  const aberta = await (await prancha.GET(pedido(`/api/studio/${criada.id}`), parametros(criada.id))).json();
  assert.equal(aberta.prancha.documento.camadas.length, 5);
  assert.equal(aberta.prancha.documento.elementos.length, 0);
  assert.equal(aberta.prancha.documento.folhaLarguraMm, 841);
});

test("a biblioteca guarda a imagem cifrada e devolve os bytes originais", async () => {
  const enviado = await biblioteca.POST(pedido("/api/studio/assets", { method: "POST", ...comArquivo(formulario({ larguraMm: 1800, alturaMm: 900 })) }));
  assert.equal(enviado.status, 201, JSON.stringify(await enviado.clone().json()));
  const { item: guardado } = await enviado.json();
  assert.equal(guardado.desenhavel, true);
  assert.equal(guardado.larguraMm, 1800);
  assert.equal(guardado.url, `/api/studio/assets/${guardado.id}`);

  const bruto = [...bytes.values()][0];
  assert.ok(bruto, "nada chegou ao armazenamento");
  assert.ok(!Buffer.from(bruto).includes(png.subarray(0, 8)), "o arquivo foi guardado em claro");

  const baixado = await item.GET(pedido(`/api/studio/assets/${guardado.id}`), parametros(undefined, guardado.id));
  assert.equal(baixado.status, 200);
  assert.equal(baixado.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await baixado.arrayBuffer()), png);
});

test("formato que a prancha não desenha entra declarado como anexo", async () => {
  const enviado = await biblioteca.POST(pedido("/api/studio/assets", {
    method: "POST", ...comArquivo(formulario({ tipo: "application/pdf", categoria: "anexo" })),
  }));
  assert.equal(enviado.status, 201);
  assert.equal((await enviado.json()).item.desenhavel, false, "PDF não pode se passar por imagem colocável");

  const executavel = await biblioteca.POST(pedido("/api/studio/assets", {
    method: "POST", ...comArquivo(formulario({ tipo: "image/svg+xml" })),
  }));
  assert.equal(executavel.status, 415, "SVG carrega script e não entra na biblioteca");
});

test("medida real precisa ser milímetro inteiro e plausível", async () => {
  for (const largura of ["0", "-5", "3,5", "999999999"]) {
    const resposta = await biblioteca.POST(pedido("/api/studio/assets", { method: "POST", ...comArquivo(formulario({ larguraMm: largura })) }));
    assert.equal(resposta.status, 400, `a largura ${largura} passou`);
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM studio_assets").get().n, 0);
});

test("item da biblioteca de outra empresa não abre nem some", async () => {
  const daB = await (await biblioteca.POST(pedido("/api/studio/assets", { user: "outro", method: "POST", ...comArquivo(formulario()) }))).json();
  assert.equal((await item.GET(pedido(`/api/studio/assets/${daB.item.id}`, { user: "dono" }), parametros(undefined, daB.item.id))).status, 404);
  assert.equal((await item.DELETE(pedido(`/api/studio/assets/${daB.item.id}`, { user: "dono", method: "DELETE" }), parametros(undefined, daB.item.id))).status, 404);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM studio_assets").get().n, 1);
  assert.equal(bytes.size, 1, "os bytes da empresa B continuam no armazenamento");

  const lista = await (await biblioteca.GET(pedido("/api/studio/assets", { user: "dono" }))).json();
  assert.deepEqual(lista.itens, []);
});

test("apagar o item leva junto os bytes do armazenamento", async () => {
  const guardado = await (await biblioteca.POST(pedido("/api/studio/assets", { method: "POST", ...comArquivo(formulario()) }))).json();
  assert.equal(bytes.size, 1);
  assert.equal((await item.DELETE(pedido(`/api/studio/assets/${guardado.item.id}`, { method: "DELETE" }), parametros(undefined, guardado.item.id))).status, 204);
  assert.equal(bytes.size, 0, "o arquivo ficou órfão no armazenamento");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action = 'studio.asset.deleted'").get().n, 1);
});

test("o fundo de traçado sobrevive à gravação e volta inteiro", async () => {
  const criada = await criar();
  const fundo = { chave: "/api/studio/assets/abc", nome: "planta-existente.png", larguraMm: 12000, alturaMm: 8400, opacidade: 45 };
  const salva = await prancha.PUT(pedido(`/api/studio/${criada.id}`, {
    method: "PUT", json: { documento: { ...documentoVazio(), fundo }, revisao: 1 },
  }), parametros(criada.id));
  assert.equal(salva.status, 200);
  const aberta = await (await prancha.GET(pedido(`/api/studio/${criada.id}`), parametros(criada.id))).json();
  assert.deepEqual(aberta.prancha.documento.fundo, fundo);
});

test("fundo sem proporção declarada não entra: traçar sobre planta esticada erra a obra", async () => {
  const criada = await criar();
  const semAltura = { chave: "/api/studio/assets/abc", nome: "planta.png", larguraMm: 12000, opacidade: 45 };
  const recusado = await prancha.PUT(pedido(`/api/studio/${criada.id}`, {
    method: "PUT", json: { documento: { ...documentoVazio(), fundo: semAltura }, revisao: 1 },
  }), parametros(criada.id));
  assert.equal(recusado.status, 400);
  assert.equal(db.sqlite.prepare("SELECT revisao FROM studio_drawings WHERE id = ?").get(criada.id).revisao, 1);
});

// ## Importação de DXF
const dxfSimples = [
  "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "6", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  "0", "LINE", "8", "A-PAREDES", "10", "0", "20", "0", "11", "4", "21", "0",
  "0", "ENDSEC", "0", "EOF",
].join("\n");

function formularioDxf({ conteudo = dxfSimples, nome = "planta.dxf", tipo = "image/vnd.dxf", unidade } = {}) {
  const form = new FormData();
  form.append("file", new Blob([conteudo], { type: tipo }), nome);
  if (unidade !== undefined) form.append("unidade", unidade);
  return form;
}

test("importar DXF exige sessão e permissão de edição", async () => {
  assert.equal((await importacao.POST(pedido("/api/studio/importar", { user: null, method: "POST", ...comArquivo(formularioDxf()) }))).status, 401);
  assert.equal((await importacao.POST(pedido("/api/studio/importar", { user: "negado", method: "POST", ...comArquivo(formularioDxf()) }))).status, 403);
  assert.equal((await importacao.POST(pedido("/api/studio/importar", { user: "leitor", method: "POST", ...comArquivo(formularioDxf()) }))).status, 403,
    "ler a prancha não é o mesmo que despejar um desenho inteiro nela");
});

test("importar DXF devolve geometria em milímetro sem gravar nada", async () => {
  const resposta = await importacao.POST(pedido("/api/studio/importar", { method: "POST", ...comArquivo(formularioDxf()) }));
  assert.equal(resposta.status, 200, JSON.stringify(await resposta.clone().json()));
  const corpo = await resposta.json();
  assert.equal(corpo.unidade, "m");
  assert.equal(corpo.unidadeDeclarada, true);
  assert.equal(corpo.nomeArquivo, "planta.dxf");
  assert.equal(corpo.elementos.length, 1);
  assert.deepEqual(corpo.elementos[0].pontos, [{ x: 0, y: 0 }, { x: 4000, y: 0 }]);
  assert.equal(corpo.camadas[0].nome, "A-PAREDES");
  assert.equal(resposta.headers.get("cache-control"), "private, no-store");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM studio_drawings").get().n, 0,
    "a importação é para revisão; quem grava é a pessoa");
});

test("a unidade pedida no formulário vence a do arquivo, e unidade inventada é recusada", async () => {
  const emCm = await importacao.POST(pedido("/api/studio/importar", { method: "POST", ...comArquivo(formularioDxf({ unidade: "cm" })) }));
  assert.equal((await emCm.json()).elementos[0].pontos[1].x, 40);
  const invalida = await importacao.POST(pedido("/api/studio/importar", { method: "POST", ...comArquivo(formularioDxf({ unidade: "cubito" })) }));
  assert.equal(invalida.status, 400);
  assert.equal((await invalida.json()).code, "invalid_unit");
});

test("DWG inválido passa pelo conversor local sem exigir configuração externa", async () => {
  const dwg = Buffer.concat([Buffer.from("AC1032", "ascii"), Buffer.alloc(64)]);
  const resposta = await importacao.POST(pedido("/api/studio/importar", {
    method: "POST", ...comArquivo(formularioDxf({ conteudo: dwg, nome: "planta.dwg", tipo: "image/vnd.dwg" })),
  }));
  assert.equal(resposta.status, 415);
  const corpo = await resposta.json();
  assert.equal(corpo.code, "dwg_conversion_failed");
  assert.doesNotMatch(corpo.error, /configurad[oa]/i);
});

test("arquivo que não é DXF é recusado com motivo, não com erro genérico", async () => {
  const resposta = await importacao.POST(pedido("/api/studio/importar", {
    method: "POST", ...comArquivo(formularioDxf({ conteudo: "isto é um texto qualquer", nome: "nota.txt", tipo: "text/plain" })),
  }));
  assert.equal(resposta.status, 415);
  assert.equal((await resposta.json()).code, "cad_invalido");
});

test("arquivo NEXO renomeado importa e persiste coordenadas fracionárias", async () => {
  const doc = { ...documentoVazio(), elementos: [{ id: "decimal", camada: "layout", tipo: "traco", pontos: [{ x: 0.125, y: 0 }, { x: 3000.25, y: -100.5 }], espessuraMm: 1 }] };
  const content = JSON.stringify({ format: "nexo", version: 1, unit: "mm", document: doc });
  const response = await importacao.POST(pedido("/api/studio/importar", { method: "POST", ...comArquivo(formularioDxf({ conteudo: content, nome: "renomeado.dxf", tipo: "application/json" })) }));
  assert.equal(response.status, 200);
  const imported = await response.json();
  assert.equal(imported.report.format, "nexo");
  assert.equal(imported.elementos[0].pontos[0].x, 0.125);
  const created = await criar();
  const saved = await prancha.PUT(pedido(`/api/studio/${created.id}`, { method: "PUT", json: { documento: doc, revisao: 1 } }), parametros(created.id));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).prancha.documento.elementos[0].pontos[1].x, 3000.25);
});

test("arquivo vazio e envio sem arquivo não passam", async () => {
  const vazio = new FormData();
  vazio.append("file", new Blob([], { type: "image/vnd.dxf" }), "vazio.dxf");
  assert.equal((await importacao.POST(pedido("/api/studio/importar", { method: "POST", ...comArquivo(vazio) }))).status, 400);
  assert.equal((await importacao.POST(pedido("/api/studio/importar", { method: "POST", ...comArquivo(new FormData()) }))).status, 400);
});

test("o desenho importado pode ser gravado sem o servidor recusar nenhum elemento", async () => {
  const criada = await criar();
  const lido = await (await importacao.POST(pedido("/api/studio/importar", { method: "POST", ...comArquivo(formularioDxf()) }))).json();
  const base = documentoVazio();
  const salva = await prancha.PUT(pedido(`/api/studio/${criada.id}`, {
    method: "PUT",
    json: { documento: { ...base, camadas: [...base.camadas, ...lido.camadas], elementos: lido.elementos }, revisao: 1 },
  }), parametros(criada.id));
  assert.equal(salva.status, 200, JSON.stringify(await salva.clone().json()));
  const aberta = await (await prancha.GET(pedido(`/api/studio/${criada.id}`), parametros(criada.id))).json();
  assert.equal(aberta.prancha.documento.elementos.length, 1);
  assert.equal(aberta.prancha.documento.camadas.length, 6);
});
