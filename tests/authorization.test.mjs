import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";

import { createModuleLoader } from "./helpers/sqlite-harness.mjs";

/**
 * Autorização e validação de entrada.
 *
 * Cobre as três regras que, se quebradas, abrem o produto: quem pode escrever,
 * de onde vem a identidade e o que a API aceita no corpo da requisição.
 */

let loader;
let roles;
let identity;
let schemas;

before(async () => {
  loader = await createModuleLoader();
  [roles, identity, schemas] = await Promise.all([
    loader.load("/lib/auth/roles.ts"),
    loader.load("/lib/auth/identity.ts"),
    loader.load("/lib/domain/schemas.ts"),
  ]);
});

after(async () => {
  await loader?.close();
});

describe("papéis e capacidades", () => {
  test("proprietário e administrador escrevem no núcleo operacional", async () => {
    for (const role of ["owner", "admin"]) {
      for (const capability of ["client:write", "project:write", "task:write"]) {
        assert.equal(roles.can(role, capability), true, `${role} deveria ter ${capability}`);
      }
    }
  });

  test("gestor opera projetos, mas não administra a assinatura", async () => {
    assert.equal(roles.can("manager", "project:write"), true);
    assert.equal(roles.can("manager", "client:write"), true);
    assert.equal(roles.can("manager", "organization:manage"), false);
    assert.equal(roles.can("manager", "member:manage"), false);
  });

  test("integrante executa tarefas, mas não abre projeto nem cadastra cliente", async () => {
    assert.equal(roles.can("member", "task:write"), true);
    assert.equal(roles.can("member", "project:read"), true);
    assert.equal(roles.can("member", "project:write"), false);
    assert.equal(roles.can("member", "client:write"), false);
  });

  test("parceiro e cliente não escrevem nada", async () => {
    for (const role of ["partner", "client"]) {
      for (const capability of ["client:write", "project:write", "task:write", "member:manage"]) {
        assert.equal(roles.can(role, capability), false, `${role} não deveria ter ${capability}`);
      }
    }
  });

  test("cliente externo não lê o financeiro", async () => {
    assert.equal(roles.can("client", "finance:read"), false);
    assert.equal(roles.can("partner", "finance:read"), false);
    assert.equal(roles.can("manager", "finance:read"), true);
  });

  test("assertCan lança ForbiddenError com status 403", async () => {
    assert.throws(
      () => roles.assertCan("member", "project:write"),
      (error) => error instanceof roles.ForbiddenError && error.status === 403,
    );

    // Caminho feliz: não lança.
    roles.assertCan("manager", "project:write");
  });

  test("papel desconhecido não é tratado como papel válido", async () => {
    assert.equal(roles.isRole("owner"), true);
    assert.equal(roles.isRole("superadmin"), false);
    assert.equal(roles.isRole(""), false);
  });
});

describe("identidade", () => {
  const platformHeaders = () =>
    new Headers({ "oai-authenticated-user-email": "Ana@Alfa.TEST" });

  test("a identidade da plataforma é normalizada", async () => {
    const resolved = identity.resolveIdentityFrom(platformHeaders(), {});

    assert.equal(resolved.subject, "ana@alfa.test");
    assert.equal(resolved.email, "ana@alfa.test");
    assert.equal(resolved.provider, "platform");
  });

  test("sem header e sem variável de desenvolvimento não há identidade", async () => {
    assert.equal(identity.resolveIdentityFrom(new Headers(), {}), null);
  });

  test("a identidade de desenvolvimento é ignorada em produção", async () => {
    const env = { NODE_ENV: "production", NEXO_DEV_USER_EMAIL: "qualquer@exemplo.test" };

    assert.equal(identity.resolveIdentityFrom(new Headers(), env), null);
  });

  test("a identidade de desenvolvimento serve fora de produção", async () => {
    const resolved = identity.resolveIdentityFrom(new Headers(), {
      NODE_ENV: "development",
      NEXO_DEV_USER_EMAIL: "dev@alfa.test",
    });

    assert.equal(resolved.provider, "dev");
    assert.equal(resolved.subject, "dev@alfa.test");
  });

  test("a plataforma tem precedência sobre a variável de desenvolvimento", async () => {
    const resolved = identity.resolveIdentityFrom(platformHeaders(), {
      NODE_ENV: "development",
      NEXO_DEV_USER_EMAIL: "dev@alfa.test",
    });

    assert.equal(resolved.provider, "platform");
    assert.equal(resolved.email, "ana@alfa.test");
  });
});

describe("contratos de entrada", () => {
  test("o corpo não pode escolher a empresa", async () => {
    // É a regra mais importante do multiempresa: se `organizationId` passasse
    // pelo schema, o cliente escolheria em qual empresa gravar.
    for (const [name, schema] of [
      ["cliente", schemas.createClientSchema],
      ["projeto", schemas.createProjectSchema],
      ["tarefa", schemas.createTaskSchema],
    ]) {
      const payload = {
        organizationId: "org_beta",
        name: "Registro",
        title: "Registro",
        code: "X-1",
        kind: "project",
      };

      const result = schema.safeParse(payload);
      assert.equal(result.success, false, `${name} não deveria aceitar organizationId`);
    }
  });

  test("campos derivados do servidor não são aceitos", async () => {
    const result = schemas.createTaskSchema.safeParse({
      title: "Tarefa válida",
      completedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(result.success, false, "completedAt é derivado do status");
  });

  test("um projeto válido passa e recebe os padrões", async () => {
    const result = schemas.createProjectSchema.safeParse({
      code: "OB-001",
      name: "Retrofit da sede",
      kind: "work",
    });

    assert.equal(result.success, true);
    assert.equal(result.data.status, "active");
    assert.equal(result.data.phase, "briefing");
    assert.equal(result.data.budgetCents, 0);
  });

  test("a entrega não pode ser anterior ao início", async () => {
    const result = schemas.createProjectSchema.safeParse({
      code: "OB-002",
      name: "Obra com datas invertidas",
      kind: "work",
      startDate: "2026-05-10",
      targetDate: "2026-05-01",
    });

    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((issue) => issue.path.includes("targetDate")));
  });

  test("valor monetário fracionado é recusado: centavos são inteiros", async () => {
    const result = schemas.createProjectSchema.safeParse({
      code: "OB-003",
      name: "Obra com centavos quebrados",
      kind: "work",
      budgetCents: 1234.56,
    });

    assert.equal(result.success, false);
  });

  test("atualização vazia é recusada", async () => {
    assert.equal(schemas.updateClientSchema.safeParse({}).success, false);
    assert.equal(schemas.updateProjectSchema.safeParse({}).success, false);
    assert.equal(schemas.updateTaskSchema.safeParse({}).success, false);
  });

  test("situação e prioridade fora do vocabulário são recusadas", async () => {
    assert.equal(
      schemas.createTaskSchema.safeParse({ title: "Tarefa", status: "concluida" }).success,
      false,
      "o valor gravado é em inglês; o rótulo em português é só exibição",
    );
    assert.equal(
      schemas.createTaskSchema.safeParse({ title: "Tarefa", priority: "urgentissima" }).success,
      false,
    );
    assert.equal(
      schemas.createTaskSchema.safeParse({ title: "Tarefa", status: "done" }).success,
      true,
    );
  });

  test("o identificador da empresa aceita apenas minúsculas, números e hífen", async () => {
    assert.equal(
      schemas.createOrganizationSchema.safeParse({ name: "Alfa", slug: "alfa-arq" }).success,
      true,
    );
    assert.equal(
      schemas.createOrganizationSchema.safeParse({ name: "Alfa", slug: "Alfa Arq" }).success,
      false,
    );
  });
});
