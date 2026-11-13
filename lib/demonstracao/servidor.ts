// SERVIDOR DA DEMONSTRAÇÃO — roda só no navegador do visitante.
//
// A demonstração usa as telas reais da plataforma. Em vez de falar com a API, cada pedido
// `/api/...` é respondido aqui, a partir de `respostas.json` (respostas reais da API para
// uma empresa fictícia, geradas por `scripts/gerar-demonstracao.mjs`). As edições do
// visitante mudam só este estado, guardado na aba (sessionStorage): nada chega ao
// servidor nem ao banco, e fechar a aba descarta tudo.
//
// O que não é emulado é recusado com uma mensagem clara — nunca com sucesso fabricado.

import capturado from "@/lib/demonstracao/respostas.json";
import { comprasDeExemplo, plantaDeExemplo } from "@/lib/demonstracao/dados";
import { permissionModules, permissionsForRole } from "@/lib/permissions";
import { buscarMaterialPadrao, MATERIAIS_PADRAO } from "@/lib/catalogo-materiais";
import { areaM2, layoutDoModelo, layoutVazio, type LayoutConteudo } from "@/lib/layout";
import { documentoVazio } from "@/lib/prancheta";

type Json = Record<string, unknown>;
type Linha = Json & { id: string };
export type RespostaDemo = { status: number; body: unknown };

const CHAVE = "drap-demonstracao-estado-v2";
export const RECUSA_DEMO = "Na demonstração esta ação não é executada. Ela funciona na conta da sua empresa.";
const recusa = (): RespostaDemo => ({ status: 403, body: { error: RECUSA_DEMO, code: "demonstracao" } });
const naoAchou = (): RespostaDemo => ({ status: 404, body: { error: "Registro não encontrado na demonstração.", code: "not_found" } });
const ok = (body: unknown, status = 200): RespostaDemo => ({ status, body });

/** Avança todas as datas capturadas para que "hoje" na demonstração seja hoje de verdade. */
function deslocarDatas(valor: unknown, dias: number): unknown {
  if (!dias) return valor;
  const ms = dias * 86_400_000;
  const andar = (v: unknown): unknown => {
    if (typeof v === "number") return v > 1.5e12 && v < 2.5e12 ? v + ms : v;
    if (typeof v === "string") {
      const m = /^(\d{4}-\d{2}-\d{2})(T[\d:.]+Z| \d{2}:\d{2}:\d{2})?$/.exec(v);
      if (!m) return v;
      const base = new Date(`${m[1]}T12:00:00Z`);
      if (Number.isNaN(base.getTime())) return v;
      return new Date(base.getTime() + ms).toISOString().slice(0, 10) + (m[2] ?? "");
    }
    if (Array.isArray(v)) return v.map(andar);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, andar(x)]));
    return v;
  };
  return andar(valor);
}

function estadoInicial(): Record<string, RespostaDemo> {
  const gerado = new Date(capturado.geradoEm);
  const dias = Math.round((Date.now() - gerado.getTime()) / 86_400_000);
  const estado = deslocarDatas(structuredClone(capturado.respostas), dias) as Record<string, RespostaDemo>;
  // A prancha capturada nasce em branco; o desenho de exemplo entra aqui.
  for (const [caminho, resposta] of Object.entries(estado)) {
    if (/^\/api\/studio\/[0-9a-f-]{36}$/.test(caminho)) (resposta.body as { prancha: Json }).prancha.documento = plantaDeExemplo();
  }
  Object.assign(estado, financeiroDeExemplo(estado));
  completarPermissoes(estado);
  const projetos = ((estado["/api/projects"]?.body as { projects?: Array<{ id: string; code: string; name: string; kind: string }> })?.projects ?? []);
  for (const [caminho, body] of Object.entries(comprasDeExemplo(projetos))) estado[caminho] = ok(body);
  return estado;
}

/**
 * As respostas capturadas são anteriores aos módulos mais novos (Compras): a matriz de
 * permissões delas não tem a chave. Completa com o padrão do perfil, como o servidor
 * real faz ao ler a sessão.
 */
function completarPermissoes(estado: Record<string, RespostaDemo>) {
  const completar = (alvo: { role?: string; permissions?: Record<string, unknown> } | undefined) => {
    if (!alvo?.permissions) return;
    const padrao = permissionsForRole(alvo.role ?? "member");
    for (const modulo of permissionModules) if (!alvo.permissions[modulo]) alvo.permissions[modulo] = padrao[modulo];
  };
  completar((estado["/api/session"]?.body as { member?: { role?: string; permissions?: Record<string, unknown> } })?.member);
  for (const membro of ((estado["/api/members"]?.body as { members?: Array<{ role?: string; permissions?: Record<string, unknown> }> })?.members ?? [])) completar(membro);
}

/**
 * Financeiro fictício. Na plataforma estes números vêm do motor financeiro da empresa;
 * aqui são inventados, só para leitura — cobrança, nota e lançamento novos são recusados,
 * porque na demonstração nada de fiscal ou financeiro pode parecer emitido.
 */
function financeiroDeExemplo(estado: Record<string, RespostaDemo>): Record<string, RespostaDemo> {
  const projetos = ((estado["/api/projects"]?.body as { projects?: Linha[] })?.projects ?? []);
  const obra = projetos.find((p) => p.kind === "work") ?? projetos[0];
  const dia = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
  const transacoes = [
    { id: "ex-r1", type: "receivable", description: "Parcela 4/10 — Casa Jardim das Acácias", amount: 68_400, dueDate: dia(5), paidAt: null, status: "open", partyName: "Família Andrade (exemplo)", costCenterId: null },
    { id: "ex-r2", type: "receivable", description: "Projeto executivo — etapa 2", amount: 12_600, dueDate: dia(-3), paidAt: null, status: "overdue", partyName: "Marina Moreira (exemplo)", costCenterId: null },
    { id: "ex-r3", type: "receivable", description: "Medição 6 — Consultório Bem Viver", amount: 31_900, dueDate: dia(-12), paidAt: dia(-11), status: "paid", partyName: "Clínica Bem Viver Ltda. (exemplo)", costCenterId: null },
    { id: "ex-p1", type: "payable", description: "Porcelanato 80×80 — fornecedor de exemplo", amount: 22_302, dueDate: dia(8), paidAt: null, status: "open", partyName: "Revestimentos Exemplo Ltda.", costCenterId: null },
    { id: "ex-p2", type: "payable", description: "Mão de obra — alvenaria", amount: 18_321, dueDate: dia(2), paidAt: null, status: "open", partyName: "Empreiteira Exemplo ME", costCenterId: null },
    { id: "ex-p3", type: "payable", description: "Locação de andaimes", amount: 3_480, dueDate: dia(-6), paidAt: dia(-6), status: "paid", partyName: "Locadora Exemplo", costCenterId: null },
  ];
  const aberto = (tipo: string) => transacoes.filter((t) => t.type === tipo && t.status !== "paid").reduce((soma, t) => soma + t.amount, 0);
  return {
    "/api/integrations/drap/connection": ok({ connection: { id: "exemplo", externalCompanyId: "empresa-exemplo", status: "active", lastSyncedAt: new Date().toISOString(), lastError: null, webhookRegistrado: true }, capabilities: { summary: true, transactions: true, charges: true, notas: true } }),
    "/api/integrations/drap/capabilities": ok({ summary: true, transactions: true, charges: true, notas: true }),
    "/api/integrations/drap/summary": ok({ currentBalance: 184_250, receivables: aberto("receivable"), payables: aberto("payable"), projected30d: 184_250 + aberto("receivable") - aberto("payable"), overdueReceivables: 12_600, updatedAt: new Date().toISOString(), source: "drap", origem: "resumo" }),
    "/api/integrations/drap/transactions": ok({ transactions: transacoes, emptyReason: null }),
    "/api/integrations/drap/charges": ok({ charges: obra ? [{ id: "ex-c1", projectId: obra.id, projectName: obra.name, clientName: obra.clientName ?? null, description: "Parcela 4/10 da obra", amountCents: 6_840_000, dueDate: dia(5), reminders: { daysBefore: 3, onDueDate: true }, status: "created", externalChargeId: "exemplo-0001", shareUrl: null, lastError: null, createdAt: new Date().toISOString() }] : [] }),
    "/api/integrations/drap/nfse": ok({ notas: [], sincronizado: true }),
    "/api/integrations/drap/lancamentos": ok({ items: transacoes.map((t) => ({ id: t.id, data: t.dueDate, descricao: t.description, tipo: t.type === "payable" ? "despesa" : "receita", valor: t.amount, status: t.status === "paid" ? "pago" : "pendente" })), total: transacoes.length }),
    "/api/integrations/drap/categorias": ok({ items: [], total: 0 }),
    "/api/integrations/drap/parceiros": ok({ items: [], total: 0 }),
  };
}

const agoraIso = () => new Date().toISOString();
const novoId = () => crypto.randomUUID();

export class ServidorDemo {
  private estado: Record<string, RespostaDemo>;

  constructor() {
    let salvo: Record<string, RespostaDemo> | null = null;
    try { const texto = window.sessionStorage.getItem(CHAVE); if (texto) salvo = JSON.parse(texto) as Record<string, RespostaDemo>; } catch { salvo = null; }
    this.estado = salvo ?? estadoInicial();
  }

  /** Descarta as edições do visitante e volta aos dados de exemplo. */
  static recomecar() { try { window.sessionStorage.removeItem(CHAVE); } catch { /* aba sem armazenamento */ } }

  private gravar() { try { window.sessionStorage.setItem(CHAVE, JSON.stringify(this.estado)); } catch { /* sem espaço: segue só em memória */ } }
  private corpo<T = Json>(caminho: string): T { return (this.estado[caminho]?.body ?? {}) as T; }
  private lista(caminho: string, campo: string): Linha[] { const corpo = this.corpo(caminho); if (!Array.isArray(corpo[campo])) corpo[campo] = []; return corpo[campo] as Linha[]; }
  private nomeDe(caminho: string, campo: string, id: unknown, chave = "name"): string | null {
    return (this.lista(caminho, campo).find((item) => item.id === id)?.[chave] as string | undefined) ?? null;
  }
  private eu() { const sessao = this.corpo<{ member: { id: string }; user: { displayName: string } }>("/api/session"); return { id: sessao.member.id, nome: this.nomeDe("/api/members", "members", sessao.member.id) ?? sessao.user.displayName }; }

  responder(metodo: string, url: string, corpo: unknown): RespostaDemo {
    const endereco = new URL(url, "https://demonstracao.local");
    const caminho = endereco.pathname.replace(/\/$/, "");
    const leitura = metodo === "GET" || metodo === "HEAD";
    const resposta = leitura ? this.ler(caminho, endereco.searchParams) : this.escrever(metodo, caminho, (corpo ?? {}) as Json);
    if (!leitura && resposta.status < 400) this.gravar();
    return structuredClone(resposta);
  }

  // ── leituras ──────────────────────────────────────────────────────────────────────
  private ler(caminho: string, busca: URLSearchParams): RespostaDemo {
    if (caminho === "/api/tasks" || caminho === "/api/schedule") {
      const projeto = busca.get("projectId");
      const tarefas = this.lista("/api/tasks", "tasks");
      return ok({ tasks: projeto ? tarefas.filter((t) => t.projectId === projeto) : tarefas });
    }
    if (caminho === "/api/diary") {
      const projeto = busca.get("projectId");
      const entradas = this.lista("/api/diary", "entries").filter((e) => !projeto || e.projectId === projeto);
      return ok({ ...this.corpo<Json>("/api/diary"), entries: entradas, total: entradas.length });
    }
    if (caminho === "/api/files") {
      const projeto = busca.get("projectId");
      return ok({ ...this.corpo<Json>("/api/files"), files: this.lista("/api/files", "files").filter((f) => !projeto || f.projectId === projeto) });
    }
    if (caminho === "/api/integrations/sinapi/items") return ok({ items: [] });
    // O catálogo de materiais padrão é o mesmo da plataforma (código, não dado fictício):
    // sem termo abre inteiro, em páginas de 50, como na conta da empresa.
    if (caminho === "/api/compras/catalogo" && (busca.get("fonte") ?? "padrao") === "padrao") {
      const termo = (busca.get("q") ?? "").trim();
      const pagina = Math.max(1, Number(busca.get("pagina") ?? 1) || 1);
      const todos = termo ? buscarMaterialPadrao(termo, Number.MAX_SAFE_INTEGER) : MATERIAIS_PADRAO;
      return ok({ items: todos.slice((pagina - 1) * 50, pagina * 50).map((m) => ({ source: "padrao", reference: `PADRAO:${m.codigo}`, code: m.codigo, description: m.nome, unit: m.unidade, unitCostCents: null, label: m.norma, category: m.categoria, specification: m.especificacao })),
        total: todos.length, page: pagina, pageSize: 50, emptyReason: todos.length ? null : "Nenhum material padrão corresponde à busca.", goinfraTables: [] });
    }
    if (caminho === "/api/conversas") {
      const conversas = this.corpo<Json>("/api/conversas");
      return ok({ ...conversas, unreadTotal: 0 });
    }
    const mensagens = /^\/api\/conversas\/([^/]+)\/mensagens$/.exec(caminho);
    if (mensagens) {
      const todas = this.lista(caminho, "messages");
      const desde = busca.get("since");
      return ok({ messages: desde ? todas.filter((m) => String(m.editedAt ?? m.createdAt) > desde) : todas, cursor: agoraIso(), hasMore: false });
    }
    const diario = /^\/api\/diary\/([0-9a-f-]{36})$/.exec(caminho);
    if (diario) {
      const entrada = this.lista("/api/diary", "entries").find((e) => e.id === diario[1]);
      return entrada ? ok({ entry: entrada, photos: [], revisions: [], nextHistoryBefore: null }) : naoAchou();
    }
    const oportunidade = /^\/api\/crm\/([0-9a-f-]{36})$/.exec(caminho);
    if (oportunidade) { const item = this.lista("/api/crm", "opportunities").find((o) => o.id === oportunidade[1]); return item ? ok({ opportunity: item }) : naoAchou(); }
    const cliente = /^\/api\/clients\/([0-9a-f-]{36})$/.exec(caminho);
    if (cliente) { const item = this.lista("/api/clients", "clients").find((c) => c.id === cliente[1]); return item ? ok({ client: item }) : naoAchou(); }
    const guardado = this.estado[caminho];
    if (guardado) return guardado;
    if (caminho.startsWith("/api/")) return ok({ error: "Indisponível na demonstração.", code: "demonstracao" }, 404);
    return naoAchou();
  }

  // ── escritas: mudam só o estado desta aba ─────────────────────────────────────────
  private escrever(metodo: string, caminho: string, dados: Json): RespostaDemo {
    const partes = caminho.split("/").slice(2); // ["clients", ":id", ...]
    const [recurso, id, sub] = partes;

    // Sinais que a interface manda e não precisam de resposta com conteúdo.
    if (recurso === "usage" || recurso === "terms") return ok({ ok: true });
    if (recurso === "session") return ok(this.corpo("/api/session"));
    if (recurso === "auth" && metodo === "DELETE") return ok({ ok: true });

    if (recurso === "reminders" && metodo === "POST") {
      const agenda = this.corpo<{ reminders: Array<Json & { key: string }>; seen: boolean; dismissedCount: number }>("/api/reminders");
      if (dados.state === "seen") agenda.seen = true;
      else { const antes = agenda.reminders.length; agenda.reminders = agenda.reminders.filter((item) => item.key !== dados.itemKey); agenda.dismissedCount += antes - agenda.reminders.length; }
      return ok(agenda);
    }

    if (recurso === "clients") return this.clientes(metodo, id, dados);
    if (recurso === "projects") return this.projetos(metodo, id, dados);
    if (recurso === "tasks") return this.tarefas(metodo, id, dados);
    if (recurso === "crm") return this.funil(metodo, id, dados);
    if (recurso === "budgets") return this.orcamentos(metodo, id, sub, dados);
    if (recurso === "layouts") return this.layouts(metodo, id, dados);
    if (recurso === "studio" && id !== "assets" && id !== "importar") return this.pranchas(metodo, id, dados);
    if (recurso === "conversas") return this.conversas(metodo, partes, dados);
    return recusa();
  }

  private clientes(metodo: string, id: string | undefined, dados: Json): RespostaDemo {
    const lista = this.lista("/api/clients", "clients");
    if (metodo === "POST" && !id) {
      if (String(dados.name ?? "").trim().length < 2) return ok({ error: "Revise os campos informados.", code: "validation_error", details: { name: ["Informe o nome."] } }, 400);
      const cliente: Linha = { id: novoId(), name: String(dados.name).trim(), document: dados.document ?? null, email: dados.email ?? null, phone: dados.phone ?? null, notes: dados.notes ?? "", externalFinancialId: null, createdAt: agoraIso(), updatedAt: agoraIso() };
      lista.unshift(cliente);
      return ok({ client: cliente }, 201);
    }
    const cliente = lista.find((item) => item.id === id);
    if (!cliente) return naoAchou();
    if (metodo === "PATCH") {
      Object.assign(cliente, dados, { updatedAt: agoraIso() });
      for (const projeto of this.lista("/api/projects", "projects")) if (projeto.clientId === id) projeto.clientName = cliente.name;
      for (const item of this.lista("/api/crm", "opportunities")) if (item.clientId === id) item.clientName = cliente.name;
      return ok({ client: cliente });
    }
    return recusa();
  }

  private projetos(metodo: string, id: string | undefined, dados: Json): RespostaDemo {
    const lista = this.lista("/api/projects", "projects");
    const completar = (projeto: Linha) => {
      projeto.clientName = projeto.clientId ? this.nomeDe("/api/clients", "clients", projeto.clientId) : null;
      projeto.ownerName = projeto.ownerMemberId ? this.nomeDe("/api/members", "members", projeto.ownerMemberId) : null;
      projeto.updatedAt = agoraIso();
      this.estado[`/api/projects/${projeto.id}`] = ok({ project: projeto });
      for (const tarefa of this.lista("/api/tasks", "tasks")) if (tarefa.projectId === projeto.id) tarefa.projectName = projeto.name;
    };
    if (metodo === "POST" && !id) {
      const codigo = String(dados.code ?? "").trim();
      if (codigo.length < 2 || String(dados.name ?? "").trim().length < 3) return ok({ error: "Revise os campos informados.", code: "validation_error" }, 400);
      if (lista.some((item) => item.code === codigo)) return ok({ error: "Já existe um projeto com este código.", code: "project_code_conflict" }, 409);
      const projeto: Linha = {
        id: novoId(), clientId: dados.clientId ?? null, clientName: null, code: codigo, name: String(dados.name).trim(), kind: dados.kind === "work" ? "work" : "project",
        status: dados.status ?? "active", phase: dados.phase ?? "briefing", progressPercent: Number(dados.progressPercent ?? 0), ownerMemberId: dados.ownerMemberId ?? null, ownerName: null,
        startDate: dados.startDate ?? null, targetDate: dados.targetDate ?? null, budgetCents: Number(dados.budgetCents ?? 0), externalFinancialCostCenterId: null, createdAt: agoraIso(), updatedAt: agoraIso(),
      };
      lista.unshift(projeto); completar(projeto);
      return ok({ project: projeto }, 201);
    }
    const projeto = lista.find((item) => item.id === id);
    if (!projeto) return naoAchou();
    if (metodo === "PATCH") { Object.assign(projeto, dados); completar(projeto); return ok({ project: projeto }); }
    return recusa();
  }

  private tarefas(metodo: string, id: string | undefined, dados: Json): RespostaDemo {
    const lista = this.lista("/api/tasks", "tasks");
    const completar = (tarefa: Linha) => {
      tarefa.projectName = this.nomeDe("/api/projects", "projects", tarefa.projectId) ?? tarefa.projectName ?? "";
      tarefa.assigneeName = tarefa.assigneeMemberId ? this.nomeDe("/api/members", "members", tarefa.assigneeMemberId) : null;
      tarefa.completedAt = tarefa.status === "done" ? tarefa.completedAt ?? agoraIso() : null;
      tarefa.updatedAt = agoraIso();
    };
    if (metodo === "POST" && !id) {
      if (String(dados.title ?? "").trim().length < 3 || !dados.projectId) return ok({ error: "Revise os campos informados.", code: "validation_error" }, 400);
      const tarefa: Linha = {
        id: novoId(), projectId: dados.projectId, projectName: "", title: String(dados.title).trim(), description: dados.description ?? "", status: dados.status ?? "todo",
        priority: dados.priority ?? "normal", assigneeMemberId: dados.assigneeMemberId ?? null, assigneeName: null, parentTaskId: dados.parentTaskId ?? null,
        startsAt: dados.startsAt ?? null, dueAt: dados.dueAt ?? null, estimatedMinutes: Number(dados.estimatedMinutes ?? 0), completedAt: null, createdAt: agoraIso(), updatedAt: agoraIso(),
      };
      completar(tarefa); lista.unshift(tarefa);
      return ok({ task: tarefa }, 201);
    }
    const indice = lista.findIndex((item) => item.id === id);
    if (indice < 0) return naoAchou();
    if (metodo === "PATCH") { Object.assign(lista[indice], dados); completar(lista[indice]); return ok({ task: lista[indice] }); }
    if (metodo === "DELETE") { lista.splice(indice, 1); return ok({ deleted: true }); }
    return recusa();
  }

  private funil(metodo: string, id: string | undefined, dados: Json): RespostaDemo {
    const lista = this.lista("/api/crm", "opportunities");
    const completar = (item: Linha) => {
      item.clientName = this.nomeDe("/api/clients", "clients", item.clientId);
      item.ownerName = item.ownerMemberId ? this.nomeDe("/api/members", "members", item.ownerMemberId) : null;
      item.updatedAt = agoraIso();
    };
    if (metodo === "POST" && !id) {
      if (!dados.clientId || String(dados.title ?? "").trim().length < 3) return ok({ error: "Revise os campos informados.", code: "validation_error" }, 400);
      const item: Linha = {
        id: novoId(), clientId: dados.clientId, clientName: null, title: String(dados.title).trim(), stage: dados.stage ?? "new", estimatedValueCents: Number(dados.estimatedValueCents ?? 0),
        probabilityPercent: Number(dados.probabilityPercent ?? 0), ownerMemberId: dados.ownerMemberId ?? null, ownerName: null, nextAction: dados.nextAction ?? null, nextActionAt: dados.nextActionAt ?? null,
        wonProjectId: null, wonProjectName: null, lostReason: null, createdAt: agoraIso(), updatedAt: agoraIso(),
      };
      completar(item); lista.unshift(item);
      return ok({ opportunity: item }, 201);
    }
    const indice = lista.findIndex((item) => item.id === id);
    if (indice < 0) return naoAchou();
    const item = lista[indice];
    if (metodo === "PATCH") { Object.assign(item, dados); completar(item); return ok({ opportunity: item }); }
    if (metodo === "DELETE") { lista.splice(indice, 1); return ok({ deleted: true }); }
    if (metodo === "POST") {
      // Conversão em projeto ou obra, como na plataforma: cria o trabalho e marca o negócio como ganho.
      const criado = this.projetos("POST", undefined, { ...dados, clientId: item.clientId, name: dados.name ?? item.title, budgetCents: item.estimatedValueCents });
      if (criado.status >= 400) return criado;
      const projeto = (criado.body as { project: Linha }).project;
      Object.assign(item, { stage: "won", probabilityPercent: 100, wonProjectId: projeto.id, wonProjectName: projeto.name });
      completar(item);
      return ok({ projectId: projeto.id, opportunity: item }, 201);
    }
    return recusa();
  }

  private orcamentos(metodo: string, id: string | undefined, sub: string | undefined, dados: Json): RespostaDemo {
    const lista = this.lista("/api/budgets", "budgets");
    if (metodo === "POST" && !id) {
      if (!dados.projectId || String(dados.code ?? "").trim().length < 2) return ok({ error: "Revise os campos informados.", code: "validation_error" }, 400);
      const anteriores = lista.filter((item) => item.projectId === dados.projectId && item.code === dados.code).length;
      const orcamento: Linha = {
        id: novoId(), projectId: dados.projectId, projectName: this.nomeDe("/api/projects", "projects", dados.projectId), code: String(dados.code).trim(), version: anteriores + 1, status: "draft",
        directCostCents: 0, bdiPercent: Number(dados.bdiPercent ?? 0), marginPercent: Number(dados.marginPercent ?? 0), totalCents: 0, itemCount: 0, createdAt: agoraIso(), updatedAt: agoraIso(),
      };
      lista.unshift(orcamento);
      this.estado[`/api/budgets/${orcamento.id}/items`] = ok({ items: [] });
      return ok({ budget: orcamento }, 201);
    }
    const orcamento = lista.find((item) => item.id === id);
    if (!orcamento) return naoAchou();
    const itens = this.lista(`/api/budgets/${id}/items`, "items");
    const somar = () => {
      orcamento.directCostCents = itens.reduce((soma, item) => soma + Math.round(Number(item.quantity) * Number(item.unitCostCents)), 0);
      orcamento.totalCents = itens.reduce((soma, item) => soma + Number(item.totalCents), 0);
      orcamento.itemCount = itens.length; orcamento.updatedAt = agoraIso();
    };
    if (sub === "items" && metodo === "POST") {
      if (orcamento.status !== "draft") return ok({ error: "Orçamento enviado não aceita novos itens. Copie para um novo rascunho.", code: "budget_locked" }, 409);
      const fator = (1 + Number(orcamento.bdiPercent) / 100) * (1 + Number(orcamento.marginPercent) / 100);
      for (const novo of (dados.items as Json[] | undefined) ?? []) {
        const custo = Number(novo.unitCostCents ?? 0);
        const preco = novo.unitPriceCents == null ? Math.round(custo * fator) : Number(novo.unitPriceCents);
        const quantidade = Number(novo.quantity ?? 1);
        itens.push({ id: novoId(), code: novo.code ?? null, description: String(novo.description ?? ""), unit: novo.unit ?? "un", quantity: quantidade, unitCostCents: custo, unitPriceCents: preco, source: novo.source ?? "manual", sourceReference: novo.sourceReference ?? null, sortOrder: itens.length, totalCents: Math.round(quantidade * preco) });
      }
      somar();
      return ok({ items: itens }, 201);
    }
    if (!sub && metodo === "PATCH") { Object.assign(orcamento, dados, { updatedAt: agoraIso() }); return ok({ budget: orcamento }); }
    if (sub === "copy" && metodo === "POST") {
      const copia: Linha = { ...orcamento, id: novoId(), version: Math.max(...lista.filter((item) => item.code === orcamento.code).map((item) => Number(item.version))) + 1, status: "draft", createdAt: agoraIso(), updatedAt: agoraIso() };
      lista.unshift(copia);
      this.estado[`/api/budgets/${copia.id}/items`] = ok({ items: itens.map((item) => ({ ...item, id: novoId() })) });
      return ok({ budget: copia }, 201);
    }
    return recusa();
  }

  private layouts(metodo: string, id: string | undefined, dados: Json): RespostaDemo {
    const lista = this.lista("/api/layouts", "layouts");
    const autor = this.eu().nome;
    const resumo = (base: Json, conteudo: LayoutConteudo): Linha => ({
      ...base, id: String(base.id), projectCode: this.nomeDe("/api/projects", "projects", base.projectId, "code"), projectName: this.nomeDe("/api/projects", "projects", base.projectId),
      itens: conteudo.itens.length, comodos: conteudo.comodos.length, areaM2: Math.round(conteudo.comodos.reduce((soma, c) => soma + areaM2(c.pontos), 0) * 100) / 100,
    });
    if (metodo === "POST" && !id) {
      const origem = dados.duplicarDe ? this.corpo<{ layout?: Json & { content: LayoutConteudo } }>(`/api/layouts/${dados.duplicarDe}`).layout : null;
      const conteudo = origem ? structuredClone(origem.content) : dados.modelo && dados.modelo !== "vazio" ? layoutDoModelo(dados.modelo as "casa-garagem" | "apartamento") : layoutVazio();
      const novo = resumo({ id: novoId(), name: String(dados.name ?? "Layout").trim(), projectId: dados.projectId ?? null, revision: 1, createdByName: autor, updatedByName: autor, createdAt: agoraIso(), updatedAt: agoraIso() }, conteudo);
      lista.unshift(novo);
      this.estado[`/api/layouts/${novo.id}`] = ok({ layout: { ...novo, content: conteudo } });
      return ok({ layout: { ...novo, content: conteudo } }, 201);
    }
    const indice = lista.findIndex((item) => item.id === id);
    if (indice < 0) return naoAchou();
    if (metodo === "PUT") {
      if (Number(dados.revision) !== Number(lista[indice].revision)) return ok({ error: "Este layout foi alterado em outra aba. Recarregue para continuar.", code: "revision_conflict" }, 409);
      const conteudo = dados.content as LayoutConteudo;
      const salvo = resumo({ ...lista[indice], name: dados.name ?? lista[indice].name, projectId: dados.projectId ?? null, revision: Number(lista[indice].revision) + 1, updatedByName: autor, updatedAt: agoraIso() }, conteudo);
      lista[indice] = salvo;
      this.estado[`/api/layouts/${id}`] = ok({ layout: { ...salvo, content: conteudo } });
      return ok({ layout: { ...salvo, content: conteudo } });
    }
    if (metodo === "DELETE") { lista.splice(indice, 1); delete this.estado[`/api/layouts/${id}`]; return ok({ deleted: true }); }
    return recusa();
  }

  private pranchas(metodo: string, id: string | undefined, dados: Json): RespostaDemo {
    const lista = this.lista("/api/studio", "pranchas");
    const autor = this.eu().nome;
    if (metodo === "POST" && !id) {
      const prancha: Linha = {
        id: novoId(), nome: String(dados.nome ?? "Prancha").trim(), especie: dados.especie ?? "planta", revisao: 1, projectId: dados.projectId ?? null,
        projectName: this.nomeDe("/api/projects", "projects", dados.projectId), projectCode: this.nomeDe("/api/projects", "projects", dados.projectId, "code"), autor, criadoEm: agoraIso(), atualizadoEm: agoraIso(),
      };
      lista.unshift(prancha);
      this.estado[`/api/studio/${prancha.id}`] = ok({ prancha: { ...prancha, documento: dados.documento ?? documentoVazio() } });
      return ok({ prancha }, 201);
    }
    const indice = lista.findIndex((item) => item.id === id);
    if (indice < 0) return naoAchou();
    if (metodo === "PUT") {
      const aberta = this.corpo<{ prancha: Json }>(`/api/studio/${id}`).prancha;
      // Desenho muito grande trafega comprimido e não é lido aqui: a revisão avança sem trocar o conteúdo.
      const salva = { ...aberta, ...lista[indice], nome: dados.nome ?? lista[indice].nome, revisao: Number(lista[indice].revisao) + 1, atualizadoEm: agoraIso(), documento: dados.documento ?? aberta.documento };
      const { documento: _documento, ...semDocumento } = salva; void _documento;
      lista[indice] = semDocumento as Linha;
      this.estado[`/api/studio/${id}`] = ok({ prancha: salva });
      return ok({ prancha: salva });
    }
    if (metodo === "DELETE") { lista.splice(indice, 1); delete this.estado[`/api/studio/${id}`]; return ok({ deleted: true }); }
    return recusa();
  }

  private conversas(metodo: string, partes: string[], dados: Json): RespostaDemo {
    const eu = this.eu();
    if (partes[2] === "mensagens" && metodo === "POST") {
      const caminho = `/api/conversas/${partes[1]}/mensagens`;
      if (!this.estado[caminho]) return naoAchou();
      const texto = String(dados.body ?? "").trim();
      if (!texto) return ok({ error: "Escreva a mensagem.", code: "validation_error" }, 400);
      if (Array.isArray(dados.fileIds) && dados.fileIds.length) return recusa();
      const mensagens = this.lista(caminho, "messages");
      const repetida = mensagens.find((m) => m.clientKey === dados.clientKey);
      if (repetida) return ok({ message: repetida });
      const mensagem: Linha = { id: novoId(), channelId: partes[1], authorMemberId: eu.id, authorName: eu.nome, clientKey: dados.clientKey ?? novoId(), body: texto, kind: "mensagem", createdAt: agoraIso(), editedAt: null, deleted: false, mine: true, canEdit: true, canDelete: true, files: [], reminder: null };
      mensagens.push(mensagem);
      const conversa = this.lista("/api/conversas", "conversations").find((c) => c.id === partes[1]);
      if (conversa) Object.assign(conversa, { lastMessageAt: mensagem.createdAt, lastPreview: `${eu.nome}: ${texto.slice(0, 80)}` });
      return ok({ message: mensagem }, 201);
    }
    if (partes[1] === "mensagens" && partes[2]) {
      for (const [caminho, resposta] of Object.entries(this.estado)) {
        if (!/^\/api\/conversas\/[^/]+\/mensagens$/.test(caminho)) continue;
        const mensagens = (resposta.body as { messages: Linha[] }).messages;
        const mensagem = mensagens.find((m) => m.id === partes[2]);
        if (!mensagem) continue;
        if (metodo === "PATCH") { Object.assign(mensagem, { body: String(dados.body ?? "").trim(), editedAt: agoraIso() }); return ok({ message: mensagem }); }
        if (metodo === "DELETE") { Object.assign(mensagem, { body: "", deleted: true, editedAt: agoraIso(), canEdit: false, canDelete: false }); return ok({ deleted: true }); }
      }
      return naoAchou();
    }
    return recusa();
  }
}
