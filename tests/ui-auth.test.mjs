import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { findByText, installDom, stubFetch, textOf } from "./dom-harness.mjs";

// Entrada e convite pela tela. O servidor já decide quem entra; aqui se verifica que a
// interface pede o que precisa, não deixa passar senha fraca e não oferece caminho de
// borda externa nenhuma.

const dom = installDom();
const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: {
  "@": root,
  "next/image": fileURLToPath(new URL("./stubs/next-image.mjs", import.meta.url)),
  "next/link": fileURLToPath(new URL("./stubs/next-link.mjs", import.meta.url)),
} }, server: { middlewareMode: true } });
const { SignInApp } = await vite.ssrLoadModule("/components/sign-in-app.tsx");
const { InvitationApp } = await vite.ssrLoadModule("/components/invitation-app.tsx");
const { permissionsForRole } = await vite.ssrLoadModule("/lib/permissions.ts");
after(async () => { await vite.close(); dom.cleanup(); });

let container; let reactRoot;
beforeEach(() => { container = null; reactRoot = null; });

async function settle() {
  for (let ciclo = 0; ciclo < 5; ciclo += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function abrir(element, routes) {
  if (reactRoot) await act(async () => { reactRoot.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  reactRoot = createRoot(container);
  const calls = stubFetch(routes);
  await act(async () => { reactRoot.render(element); });
  await settle();
  return calls;
}

// Escreve num campo controlado do React: o valor precisa passar pelo setter nativo,
// senão o componente não vê a mudança.
async function digitar(selector, value) {
  const field = container.querySelector(selector);
  assert.ok(field, `campo ${selector} não existe`);
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

async function clicar(node) {
  assert.ok(node, "elemento para clicar não existe");
  await act(async () => { node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await settle();
}

const convite = {
  email: "pessoa@escritorio.test", role: "member", organizationName: "Escritório Exemplo",
  expiresAt: Date.now() + 86_400_000, permissions: permissionsForRole("member"),
};

test("a tela de entrada pede e-mail e senha e manda para a sessão própria", async () => {
  const calls = await abrir(React.createElement(SignInApp), { "/api/auth/session": { authenticated: true } });
  const texto = textOf(container);
  assert.match(texto, /Entrar/);
  assert.doesNotMatch(texto, /ChatGPT/, "a entrada não depende de conta de terceiro");
  assert.ok(container.querySelector("#signin-email"));
  assert.ok(container.querySelector("#signin-password"));
  assert.equal(container.querySelector("#signin-password").type, "password", "a senha não aparece em texto");
  // Rótulo acessível nos dois campos.
  for (const id of ["signin-email", "signin-password"]) {
    assert.ok(container.querySelector(`label[for="${id}"]`), `falta rótulo de ${id}`);
  }

  await digitar("#signin-email", "pessoa@escritorio.test");
  await digitar("#signin-password", "senha-do-convidado-2026");
  await clicar(findByText(container, /^Entrar$/, "button"));
  const login = calls.find((call) => call.path === "/api/auth/session" && call.method === "POST");
  assert.ok(login, "o envio vai para a sessão da plataforma");
  assert.deepEqual(login.body, { email: "pessoa@escritorio.test", password: "senha-do-convidado-2026" });
});

test("senha recusada mostra o motivo e não navega", async () => {
  await abrir(React.createElement(SignInApp), {
    "/api/auth/session": () => ({ __status: 401, error: "E-mail ou senha inválidos." }),
  });
  await digitar("#signin-email", "pessoa@escritorio.test");
  await digitar("#signin-password", "errada-porem-longa");
  await clicar(findByText(container, /^Entrar$/, "button"));
  const alerta = container.querySelector('[role="alert"]');
  assert.ok(alerta, "o erro precisa aparecer na tela");
  assert.match(textOf(container), /E-mail ou senha inválidos/);
  // O botão volta a aceitar clique: erro de rede não deixa a tela travada.
  assert.equal(findByText(container, /^Entrar$/, "button").disabled, false);
});

test("mostrar senha é um controle com nome acessível", async () => {
  await abrir(React.createElement(SignInApp), { "/api/auth/session": { authenticated: true } });
  const alternar = container.querySelector('button[aria-label="Mostrar senha"]');
  assert.ok(alternar, "sem rótulo ninguém navega por teclado até aqui");
  await clicar(alternar);
  assert.equal(container.querySelector("#signin-password").type, "text");
  assert.ok(container.querySelector('button[aria-label="Ocultar senha"]'));
});

test("o convite de quem ainda não tem conta cria a senha no próprio aceite", async () => {
  const calls = await abrir(React.createElement(InvitationApp, { token: "t".repeat(40) }), {
    "/api/invitations": { invitation: convite },
    "/api/session": { authenticated: false },
  });
  const texto = textOf(container);
  assert.match(texto, /Escritório Exemplo/);
  assert.match(texto, /Crie sua senha/);
  assert.doesNotMatch(texto, /Entrar para aceitar o convite/, "não existe mais volta pela borda externa");

  const botao = () => findByText(container, /Aceitar e criar acesso/, "button");
  assert.equal(botao().disabled, true, "sem termos e sem senha, o aceite não pode ir");

  // Senha curta continua bloqueando.
  await digitar("#invitation-password", "123456");
  await digitar("#invitation-password-confirmation", "123456");
  await clicar(container.querySelector('[role="checkbox"], button[role="checkbox"]'));
  assert.equal(botao().disabled, true, "menos de dez caracteres não passa");

  // Senhas diferentes também.
  await digitar("#invitation-password", "senha-do-convidado-2026");
  await digitar("#invitation-password-confirmation", "senha-diferente-2026");
  assert.equal(botao().disabled, true, "confirmação diferente não passa");

  await digitar("#invitation-password-confirmation", "senha-do-convidado-2026");
  assert.equal(botao().disabled, false);
  await clicar(botao());

  const aceite = calls.find((call) => call.path.endsWith("/accept") && call.method === "POST");
  assert.ok(aceite, "o aceite precisa chegar ao servidor");
  assert.deepEqual(aceite.body, { acceptTerms: true, password: "senha-do-convidado-2026" });
  assert.match(textOf(container), /Acesso criado/);
});

test("quem já está com sessão aberta só confirma os termos", async () => {
  const calls = await abrir(React.createElement(InvitationApp, { token: "t".repeat(40) }), {
    "/api/invitations": { invitation: convite },
    "/api/session": { authenticated: true },
  });
  assert.doesNotMatch(textOf(container), /Crie sua senha/, "senha já existe: não pede de novo");
  assert.equal(container.querySelector("#invitation-password"), null);
  await clicar(container.querySelector('[role="checkbox"], button[role="checkbox"]'));
  await clicar(findByText(container, /Aceitar e criar acesso/, "button"));
  const aceite = calls.find((call) => call.path.endsWith("/accept") && call.method === "POST");
  assert.deepEqual(aceite.body, { acceptTerms: true }, "nem papel nem permissão saem do navegador");
});

test("convite recusado pelo servidor mostra o motivo e não cria nada", async () => {
  await abrir(React.createElement(InvitationApp, { token: "t".repeat(40) }), {
    "/api/invitations": () => ({ __status: 404, error: "Convite não encontrado." }),
    "/api/session": { authenticated: false },
  });
  const texto = textOf(container);
  assert.match(texto, /Convite indisponível/);
  assert.match(texto, /Convite não encontrado/);
  assert.equal(findByText(container, /Aceitar e criar acesso/, "button"), null);
});
