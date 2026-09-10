import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";

import {
  createModuleLoader,
  createTestDatabase,
  seedTwoOrganizations,
} from "./helpers/sqlite-harness.mjs";

/**
 * Isolamento entre duas empresas.
 *
 * Estes testes existem para falhar se alguém remover um `organization_id` de
 * uma cláusula `where`. Cada caso cria o mesmo tipo de registro nas duas
 * empresas e exige que a empresa A nunca veja, altere ou apague o registro da B.
 */

let loader;
let clientsModule;
let projectsModule;
let tasksModule;

const ALFA = "org_alfa";
const BETA = "org_beta";

before(async () => {
  loader = await createModuleLoader();
  [clientsModule, projectsModule, tasksModule] = await Promise.all([
    loader.load("/lib/data/clients.ts"),
    loader.load("/lib/data/projects.ts"),
    loader.load("/lib/data/tasks.ts"),
  ]);
});

after(async () => {
  await loader?.close();
});

/** Cada caso recebe um banco limpo, então a ordem dos testes não importa. */
async function withDatabase(run) {
  const harness = await createTestDatabase();
  seedTwoOrganizations(harness.sqlite);
  try {
    await run(harness.db, harness.sqlite);
  } finally {
    harness.close();
  }
}

describe("clientes", () => {
  test("a listagem só devolve clientes da empresa ativa", async () => {
    await withDatabase(async (db) => {
      await clientsModule.createClient(db, ALFA, { name: "Cliente da Alfa" });
      await clientsModule.createClient(db, BETA, { name: "Cliente da Beta" });

      const alfa = await clientsModule.listClients(db, ALFA);
      const beta = await clientsModule.listClients(db, BETA);

      assert.deepEqual(
        alfa.items.map((item) => item.name),
        ["Cliente da Alfa"],
      );
      assert.equal(alfa.total, 1);
      assert.deepEqual(
        beta.items.map((item) => item.name),
        ["Cliente da Beta"],
      );
    });
  });

  test("buscar cliente de outra empresa devolve null, não o registro", async () => {
    await withDatabase(async (db) => {
      const beta = await clientsModule.createClient(db, BETA, { name: "Cliente da Beta" });

      assert.equal(await clientsModule.getClient(db, ALFA, beta.id), null);
      assert.ok(await clientsModule.getClient(db, BETA, beta.id));
    });
  });

  test("atualizar cliente de outra empresa não altera nada", async () => {
    await withDatabase(async (db) => {
      const beta = await clientsModule.createClient(db, BETA, { name: "Nome original" });

      const result = await clientsModule.updateClient(db, ALFA, beta.id, { name: "Invadido" });

      assert.equal(result, null);
      const untouched = await clientsModule.getClient(db, BETA, beta.id);
      assert.equal(untouched.name, "Nome original");
    });
  });

  test("excluir cliente de outra empresa não apaga nada", async () => {
    await withDatabase(async (db) => {
      const beta = await clientsModule.createClient(db, BETA, { name: "Cliente da Beta" });

      const result = await clientsModule.deleteClient(db, ALFA, beta.id);

      assert.deepEqual(result, { deleted: false, reason: "not_found" });
      assert.ok(await clientsModule.getClient(db, BETA, beta.id));
    });
  });

  test("cliente com projeto vinculado não é excluído por acidente", async () => {
    await withDatabase(async (db) => {
      const client = await clientsModule.createClient(db, ALFA, { name: "Com projeto" });
      await projectsModule.createProject(db, ALFA, {
        code: "P-1",
        name: "Projeto vinculado",
        kind: "project",
        clientId: client.id,
      });

      const result = await clientsModule.deleteClient(db, ALFA, client.id);

      assert.deepEqual(result, { deleted: false, reason: "has_projects" });
      assert.ok(await clientsModule.getClient(db, ALFA, client.id));
    });
  });
});

describe("projetos e obras", () => {
  test("a listagem só devolve trabalhos da empresa ativa", async () => {
    await withDatabase(async (db) => {
      await projectsModule.createProject(db, ALFA, {
        code: "ALFA-1",
        name: "Obra da Alfa",
        kind: "work",
      });
      await projectsModule.createProject(db, BETA, {
        code: "BETA-1",
        name: "Obra da Beta",
        kind: "work",
      });

      const alfa = await projectsModule.listProjects(db, ALFA);

      assert.deepEqual(
        alfa.items.map((item) => item.code),
        ["ALFA-1"],
      );
      assert.equal(alfa.total, 1);
    });
  });

  test("o mesmo código pode existir em empresas diferentes", async () => {
    await withDatabase(async (db) => {
      await projectsModule.createProject(db, ALFA, {
        code: "OB-001",
        name: "Obra da Alfa",
        kind: "work",
      });

      // O índice único é (organization_id, code): duas empresas podem usar a
      // mesma numeração sem colidir.
      assert.equal(await projectsModule.isCodeTaken(db, BETA, "OB-001"), false);
      assert.equal(await projectsModule.isCodeTaken(db, ALFA, "OB-001"), true);

      await projectsModule.createProject(db, BETA, {
        code: "OB-001",
        name: "Obra da Beta",
        kind: "work",
      });

      assert.equal((await projectsModule.listProjects(db, BETA)).total, 1);
    });
  });

  test("cliente de outra empresa é recusado como vínculo", async () => {
    await withDatabase(async (db) => {
      const betaClient = await clientsModule.createClient(db, BETA, { name: "Cliente da Beta" });

      // A chave estrangeira do banco aceitaria: a linha existe. O recorte por
      // empresa é da aplicação, e é isto que este teste protege.
      const result = await projectsModule.assertRelationsBelongToOrganization(db, ALFA, {
        clientId: betaClient.id,
      });

      assert.deepEqual(result, { ok: false, field: "clientId" });
    });
  });

  test("responsável de outra empresa é recusado como vínculo", async () => {
    await withDatabase(async (db) => {
      const result = await projectsModule.assertRelationsBelongToOrganization(db, ALFA, {
        ownerMemberId: "mem_beta_owner",
      });

      assert.deepEqual(result, { ok: false, field: "ownerMemberId" });

      const allowed = await projectsModule.assertRelationsBelongToOrganization(db, ALFA, {
        ownerMemberId: "mem_alfa_owner",
      });
      assert.deepEqual(allowed, { ok: true });
    });
  });

  test("excluir trabalho de outra empresa não apaga nada", async () => {
    await withDatabase(async (db) => {
      const beta = await projectsModule.createProject(db, BETA, {
        code: "BETA-9",
        name: "Obra da Beta",
        kind: "work",
      });

      assert.equal(await projectsModule.deleteProject(db, ALFA, beta.id), false);
      assert.ok(await projectsModule.getProject(db, BETA, beta.id));
    });
  });

  test("excluir o trabalho leva as tarefas dele, e só as dele", async () => {
    await withDatabase(async (db) => {
      const project = await projectsModule.createProject(db, ALFA, {
        code: "ALFA-7",
        name: "Obra com tarefas",
        kind: "work",
      });
      await tasksModule.createTask(db, ALFA, { title: "Tarefa do projeto", projectId: project.id });
      await tasksModule.createTask(db, ALFA, { title: "Tarefa solta" });

      assert.equal(await projectsModule.deleteProject(db, ALFA, project.id), true);

      const remaining = await tasksModule.listTasks(db, ALFA);
      assert.deepEqual(
        remaining.items.map((item) => item.title),
        ["Tarefa solta"],
      );
    });
  });
});

describe("tarefas", () => {
  test("a listagem só devolve tarefas da empresa ativa", async () => {
    await withDatabase(async (db) => {
      await tasksModule.createTask(db, ALFA, { title: "Tarefa da Alfa" });
      await tasksModule.createTask(db, BETA, { title: "Tarefa da Beta" });

      const alfa = await tasksModule.listTasks(db, ALFA);

      assert.deepEqual(
        alfa.items.map((item) => item.title),
        ["Tarefa da Alfa"],
      );
    });
  });

  test("atualizar tarefa de outra empresa não altera nada", async () => {
    await withDatabase(async (db) => {
      const beta = await tasksModule.createTask(db, BETA, { title: "Título original" });

      assert.equal(await tasksModule.updateTask(db, ALFA, beta.id, { title: "Invadido" }), null);

      const untouched = await tasksModule.getTask(db, BETA, beta.id);
      assert.equal(untouched.title, "Título original");
    });
  });

  test("excluir tarefa de outra empresa não apaga nada", async () => {
    await withDatabase(async (db) => {
      const beta = await tasksModule.createTask(db, BETA, { title: "Tarefa da Beta" });

      assert.equal(await tasksModule.deleteTask(db, ALFA, beta.id), false);
      assert.ok(await tasksModule.getTask(db, BETA, beta.id));
    });
  });

  test("trabalho de outra empresa é recusado como vínculo da tarefa", async () => {
    await withDatabase(async (db) => {
      const betaProject = await projectsModule.createProject(db, BETA, {
        code: "BETA-3",
        name: "Obra da Beta",
        kind: "work",
      });

      const result = await tasksModule.assertTaskRelations(db, ALFA, {
        projectId: betaProject.id,
      });

      assert.deepEqual(result, { ok: false, field: "projectId" });
    });
  });

  test("as contagens da fila não somam tarefas de outra empresa", async () => {
    await withDatabase(async (db) => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

      await tasksModule.createTask(db, ALFA, { title: "Atrasada da Alfa", dueAt: yesterday });
      await tasksModule.createTask(db, BETA, { title: "Atrasada da Beta 1", dueAt: yesterday });
      await tasksModule.createTask(db, BETA, { title: "Atrasada da Beta 2", dueAt: yesterday });

      const alfa = await tasksModule.countTaskQueue(db, ALFA);
      const beta = await tasksModule.countTaskQueue(db, BETA);

      assert.equal(alfa.overdue, 1);
      assert.equal(alfa.open, 1);
      assert.equal(beta.overdue, 2);
    });
  });

  test("concluir carimba a data e reabrir limpa", async () => {
    await withDatabase(async (db) => {
      const task = await tasksModule.createTask(db, ALFA, { title: "Ciclo de conclusão" });
      assert.equal(task.completedAt, null);

      const done = await tasksModule.updateTask(db, ALFA, task.id, { status: "done" });
      assert.ok(done.completedAt, "concluir deve carimbar completedAt");

      const reopened = await tasksModule.updateTask(db, ALFA, task.id, { status: "doing" });
      assert.equal(reopened.completedAt, null, "reabrir deve limpar completedAt");
    });
  });
});
