import { z } from "zod";
import { apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";
import { checkPortalOrigin } from "@/lib/server/portal";
import { mappingSchema, monthSchema, UFS } from "@/lib/integrations/sinapi-contract";
import { activateSinapi, advanceSinapi, discardSinapi, mapSinapi, setSinapiAutomatic, sinapiStatus, startSinapi, withSinapiLock } from "@/lib/server/sinapi-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), month: monthSchema, uf: z.string().refine((s) => UFS.includes(s)), regime: z.enum(["Desonerado", "NaoDesonerado"]) }).strict(),
  z.object({ action: z.literal("map"), maps: z.array(mappingSchema).min(1).max(2).refine((m) => new Set(m.map((v) => v.tipo)).size === m.length, "Selecione uma aba por tipo.") }).strict(),
  z.object({ action: z.literal("advance") }).strict(),
  z.object({ action: z.literal("discard") }).strict(),
  z.object({ action: z.literal("approve"), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("automatic"), enabled: z.boolean() }).strict(),
]);
const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  return apiRoute(async () => { await requireSuperAdmin(request); return json(await sinapiStatus()); });
}
export async function POST(request: Request) {
  return apiRoute(async () => {
    checkPortalOrigin(request); const admin = await requireSuperAdmin(request);
    const parsed = schema.safeParse(await jsonBody(request)); if (!parsed.success) throw validationError(parsed.error.flatten());
    const data = parsed.data;
    await withSinapiLock(async (token) => {
      if (data.action === "start") {
        const existing = (await sinapiStatus()).config;
        const same = existing?.uf === data.uf && existing.regime === data.regime;
        await startSinapi(data.month, same ? existing! : { uf: data.uf, regime: data.regime, automatico: false, mapas: [], assinaturas: [] }, token);
      }
      if (data.action === "advance") await advanceSinapi(token);
      if (data.action === "map") await mapSinapi(data.maps, token);
      if (data.action === "discard") await discardSinapi(token);
      if (data.action === "approve") { await activateSinapi(admin.email, token); await advanceSinapi(token); }
      if (data.action === "automatic") await setSinapiAutomatic(data.enabled, token);
    });
    return json(await sinapiStatus());
  });
}
