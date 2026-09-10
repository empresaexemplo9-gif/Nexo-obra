import {
  ApiError,
  apiRoute,
  requireModulePermission,
  requireOrganizationContext,
} from "@/lib/server/backend";

export const dynamic = "force-dynamic";

// Tabelas reais da empresa, prontas para colar na planilha. Os valores monetários saem
// daqui já em reais com centavos, para que a soma da planilha seja a soma do banco.
const sources = {
  budget: {
    label: "Itens de orçamento",
    module: "budgets" as const,
    headers: ["Código", "Descrição", "Unidade", "Quantidade", "Custo unitário", "Preço unitário", "Total"],
    sql: `SELECT i.code, i.description, i.unit, i.quantity, i.unit_cost_cents, i.unit_price_cents
          FROM budget_items i INNER JOIN budget_versions v ON v.id = i.budget_version_id
          WHERE v.organization_id = ?1 ORDER BY v.updated_at DESC, i.sort_order LIMIT 1000`,
    map: (row: Record<string, unknown>) => [
      String(row.code ?? ""), String(row.description ?? ""), String(row.unit ?? ""),
      Number(row.quantity ?? 0), Number(row.unit_cost_cents ?? 0) / 100, Number(row.unit_price_cents ?? 0) / 100,
      { formula: (line: number) => `=D${line}*F${line}` },
    ],
  },
  projects: {
    label: "Projetos e obras",
    module: "projects" as const,
    headers: ["Código", "Nome", "Tipo", "Situação", "Fase", "Avanço %", "Orçamento"],
    sql: `SELECT code, name, kind, status, phase, progress_percent, budget_cents
          FROM projects WHERE organization_id = ?1 ORDER BY updated_at DESC LIMIT 1000`,
    map: (row: Record<string, unknown>) => [
      String(row.code ?? ""), String(row.name ?? ""), row.kind === "work" ? "Obra" : "Projeto",
      String(row.status ?? ""), String(row.phase ?? ""), Number(row.progress_percent ?? 0),
      Number(row.budget_cents ?? 0) / 100,
    ],
  },
  clients: {
    label: "Clientes",
    module: "crm" as const,
    headers: ["Nome", "Documento", "E-mail", "Telefone"],
    sql: `SELECT name, document, email, phone FROM clients WHERE organization_id = ?1 ORDER BY name LIMIT 1000`,
    map: (row: Record<string, unknown>) => [
      String(row.name ?? ""), String(row.document ?? ""), String(row.email ?? ""), String(row.phone ?? ""),
    ],
  },
  tasks: {
    label: "Tarefas",
    module: "tasks" as const,
    headers: ["Tarefa", "Projeto", "Situação", "Prioridade", "Prazo"],
    sql: `SELECT t.title, p.name AS project_name, t.status, t.priority, t.due_at
          FROM tasks t LEFT JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
          WHERE t.organization_id = ?1 ORDER BY t.due_at IS NULL, t.due_at LIMIT 1000`,
    map: (row: Record<string, unknown>) => [
      String(row.title ?? ""), String(row.project_name ?? ""), String(row.status ?? ""),
      String(row.priority ?? ""), row.due_at ? new Date(String(row.due_at)).toLocaleDateString("pt-BR") : "",
    ],
  },
};

export type WorksheetSourceId = keyof typeof sources;

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const url = new URL(request.url);
    const requested = url.searchParams.get("source");
    if (!requested) {
      return Response.json({
        sources: Object.entries(sources)
          .filter(([, source]) => context.member.permissions[source.module].view)
          .map(([id, source]) => ({ id, label: source.label, headers: source.headers })),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const source = sources[requested as WorksheetSourceId];
    if (!source) throw new ApiError(404, "unknown_source", "Essa origem de dados não existe.");
    requireModulePermission(context, source.module, "view");

    const result = await context.db.prepare(source.sql).bind(context.organization.id).all<Record<string, unknown>>();
    // A primeira linha do bloco colado é o cabeçalho, então as fórmulas começam abaixo.
    const startLine = Number(url.searchParams.get("startLine") ?? 1) + 1;
    const rows = result.results.map((row, index) => source.map(row).map((cell) =>
      typeof cell === "object" && cell !== null && "formula" in cell
        ? (cell as { formula: (line: number) => string }).formula(startLine + index)
        : cell));

    return Response.json({
      source: requested, label: source.label, headers: source.headers, rows,
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
