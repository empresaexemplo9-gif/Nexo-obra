import { ApiError } from "@/lib/server/api-error";

// O navegador envia um sinal a cada BEAT_MS enquanto a aba está visível. O servidor
// credita apenas o intervalo entre dois sinais que ele mesmo observou, limitado a
// GAP_LIMIT_MS. Uma aba fechada, um travamento ou uma queda de rede param de creditar
// no último sinal recebido: nunca inflam o total.
export const USAGE_BEAT_MS = 30_000;
export const USAGE_GAP_LIMIT_MS = 90_000;

export type UsageSubjectKind = "member" | "superadmin" | "maintenance" | "portal_client";

export type UsageSubject = {
  organizationId: string;
  subjectId: string;
  subjectKind: UsageSubjectKind;
  email: string;
  displayName: string;
  role: string;
  memberId: string | null;
  timeZone: string;
};

type OpenSession = { id: string; started_at: number; last_seen_at: number; active_ms: number; beats: number };

export function usageDayKey(timestamp: number, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
}

function zoneOffsetMs(timestamp: number, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(new Date(timestamp));
    const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
    const match = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(raw);
    if (!match) return 0;
    return (match[1] === "-" ? -1 : 1) * ((Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60_000);
  } catch {
    return 0;
  }
}

// Instante UTC da meia-noite local do dia informado. O deslocamento é lido perto do
// próprio instante, então mudanças de horário de verão entram na conta.
export function usageDayStart(day: string, timeZone: string, near: number) {
  return Date.parse(`${day}T00:00:00.000Z`) - zoneOffsetMs(near, timeZone);
}

function creditDay(db: D1Database, subject: UsageSubject, day: string, ms: number, sessions: number, seenAt: number) {
  // `changes() > 0` encadeia com a instrução anterior: o dia só recebe crédito se a
  // sessão realmente avançou nesta requisição, o que impede contar duas vezes quando
  // dois sinais chegam juntos.
  return db.prepare(
    `INSERT INTO usage_days (
      organization_id, subject_id, day, subject_kind, email, display_name, role,
      active_ms, sessions, first_seen_at, last_seen_at
    )
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10 WHERE changes() > 0
    ON CONFLICT(organization_id, subject_id, day) DO UPDATE SET
      active_ms = usage_days.active_ms + excluded.active_ms,
      sessions = usage_days.sessions + excluded.sessions,
      last_seen_at = max(usage_days.last_seen_at, excluded.last_seen_at),
      email = excluded.email, display_name = excluded.display_name, role = excluded.role`,
  ).bind(
    subject.organizationId, subject.subjectId, day, subject.subjectKind,
    subject.email, subject.displayName, subject.role, ms, sessions, seenAt,
  );
}

export async function recordUsageHeartbeat(db: D1Database, subject: UsageSubject, now = Date.now()) {
  const open = await db.prepare(
    `SELECT id, started_at, last_seen_at, active_ms, beats FROM usage_sessions
     WHERE organization_id = ?1 AND subject_id = ?2 AND ended_at IS NULL
     ORDER BY last_seen_at DESC LIMIT 1`,
  ).bind(subject.organizationId, subject.subjectId).first<OpenSession>();

  const gap = open ? now - open.last_seen_at : Number.POSITIVE_INFINITY;
  const continues = Boolean(open) && gap >= 0 && gap <= USAGE_GAP_LIMIT_MS;

  if (continues && open) {
    const day = usageDayKey(open.last_seen_at, subject.timeZone);
    const today = usageDayKey(now, subject.timeZone);
    const statements = [
      // Comparação e escrita na mesma instrução: dois sinais simultâneos creditam uma vez.
      db.prepare(
        `UPDATE usage_sessions SET last_seen_at = ?1, active_ms = active_ms + ?2, beats = beats + 1
         WHERE id = ?3 AND ended_at IS NULL AND last_seen_at = ?4`,
      ).bind(now, gap, open.id, open.last_seen_at),
    ];
    if (day === today) {
      statements.push(creditDay(db, subject, today, gap, 0, now));
    } else {
      // O intervalo atravessou a meia-noite: cada dia recebe exatamente a sua parte.
      const boundary = usageDayStart(today, subject.timeZone, now);
      const before = Math.max(0, Math.min(gap, boundary - open.last_seen_at));
      statements.push(creditDay(db, subject, day, before, 0, boundary));
      statements.push(creditDay(db, subject, today, gap - before, 0, now));
    }
    await db.batch(statements);
    return { sessionId: open.id, creditedMs: gap, day: today, startedAt: open.started_at };
  }

  const sessionId = crypto.randomUUID();
  const today = usageDayKey(now, subject.timeZone);
  await db.batch([
    ...(open ? [db.prepare("UPDATE usage_sessions SET ended_at = last_seen_at WHERE id = ?1 AND ended_at IS NULL").bind(open.id)] : []),
    db.prepare(
      `INSERT INTO usage_sessions (
        id, organization_id, subject_id, subject_kind, email, display_name, role,
        member_id, started_at, last_seen_at, ended_at, active_ms, beats
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, NULL, 0, 1)`,
    ).bind(
      sessionId, subject.organizationId, subject.subjectId, subject.subjectKind,
      subject.email, subject.displayName, subject.role, subject.memberId, now,
    ),
    creditDay(db, subject, today, 0, 1, now),
  ]);
  return { sessionId, creditedMs: 0, day: today, startedAt: now };
}

// Fecha sessões que pararam de sinalizar. Nada é creditado aqui: o total já está gravado.
export function closeStaleUsageSessions(db: D1Database, now = Date.now()) {
  return db.prepare("UPDATE usage_sessions SET ended_at = last_seen_at WHERE ended_at IS NULL AND last_seen_at < ?1")
    .bind(now - USAGE_GAP_LIMIT_MS);
}

export type UsageQuery = { from: string; to: string; timeZone: string; organizationId?: string; subjectId?: string; excludePlatformSubjects?: boolean; dependentViewerId?: string };

// Financeiro/RH acompanham o próprio uso e os perfis subordinados. O cargo atual
// também é consultado para não expor o histórico de alguém promovido.
const dependentRoles = "'manager','member','partner','service_provider','accounting','client'";
function dependentFilter(alias: string, viewerParameter: string) {
  return `(${alias}.subject_id = ${viewerParameter} OR (
    ${alias}.role IN (${dependentRoles}) AND NOT EXISTS (
      SELECT 1 FROM members m WHERE m.organization_id = ${alias}.organization_id
        AND m.external_user_id = ${alias}.subject_id
        AND m.role NOT IN (${dependentRoles})
    )
  ))`;
}

export function parseUsageRange(url: URL, timeZone: string, now = Date.now()) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const to = url.searchParams.get("to") ?? usageDayKey(now, timeZone);
  const from = url.searchParams.get("from") ?? usageDayKey(now - 29 * 86_400_000, timeZone);
  if (!iso.test(from) || !iso.test(to)) throw new ApiError(400, "invalid_range", "Informe as datas no formato AAAA-MM-DD.");
  if (from > to) throw new ApiError(400, "invalid_range", "A data inicial não pode ser maior que a final.");
  return { from, to };
}

type DayRow = {
  organization_id: string; organization_name: string; subject_id: string; day: string;
  subject_kind: string; email: string; display_name: string; role: string;
  active_ms: number; sessions: number; first_seen_at: number; last_seen_at: number;
};

export async function usageReport(db: D1Database, query: UsageQuery) {
  const filters = ["d.day >= ?1", "d.day <= ?2"];
  const bindings: unknown[] = [query.from, query.to];
  if (query.organizationId) { bindings.push(query.organizationId); filters.push(`d.organization_id = ?${bindings.length}`); }
  if (query.subjectId) { bindings.push(query.subjectId); filters.push(`d.subject_id = ?${bindings.length}`); }
  if (query.dependentViewerId) { bindings.push(query.dependentViewerId); filters.push(dependentFilter("d", `?${bindings.length}`)); }
  if (query.excludePlatformSubjects) filters.push("d.subject_kind NOT IN ('superadmin', 'maintenance')");

  const days = await db.prepare(
    `SELECT d.organization_id, o.name AS organization_name, d.subject_id, d.day, d.subject_kind,
      d.email, d.display_name, d.role, d.active_ms, d.sessions, d.first_seen_at, d.last_seen_at
     FROM usage_days d INNER JOIN organizations o ON o.id = d.organization_id
     WHERE ${filters.join(" AND ")}
     ORDER BY d.day DESC, d.active_ms DESC
     LIMIT 2000`,
  ).bind(...bindings).all<DayRow>();

  // Ações no período vêm da trilha de auditoria, que já é a dona desse dado. Os limites
  // são a meia-noite local do primeiro dia e o fim do último, no fuso da empresa aberta.
  const periodStart = usageDayStart(query.from, query.timeZone, Date.parse(`${query.from}T12:00:00.000Z`));
  const periodEnd = usageDayStart(query.to, query.timeZone, Date.parse(`${query.to}T12:00:00.000Z`)) + 86_400_000 - 1;
  const actionFilters = ["a.created_at >= ?1", "a.created_at <= ?2"];
  const actionBindings: unknown[] = [periodStart, periodEnd];
  if (query.organizationId) { actionBindings.push(query.organizationId); actionFilters.push(`a.organization_id = ?${actionBindings.length}`); }
  if (query.subjectId) { actionBindings.push(query.subjectId); actionFilters.push(`a.actor_user_id = ?${actionBindings.length}`); }
  if (query.dependentViewerId) {
    actionBindings.push(query.dependentViewerId);
    actionFilters.push(`EXISTS (SELECT 1 FROM usage_days d WHERE d.organization_id = a.organization_id
      AND d.subject_id = a.actor_user_id AND ${dependentFilter("d", `?${actionBindings.length}`)})`);
  }
  if (query.excludePlatformSubjects) actionFilters.push("EXISTS (SELECT 1 FROM usage_days u WHERE u.organization_id = a.organization_id AND u.subject_id = a.actor_user_id AND u.subject_kind NOT IN ('superadmin', 'maintenance'))");
  const actions = await db.prepare(
    `SELECT a.organization_id, a.actor_user_id, COUNT(*) AS total
     FROM audit_events a WHERE ${actionFilters.join(" AND ")}
     GROUP BY a.organization_id, a.actor_user_id`,
  ).bind(...actionBindings).all<{ organization_id: string; actor_user_id: string; total: number }>();
  const actionsBySubject = new Map(actions.results.map((row) => [`${row.organization_id}:${row.actor_user_id}`, Number(row.total)]));

  return {
    range: { from: query.from, to: query.to, startedAt: periodStart, endedAt: periodEnd },
    beatMs: USAGE_BEAT_MS,
    gapLimitMs: USAGE_GAP_LIMIT_MS,
    days: days.results.map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      subjectId: row.subject_id,
      subjectKind: row.subject_kind,
      day: row.day,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      activeMs: Number(row.active_ms),
      sessions: Number(row.sessions),
      firstSeenAt: Number(row.first_seen_at),
      lastSeenAt: Number(row.last_seen_at),
    })),
    actions: [...actionsBySubject].map(([key, total]) => ({
      organizationId: key.slice(0, key.indexOf(":")),
      subjectId: key.slice(key.indexOf(":") + 1),
      total,
    })),
  };
}
