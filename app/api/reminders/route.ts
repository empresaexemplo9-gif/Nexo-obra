import { z } from "zod";

import { apiRoute, jsonBody, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { dailyReminders } from "@/lib/server/reminders";

export const dynamic = "force-dynamic";

const markSchema = z.object({
  itemKey: z.string().trim().min(1).max(120),
  state: z.enum(["dismissed", "seen"]),
}).strict();

// Todo acesso tem lembretes. O que aparece em cada um respeita a permissão do módulo de
// origem, e as tarefas atribuídas à pessoa aparecem mesmo sem leitura no módulo.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    return Response.json(await dailyReminders(context), { headers: { "Cache-Control": "private, no-store" } });
  });
}

// Dispensar vale só para o dia e só para quem dispensou: o registro de origem continua
// pendente no módulo dele.
export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const parsed = markSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const agenda = await dailyReminders(context);
    const itemKey = parsed.data.state === "seen" ? "__visto__" : parsed.data.itemKey;
    await context.db.prepare(
      `INSERT INTO reminder_states (organization_id, subject_id, day, item_key, state, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(organization_id, subject_id, day, item_key) DO UPDATE SET
         state = excluded.state, updated_at = excluded.updated_at`,
    ).bind(context.organization.id, context.member.externalUserId, agenda.day, itemKey, parsed.data.state, Date.now()).run();
    return Response.json(await dailyReminders(context), { headers: { "Cache-Control": "private, no-store" } });
  });
}
