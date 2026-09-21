import { z } from "zod";
import { apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";
import { checkPortalOrigin } from "@/lib/server/portal";
import { monthSchema, regimeSchema, UFS } from "@/lib/integrations/sinapi-contract";
import { advanceSinapiImport, latestSinapiImport, prepareSinapiImport, readSinapiImport } from "@/lib/server/sinapi-import";
import { withSinapiLock } from "@/lib/server/sinapi-sync";
export const runtime = "nodejs";
export const maxDuration = 300;
const profile = z.object({ uf: z.string().refine((s) => UFS.includes(s)), regime: regimeSchema });
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), id: z.string().uuid(), month: monthSchema, url: z.string().max(500).optional(), files: z.array(z.string().max(250)).max(20).optional(), profiles: z.array(profile).min(1).max(54).refine((v) => new Set(v.map((p) => `${p.uf}:${p.regime}`)).size === v.length) }).strict(),
  z.object({ action: z.literal("advance"), id: z.string().uuid(), confirmed: z.literal(true) }).strict(),
]);
export async function GET(request: Request) { return apiRoute(async () => {
  await requireSuperAdmin(request); const id = new URL(request.url).searchParams.get("id");
  if (id && !z.string().uuid().safeParse(id).success) throw new Error("Importação inválida.");
  return Response.json(id ? await readSinapiImport(id) : await latestSinapiImport(), {headers:{"Cache-Control":"private, no-store"}});
}); }
export async function POST(request: Request) { return apiRoute(async () => {
  checkPortalOrigin(request); const admin = await requireSuperAdmin(request);
  const parsed = schema.safeParse(await jsonBody(request)); if (!parsed.success) throw validationError(parsed.error.flatten());
  const data = parsed.data;
  try { return Response.json(await withSinapiLock(async (token) => data.action === "prepare" ? prepareSinapiImport(data) : advanceSinapiImport(data.id, admin.email, token))); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha na importação." }, { status: 422 }); }
}); }
