import { requireModulePermission, type OrganizationContext } from "@/lib/server/backend";
import { pendingChatReminders } from "@/lib/server/chat";
import { usageDayKey, usageDayStart } from "@/lib/server/usage";

// Lembretes do dia. Nada aqui inventa pendência: cada item aponta para um registro real
// e some sozinho quando o registro deixa de estar pendente. Dispensar vale só para o dia.

export type ReminderSeverity = "atrasado" | "hoje" | "proximo";
export type ReminderGroup = "cobranca" | "boleto" | "followup" | "proposta" | "tarefa" | "meta" | "recado";

export type Reminder = {
  key: string;
  group: ReminderGroup;
  severity: ReminderSeverity;
  title: string;
  detail: string;
  amountCents: number | null;
  dueDay: string | null;
  module: string;
  entityId: string;
};

export const GOAL_METRICS = {
  tasks_done: { label: "Tarefas concluídas", unit: "count", money: false },
  clients_new: { label: "Clientes novos", unit: "count", money: false },
  projects_done: { label: "Trabalhos entregues", unit: "count", money: false },
  opportunities_won: { label: "Oportunidades ganhas", unit: "count", money: false },
  budgets_approved_cents: { label: "Orçamentos aprovados (R$)", unit: "cents", money: true },
  charges_amount_cents: { label: "Cobranças emitidas (R$)", unit: "cents", money: true },
} as const;

export type GoalMetric = keyof typeof GOAL_METRICS;

type GoalRow = {
  id: string; name: string; metric: string; target_value: number; period_start: string;
  period_end: string; owner_member_id: string | null; created_by_name: string; active: number;
};

const HORIZON_DAYS = 7;

function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function severityFor(dueDay: string | null, today: string): ReminderSeverity {
  if (!dueDay) return "proximo";
  if (dueDay < today) return "atrasado";
  return dueDay === today ? "hoje" : "proximo";
}

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00.000Z`).toLocaleDateString("pt-BR");

// O realizado de uma meta vem sempre da tabela dona do dado, nunca de um contador à parte.
async function goalProgress(context: OrganizationContext, goal: GoalRow) {
  const { db, organization } = context;
  const owner = goal.owner_member_id;

  switch (goal.metric as GoalMetric) {
    // Todas guardam data como texto (ISO ou CURRENT_TIMESTAMP). Comparar com milissegundos,
    // como era antes, nunca casava: essas três metas ficavam em zero para sempre.
    case "tasks_done": {
      const row = await db.prepare(
        `SELECT COUNT(*) AS total FROM tasks WHERE organization_id = ?1 AND status = 'done'
         AND substr(completed_at, 1, 10) BETWEEN ?2 AND ?3 AND (?4 IS NULL OR assignee_member_id = ?4)`,
      ).bind(organization.id, goal.period_start, goal.period_end, owner).first<{ total: number }>();
      return Number(row?.total ?? 0);
    }
    case "clients_new": {
      const row = await db.prepare(
        "SELECT COUNT(*) AS total FROM clients WHERE organization_id = ?1 AND substr(created_at, 1, 10) BETWEEN ?2 AND ?3",
      ).bind(organization.id, goal.period_start, goal.period_end).first<{ total: number }>();
      return Number(row?.total ?? 0);
    }
    case "projects_done": {
      // O status de obra concluída é 'completed'; 'done' é o das tarefas.
      const row = await db.prepare(
        `SELECT COUNT(*) AS total FROM projects WHERE organization_id = ?1 AND status = 'completed'
         AND substr(updated_at, 1, 10) BETWEEN ?2 AND ?3 AND (?4 IS NULL OR owner_member_id = ?4)`,
      ).bind(organization.id, goal.period_start, goal.period_end, owner).first<{ total: number }>();
      return Number(row?.total ?? 0);
    }
    // As tabelas abaixo guardam data como texto, então a comparação é pelo trecho AAAA-MM-DD.
    case "opportunities_won": {
      const row = await db.prepare(
        `SELECT COUNT(*) AS total FROM crm_opportunities WHERE organization_id = ?1 AND stage = 'won'
         AND substr(updated_at, 1, 10) BETWEEN ?2 AND ?3 AND (?4 IS NULL OR owner_member_id = ?4)`,
      ).bind(organization.id, goal.period_start, goal.period_end, owner).first<{ total: number }>();
      return Number(row?.total ?? 0);
    }
    case "budgets_approved_cents": {
      const row = await db.prepare(
        `SELECT COALESCE(SUM(total_cents), 0) AS total FROM budget_versions
         WHERE organization_id = ?1 AND approved_at IS NOT NULL
         AND substr(approved_at, 1, 10) BETWEEN ?2 AND ?3`,
      ).bind(organization.id, goal.period_start, goal.period_end).first<{ total: number }>();
      return Number(row?.total ?? 0);
    }
    default: {
      const row = await db.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM financial_charge_requests
         WHERE organization_id = ?1 AND status != 'failed' AND substr(created_at, 1, 10) BETWEEN ?2 AND ?3`,
      ).bind(organization.id, goal.period_start, goal.period_end).first<{ total: number }>();
      return Number(row?.total ?? 0);
    }
  }
}

function may(context: OrganizationContext, module: Parameters<typeof requireModulePermission>[1]) {
  return context.member.permissions[module].view;
}

export async function dailyReminders(context: OrganizationContext, now = Date.now()) {
  const today = usageDayKey(now, context.organization.timezone);
  const horizon = addDays(today, HORIZON_DAYS);
  const { db, organization } = context;
  const reminders: Reminder[] = [];

  if (may(context, "finance")) {
    // Boletos e cobranças guardam a data de vencimento como texto AAAA-MM-DD.
    const charges = await db.prepare(
      `SELECT r.id, r.description, r.amount_cents, r.due_date, r.status, p.name AS project_name
       FROM financial_charge_requests r
       LEFT JOIN projects p ON p.id = r.project_id AND p.organization_id = r.organization_id
       WHERE r.organization_id = ?1 AND r.status NOT IN ('paid', 'cancelled')
       ORDER BY r.due_date LIMIT 200`,
    ).bind(organization.id).all<{ id: string; description: string; amount_cents: number; due_date: string | null; status: string; project_name: string | null }>();

    for (const charge of charges.results) {
      const due = charge.due_date ? charge.due_date.slice(0, 10) : null;
      if (["pending", "failed"].includes(charge.status)) {
        reminders.push({
          key: `cobranca:${charge.id}`, group: "cobranca",
          severity: charge.status === "failed" ? "atrasado" : severityFor(due, today),
          title: charge.status === "failed" ? `Refazer cobrança: ${charge.description}` : `Confirmar cobrança: ${charge.description}`,
          detail: `${money(Number(charge.amount_cents))}${charge.project_name ? ` · ${charge.project_name}` : ""}${charge.status === "failed" ? " · a Drap não confirmou" : " · aguardando confirmação da Drap"}`,
          amountCents: Number(charge.amount_cents), dueDay: due, module: "finance", entityId: charge.id,
        });
        continue;
      }
      if (due && due <= horizon) {
        reminders.push({
          key: `boleto:${charge.id}`, group: "boleto", severity: severityFor(due, today),
          title: due < today ? `Boleto vencido: ${charge.description}` : `Boleto a vencer: ${charge.description}`,
          detail: `${money(Number(charge.amount_cents))} · vence ${dayLabel(due)}${charge.project_name ? ` · ${charge.project_name}` : ""}`,
          amountCents: Number(charge.amount_cents), dueDay: due, module: "finance", entityId: charge.id,
        });
      }
    }
  }

  if (may(context, "crm")) {
    const opportunities = await db.prepare(
      `SELECT o.id, o.title, o.next_action, o.next_action_at, o.estimated_value_cents, c.name AS client_name
       FROM crm_opportunities o
       LEFT JOIN clients c ON c.id = o.client_id AND c.organization_id = o.organization_id
       WHERE o.organization_id = ?1 AND o.stage NOT IN ('won', 'lost')
         AND o.next_action_at IS NOT NULL AND substr(o.next_action_at, 1, 10) <= ?2
       ORDER BY o.next_action_at LIMIT 200`,
    ).bind(organization.id, horizon).all<{ id: string; title: string; next_action: string | null; next_action_at: string; estimated_value_cents: number; client_name: string | null }>();

    for (const opportunity of opportunities.results) {
      const due = opportunity.next_action_at.slice(0, 10);
      reminders.push({
        key: `followup:${opportunity.id}`, group: "followup", severity: severityFor(due, today),
        title: `Retomar contato: ${opportunity.title}`,
        detail: `${opportunity.next_action ?? "Sem próximo passo descrito"}${opportunity.client_name ? ` · ${opportunity.client_name}` : ""} · ${dayLabel(due)}`,
        amountCents: Number(opportunity.estimated_value_cents ?? 0) || null, dueDay: due, module: "crm", entityId: opportunity.id,
      });
    }
  }

  if (may(context, "budgets")) {
    // Proposta: hora de enviar o que foi agendado, e aviso de que o cliente abriu ou
    // aceitou. O aviso some quando alguém da equipe abre a proposta na aba Propostas.
    const horizonEnd = usageDayStart(horizon, organization.timezone, now) + 86_400_000 - 1;
    // Entre a publicação e a migração aplicada pelo superadmin a tabela ainda não existe.
    // Sem esta trava, a falta dela derrubava os lembretes inteiros, não só os de proposta.
    const proposals = await db.prepare(
      `SELECT pr.id, pr.code, pr.title, pr.status, pr.recipient_name, pr.total_cents, pr.scheduled_at, pr.scheduled_channel,
         pr.first_viewed_at, pr.last_viewed_at, pr.view_count, pr.accepted_at, pr.accepted_name, pr.notice_ack_at
       FROM proposals pr
       WHERE pr.organization_id = ?1 AND (
         (pr.status = 'scheduled' AND pr.scheduled_at <= ?2)
         OR (pr.accepted_at IS NOT NULL AND pr.accepted_at > COALESCE(pr.notice_ack_at, 0))
         OR (pr.status = 'sent' AND pr.first_viewed_at IS NOT NULL AND pr.first_viewed_at > COALESCE(pr.notice_ack_at, 0))
       )
       ORDER BY COALESCE(pr.accepted_at, pr.last_viewed_at, pr.scheduled_at) LIMIT 200`,
    ).bind(organization.id, horizonEnd).all<{
      id: string; code: string; title: string; status: string; recipient_name: string; total_cents: number;
      scheduled_at: number | null; scheduled_channel: string | null; first_viewed_at: number | null; last_viewed_at: number | null;
      view_count: number; accepted_at: number | null; accepted_name: string | null; notice_ack_at: number | null;
    }>().catch((error: unknown) => {
      if (/no such table:?\s*proposals/i.test(String(error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : error))) return { results: [] };
      throw error;
    });
    const clock = (ms: number) => new Date(ms).toLocaleString("pt-BR", { timeZone: organization.timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    for (const proposal of proposals.results) {
      const who = proposal.recipient_name ? ` · ${proposal.recipient_name}` : "";
      if (proposal.accepted_at && proposal.accepted_at > (proposal.notice_ack_at ?? 0)) {
        reminders.push({
          key: `proposta-aceita:${proposal.id}`, group: "proposta", severity: "hoje",
          title: `Proposta aceita: ${proposal.code} — ${proposal.title}`,
          detail: `${money(Number(proposal.total_cents))} · aceita por ${proposal.accepted_name ?? "cliente"} em ${clock(proposal.accepted_at)}`,
          amountCents: Number(proposal.total_cents), dueDay: usageDayKey(proposal.accepted_at, organization.timezone), module: "proposals", entityId: proposal.id,
        });
      } else if (proposal.status === "scheduled" && proposal.scheduled_at) {
        const due = usageDayKey(proposal.scheduled_at, organization.timezone);
        const ready = proposal.scheduled_at <= now;
        reminders.push({
          key: `proposta-envio:${proposal.id}`, group: "proposta",
          severity: ready ? (due < today ? "atrasado" : "hoje") : "proximo",
          title: ready ? `Hora de enviar: ${proposal.code} — ${proposal.title}` : `Envio agendado: ${proposal.code} — ${proposal.title}`,
          detail: `por ${proposal.scheduled_channel === "whatsapp" ? "WhatsApp" : "e-mail"} · ${clock(proposal.scheduled_at)}${who}`,
          amountCents: Number(proposal.total_cents), dueDay: due, module: "proposals", entityId: proposal.id,
        });
      } else if (proposal.first_viewed_at) {
        const last = proposal.last_viewed_at ?? proposal.first_viewed_at;
        reminders.push({
          key: `proposta-aberta:${proposal.id}`, group: "proposta", severity: "hoje",
          title: `Cliente abriu a proposta ${proposal.code} — ${proposal.title}`,
          detail: `${Number(proposal.view_count) > 1 ? `${proposal.view_count} aberturas · última` : "aberta"} em ${clock(last)}${who}`,
          amountCents: null, dueDay: usageDayKey(last, organization.timezone), module: "proposals", entityId: proposal.id,
        });
      }
    }
  }

  // Tarefa é o único lembrete que todo acesso recebe mesmo sem permissão de módulo:
  // sem leitura em Tarefas, a pessoa ainda é lembrada das que estão atribuídas a ela.
  const horizonMs = usageDayStart(horizon, organization.timezone, now) + 86_400_000 - 1;
  const ownOnly = !may(context, "tasks");
  const tasks = await db.prepare(
    `SELECT t.id, t.title, t.due_at, t.priority, p.name AS project_name, t.assignee_member_id
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
     WHERE t.organization_id = ?1 AND t.status != 'done' AND t.due_at IS NOT NULL AND t.due_at <= ?2
       AND (?3 = 0 OR t.assignee_member_id = ?4)
     ORDER BY t.due_at LIMIT 200`,
  ).bind(organization.id, horizonMs, ownOnly ? 1 : 0, context.member.id).all<{ id: string; title: string; due_at: number; priority: string; project_name: string | null; assignee_member_id: string | null }>();

  for (const task of tasks.results) {
    const due = usageDayKey(Number(task.due_at), organization.timezone);
    reminders.push({
      key: `tarefa:${task.id}`, group: "tarefa", severity: severityFor(due, today),
      title: due < today ? `Tarefa vencida: ${task.title}` : `Tarefa com prazo: ${task.title}`,
      detail: `${task.project_name ?? "Sem projeto"} · ${dayLabel(due)}${task.assignee_member_id === context.member.id ? " · atribuída a você" : ""}`,
      amountCents: null, dueDay: due, module: "tasks", entityId: task.id,
    });
  }

  // Recado com data, criado na Comunicação para esta pessoa ou para todos da conversa.
  for (const item of await pendingChatReminders(context, horizon)) {
    reminders.push({
      key: `recado:${item.id}`, group: "recado", severity: severityFor(item.due_day, today),
      title: item.text,
      detail: `${item.created_by_name} · ${item.kind === "canal" ? `canal ${item.channel_name ?? ""}` : "conversa direta"}${item.target_member_id ? "" : " · para todos"} · ${dayLabel(item.due_day)}`,
      amountCents: null, dueDay: item.due_day, module: "comunicacao", entityId: item.channel_id,
    });
  }

  const goalRows = await db.prepare(
    `SELECT id, name, metric, target_value, period_start, period_end, owner_member_id, created_by_name, active
     FROM goals WHERE organization_id = ?1 AND active = 1 AND period_start <= ?2 AND period_end >= ?2
     ORDER BY period_end LIMIT 100`,
  ).bind(organization.id, today).all<GoalRow>();

  const goals: Array<{ id: string; name: string; metric: string; label: string; money: boolean; target: number; current: number; percent: number; periodStart: string; periodEnd: string; ownerMemberId: string | null; mine: boolean }> = [];
  for (const goal of goalRows.results) {
    const metric = GOAL_METRICS[goal.metric as GoalMetric];
    if (!metric) continue;
    const mine = goal.owner_member_id === context.member.id;
    if (metric.money && !may(context, "finance") && !may(context, "budgets") && !mine) continue;
    if (!mine && !may(context, "overview")) continue;
    const current = await goalProgress(context, goal);
    const percent = goal.target_value > 0 ? Math.min(999, Math.round((current / goal.target_value) * 100)) : 0;
    goals.push({
      id: goal.id, name: goal.name, metric: goal.metric, label: metric.label, money: metric.money,
      target: Number(goal.target_value), current, percent,
      periodStart: goal.period_start, periodEnd: goal.period_end, ownerMemberId: goal.owner_member_id, mine,
    });
    if (percent < 100) {
      const remaining = Number(goal.target_value) - current;
      reminders.push({
        key: `meta:${goal.id}`, group: "meta", severity: severityFor(goal.period_end, today),
        title: `Meta em aberto: ${goal.name}`,
        detail: `${percent}% de ${metric.money ? money(Number(goal.target_value)) : `${goal.target_value} ${metric.label.toLocaleLowerCase("pt-BR")}`}` +
          ` · faltam ${metric.money ? money(remaining) : String(remaining)} até ${dayLabel(goal.period_end)}`,
        amountCents: metric.money ? remaining : null, dueDay: goal.period_end, module: "overview", entityId: goal.id,
      });
    }
  }

  const dismissed = await db.prepare(
    "SELECT item_key, state FROM reminder_states WHERE organization_id = ?1 AND subject_id = ?2 AND day = ?3",
  ).bind(organization.id, context.member.externalUserId, today).all<{ item_key: string; state: string }>();
  const dismissedKeys = new Set(dismissed.results.filter((row) => row.state === "dismissed").map((row) => row.item_key));
  const seen = dismissed.results.some((row) => row.item_key === "__visto__");

  const order: Record<ReminderSeverity, number> = { atrasado: 0, hoje: 1, proximo: 2 };
  const visible = reminders
    .filter((reminder) => !dismissedKeys.has(reminder.key))
    .sort((left, right) => order[left.severity] - order[right.severity] || (left.dueDay ?? "").localeCompare(right.dueDay ?? ""));

  return {
    day: today,
    horizon,
    seen,
    reminders: visible,
    dismissedCount: dismissedKeys.size,
    counts: {
      atrasado: visible.filter((item) => item.severity === "atrasado").length,
      hoje: visible.filter((item) => item.severity === "hoje").length,
      proximo: visible.filter((item) => item.severity === "proximo").length,
    },
    goals,
  };
}
