import { apiRoute } from "@/lib/server/backend";
import { isOrcamentadorConfigured } from "@/lib/integrations/orcamentador";
import { monthlyOrcamentadorSinapi } from "@/lib/server/orcamentador-sync";
import { authorizeSinapiCron, monthlySinapi, withSinapiLock } from "@/lib/server/sinapi-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return apiRoute(async () => {
    authorizeSinapiCron(request);
    const provider = isOrcamentadorConfigured() ? "orcamentador" : "caixa";
    let result: unknown = null;
    await withSinapiLock(async (token) => {
      if (provider === "orcamentador") result = await monthlyOrcamentadorSinapi(token);
      else await monthlySinapi(token);
    });
    return Response.json({ ok: true, provider, result }, { headers: { "Cache-Control": "no-store" } });
  });
}
