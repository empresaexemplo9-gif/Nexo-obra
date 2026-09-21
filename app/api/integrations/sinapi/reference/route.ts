import { get } from "@vercel/blob";
import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";
import { latestSinapiImport } from "@/lib/server/sinapi-import";
import { runtimeEnv } from "@/lib/server/runtime";
import { readSinapiTable, SINAPI_TABLES } from "@/lib/integrations/sinapi-reference";
import { sinapiIO } from "@/lib/server/sinapi-sync";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) { return apiRoute(async () => {
  try { await requireSuperAdmin(request); } catch { const context = await requireOrganizationContext(request); requireModulePermission(context, "budgets", "view"); }
  const reference = await latestSinapiImport();
  if (!reference) return Response.json({ error: "Nenhum pacote completo importado ainda." }, { status: 404 });
  const url = new URL(request.url), table = url.searchParams.get("table");
  if (table) {
    if (!Object.hasOwn(SINAPI_TABLES, table)) return Response.json({error:"Relatório inválido."},{status:400});
    try { const data = readSinapiTable(await sinapiIO.read(`sinapi-imports/${reference.id}/source.zip`), table as keyof typeof SINAPI_TABLES, url.searchParams.get("regime") ?? "NaoDesonerado", (url.searchParams.get("q") ?? "").slice(0,160));
      return Response.json({month:reference.month,...data},{headers:{"Cache-Control":"private, no-store"}});
    } catch(error) {return Response.json({error:error instanceof Error?error.message:"Relatório indisponível."},{status:422});}
  }
  if (new URL(request.url).searchParams.get("download") === "1") {
    const blob = await get(`sinapi-imports/${reference.id}/source.zip`, { access:"private",token:runtimeEnv().BLOB_READ_WRITE_TOKEN });
    if (!blob?.stream) return Response.json({ error:"Pacote indisponível." }, {status:404});
    return new Response(blob.stream, { headers: {"Content-Type":"application/zip","Content-Disposition":`attachment; filename="SINAPI-${reference.month}-completo.zip"`,"Cache-Control":"private, no-store"} });
  }
  return Response.json({month:reference.month,source:reference.source,sha256:reference.sha256,reports:reference.reports,completed:reference.completed}, {headers:{"Cache-Control":"private, no-store"}});
}); }
