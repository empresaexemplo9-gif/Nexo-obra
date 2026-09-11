import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { findByText, installDom, stubFetch, textOf } from "./dom-harness.mjs";

// Painel da plataforma com o banco desatualizado. É o cenário em que tudo falha, então
// é justamente onde o caminho da correção precisa estar visível.

const dom = installDom("https://platform.test/superadmin");
const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: {
  "@": root,
  "next/image": fileURLToPath(new URL("./stubs/next-image.mjs", import.meta.url)),
  "next/link": fileURLToPath(new URL("./stubs/next-link.mjs", import.meta.url)),
} }, server: { middlewareMode: true } });
const { SuperAdminApp } = await vite.ssrLoadModule("/components/superadmin-app.tsx");
after(async () => { await vite.close(); dom.cleanup(); });

let container; let reactRoot;
beforeEach(() => { container = null; reactRoot = null; });

const settle = async () => {
  for (let ciclo = 0; ciclo < 6; ciclo += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
};
async function abrir(routes) {
  if (reactRoot) await act(async () => { reactRoot.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  reactRoot = createRoot(container);
  const calls = stubFetch(routes);
  await act(async () => { reactRoot.render(React.createElement(SuperAdminApp)); });
  await settle();
  return calls;
}

const sessao = { "/api/superadmin/session": { authenticated: true, email: "admin@plataforma.test", expiresAt: Date.now() / 1000 + 3600 } };
const emDia = { applied: [{ id: "0000_x", appliedAt: 1 }], pending: [], total: 1 };
const indicadores = {
  totals: { organizations: 0, members: 0, clients: 0, projects: 0, open_tasks: 0 },
  organizations: [],
  maintenance: { id: "m", ready: false, members: 0, projects: 0, openTasks: 0, lastEntryAt: null },
};
const semConvites = { "/api/superadmin/invitations": { invitations: [] } };

test("banco desatualizado: o painel mostra o que fazer, e não só o erro", async () => {
  await abrir({
    ...sessao, ...semConvites,
    "/api/superadmin/migrations": { applied: [], pending: ["0011_great_ravenous", "0014_robust_doctor_strange"], total: 15 },
    "/api/superadmin/overview": () => ({ __status: 503, error: "O banco de dados está desatualizado.", code: "database_not_migrated" }),
  });
  const texto = textOf(container);
  assert.match(texto, /Banco de dados desatualizado/);
  assert.match(texto, /Faltam 2 de 15/);
  assert.match(texto, /planilhas, lembretes, metas e tempo de uso/, "diz o que está fora do ar");
  assert.match(texto, /Aplicar é seguro/);
  assert.ok(findByText(container, /Atualizar banco de dados/), "o botão da correção está na tela");
  assert.match(texto, /0011_great_ravenous/, "lista o que falta aplicar");
});

test("o clique aplica as migrações e recarrega o painel", async () => {
  let pendente = ["0011_great_ravenous"];
  const calls = await abrir({
    ...sessao, ...semConvites,
    "/api/superadmin/migrations": ({ method }) => {
      if (method === "POST") { pendente = []; return { applied: [{ id: "0011_great_ravenous", statements: 6, skipped: 0 }], pending: [] }; }
      return { applied: [], pending: pendente, total: 15 };
    },
    "/api/superadmin/overview": () => pendente.length
      ? { __status: 503, error: "O banco de dados está desatualizado.", code: "database_not_migrated" }
      : indicadores,
  });

  await act(async () => { findByText(container, /Atualizar banco de dados/).click(); });
  await settle();

  const aplicou = calls.find((call) => call.path === "/api/superadmin/migrations" && call.method === "POST");
  assert.ok(aplicou, "a aplicação foi pedida ao servidor");
  const texto = textOf(container);
  assert.match(texto, /Banco de dados em dia/, "o aviso vira confirmação");
  assert.doesNotMatch(texto, /Banco de dados desatualizado/);
  assert.match(texto, /Cadastrar empresa/, "e o painel volta a funcionar");
});

test("banco em dia mostra a confirmação discreta e o painel normal", async () => {
  await abrir({
    ...sessao, ...semConvites,
    "/api/superadmin/migrations": emDia,
    "/api/superadmin/overview": indicadores,
  });
  const texto = textOf(container);
  assert.match(texto, /Banco de dados em dia/);
  assert.equal(findByText(container, /Atualizar banco de dados/), null, "sem pendência, não há botão");
  assert.match(texto, /Controle da plataforma/);
  assert.match(texto, /Nenhuma empresa cadastrada/);
});

test("uma falha que não é do banco continua aparecendo como erro", async () => {
  await abrir({
    ...sessao, ...semConvites,
    "/api/superadmin/migrations": emDia,
    "/api/superadmin/overview": () => ({ __status: 500, error: "Falha inesperada no servidor." }),
  });
  assert.match(textOf(container), /Falha inesperada no servidor/);
});

test("sem sessão, o painel pede a senha e não revela nada", async () => {
  await abrir({ "/api/superadmin/session": () => ({ __status: 401, error: "Entre como superadministrador." }) });
  const texto = textOf(container);
  assert.match(texto, /Entrar como superadmin/);
  assert.doesNotMatch(texto, /Banco de dados/);
  assert.ok(container.querySelector('input[type="password"]'));
});

test("o painel diz qual versão está no ar", async () => {
  await abrir({ ...sessao, ...semConvites, "/api/superadmin/migrations": emDia, "/api/superadmin/overview": indicadores });
  assert.match(textOf(container), /Versão no ar:/,
    "sem isso, um build antigo servindo o site não tem nenhum sintoma visível");
});
