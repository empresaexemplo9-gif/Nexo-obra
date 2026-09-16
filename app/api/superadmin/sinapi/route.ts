import { z } from "zod";
import { apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";
import { checkPortalOrigin } from "@/lib/server/portal";
import { mappingSchema, monthSchema, regimeSchema, UFS } from "@/lib/integrations/sinapi-contract";
import { activateSinapi, advanceSinapi, discardSinapi, mapSinapi, setSinapiAutomatic, sinapiStatus, startSinapi, uploadSinapi, withSinapiLock } from "@/lib/server/sinapi-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), month: monthSchema, uf: z.string().refine((s) => UFS.includes(s)), regime: regimeSchema }).strict(),
  z.object({ action: z.literal("map"), maps: z.array(mappingSchema).min(1).max(2).refine((m) => new Set(m.map((v) => v.tipo)).size === m.length, "Selecione uma aba por tipo.") }).strict(),
  z.object({ action: z.literal("advance") }).strict(),
  z.object({ action: z.literal("discard") }).strict(),
  z.object({ action: z.literal("approve"), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("automatic"), enabled: z.boolean() }).strict(),
]);
const envioSchema = z.object({
  month: monthSchema,
  uf: z.string().refine((s) => UFS.includes(s)),
  regime: regimeSchema,
});
// O mesmo teto que o armazenamento temporário aceita.
const LIMITE_ENVIO = 80 * 1024 * 1024;
const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  return apiRoute(async () => { await requireSuperAdmin(request); return json(await sinapiStatus()); });
}
// Envio manual do ZIP, para quando a Caixa recusa o download automático — o que hoje
// acontece: HTTP 403 ao servidor publicado e 429 ao local. Vai por multipart porque o
// arquivo tem dezenas de megabytes; o JSON da outra rota não serve para isso.
export async function PUT(request: Request) {
  return apiRoute(async () => {
    checkPortalOrigin(request); await requireSuperAdmin(request);
    const form = await request.formData().catch(() => null);
    if (!form) throw validationError({ formErrors: ["Envie o arquivo como multipart/form-data."], fieldErrors: {} });
    const arquivo = form.get("arquivo");
    const parsed = envioSchema.safeParse({ month: form.get("month"), uf: form.get("uf"), regime: form.get("regime") });
    if (!parsed.success) throw validationError(parsed.error.flatten());
    if (!(arquivo instanceof File) || !arquivo.size) throw validationError({ formErrors: ["Anexe o arquivo ZIP da Caixa."], fieldErrors: {} });
    if (arquivo.size > LIMITE_ENVIO) throw validationError({ formErrors: [`O arquivo tem ${Math.round(arquivo.size / 1048576)} MB e o limite é ${LIMITE_ENVIO / 1048576} MB.`], fieldErrors: {} });

    const bytes = Buffer.from(await arquivo.arrayBuffer());
    // O ZIP começa com "PK". Conferir aqui evita gravar um PDF ou HTML de página de erro
    // e só descobrir isso no passo seguinte, com o job já preso.
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw validationError({ formErrors: ["O arquivo não é um ZIP. Baixe o pacote da Caixa no formato xlsx e envie o .zip como veio."], fieldErrors: {} });
    }

    await withSinapiLock(async (token) => {
      const existing = (await sinapiStatus()).config;
      const same = existing?.uf === parsed.data.uf && existing.regime === parsed.data.regime;
      await uploadSinapi(parsed.data.month, same ? existing! : { uf: parsed.data.uf, regime: parsed.data.regime, automatico: false, mapas: [], assinaturas: [] }, bytes, token);
      await advanceSinapi(token);
    });
    return json(await sinapiStatus());
  });
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
