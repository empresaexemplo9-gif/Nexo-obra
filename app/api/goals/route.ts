import { z } from "zod";

import {
  ApiError,
  apiRoute,
  auditStatement,
  canManageOrganizationAccess,
  jsonBody,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";
import { dailyReminders, GOAL_METRICS } from "@/lib/server/reminders";

export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.");
const goalSchema = z.object({
  name: z.string().trim().min(2).max(120),
  metric: z.enum(Object.keys(GOAL_METRICS) as [string, ...string[]]),
  targetValue: z.number().int().min(1).max(10_000_000_000),
  periodStart: day,
  periodEnd: day,
  ownerMemberId: z.string().uuid().nullable().default(null),
}).strict().refine((goal) => goal.periodStart <= goal.periodEnd, {
  message: "O início do período não pode ser depois do fim.", path: ["periodEnd"],
});

// Definir meta é decisão de quem responde pela empresa. Acompanhar é de todo mundo.
function requireGoalManager(context: Awaited<ReturnType<typeof requireOrganizationContext>>) {
  if (!canManageOrganizationAccess(context)) {
    throw new ApiError(403, "goal_manager_required", "Somente o contratante ou um administrador define metas.");
  }
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const agenda = await dailyReminders(context);
    return Response.json({
      goals: agenda.goals,
      metrics: Object.entries(GOAL_METRICS).map(([id, metric]) => ({ id, label: metric.label, money: metric.money })),
      canManage: canManageOrganizationAccess(context),
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireGoalManager(context);
    const parsed = goalSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    if (data.ownerMemberId) {
      const member = await context.db.prepare("SELECT id FROM members WHERE id = ?1 AND organization_id = ?2 AND active = 1")
        .bind(data.ownerMemberId, context.organization.id).first();
      if (!member) throw new ApiError(404, "member_not_found", "Essa pessoa não faz parte da empresa.");
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    await context.db.batch([
      context.db.prepare(
        `INSERT INTO goals (
          id, organization_id, name, metric, target_value, period_start, period_end,
          owner_member_id, created_by_member_id, created_by_name, active, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?11)`,
      ).bind(id, context.organization.id, data.name, data.metric, data.targetValue,
        data.periodStart, data.periodEnd, data.ownerMemberId, context.member.id, context.user.displayName, now),
      auditStatement(context, "goal.created", "goal", id, { metric: data.metric, target: data.targetValue }),
    ]);
    return Response.json({ created: true, id }, { status: 201 });
  });
}
