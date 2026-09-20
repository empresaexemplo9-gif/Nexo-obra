import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const permissoes = await vite.ssrLoadModule("/lib/permissions.ts");
test.after(() => vite.close());

const source = (path) => readFile(`${root}/${path}`, "utf8");

/**
 * O superadministrador abre qualquer empresa com poder total — `requireOrganizationContext`
 * devolve o contexto dele ANTES de conferir papel, de propósito. A interface não sabia
 * disso: cada tela repetia `role === "owner" || role === "admin"`, e o superadmin via o
 * selo "acesso total" sem achar o botão de Conexão DRAP, Equipe ou Portal — numa rota que
 * o teria aceitado.
 *
 * O que este arquivo protege é os dois lados concordarem.
 */

test("o servidor libera o superadministrador sem exigir papel", async () => {
  const backend = await source("lib/server/backend.ts");
  const antesDaChecagem = backend.slice(0, backend.indexOf("if (allowedRoles &&"));
  assert.equal(antesDaChecagem.includes('identity.scope === "superadmin"'), true);
  assert.equal(antesDaChecagem.includes("return superAdminContext("), true);
});

test("quem administra a empresa inclui o superadministrador", () => {
  assert.equal(permissoes.podeAdministrarEmpresa("owner"), true);
  assert.equal(permissoes.podeAdministrarEmpresa("admin"), true);
  assert.equal(permissoes.podeAdministrarEmpresa(permissoes.PLATFORM_SUPERADMIN_ROLE), true);
});

test("e não inclui quem não administra", () => {
  for (const papel of ["manager", "member", "partner", "service_provider", "finance", "accounting", undefined, ""]) {
    assert.equal(permissoes.podeAdministrarEmpresa(papel), false, `${papel} não deveria administrar`);
  }
});

test("as telas usam a regra compartilhada, não uma cópia", async () => {
  // Uma cópia por tela foi exatamente como o superadmin ficou de fora de três delas.
  const app = await source("components/nexo-app.tsx");
  assert.equal(app.includes("podeAdministrarEmpresa(session.member?.role) && canEdit(\"finance\")"), true);
  assert.equal(app.includes("podeAdministrarEmpresa(session.member?.role) && canEdit(\"team\")"), true);
  assert.equal(app.includes('(session.member?.role === "owner" || session.member?.role === "admin")'), false);
});

test("o superadministrador enxerga a Conexão DRAP", async () => {
  // Era o bloqueio concreto: sem este botão não há como conectar a empresa à Drap, e o
  // registro automático do webhook nunca chega a acontecer.
  const financeiro = await source("components/finance-workspace.tsx");
  assert.equal(financeiro.includes("canManageConnection ? <Button"), true);

  const app = await source("components/nexo-app.tsx");
  const chamada = app.slice(app.indexOf("<FinanceWorkspace"), app.indexOf("onProjectsChanged={loadData} />", app.indexOf("<FinanceWorkspace")));
  assert.equal(chamada.includes("podeAdministrarEmpresa"), true);
});
