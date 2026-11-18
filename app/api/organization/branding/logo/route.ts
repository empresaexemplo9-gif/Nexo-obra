import { apiRoute, ApiError, requireOrganizationContext } from "@/lib/server/backend";
import { logotipoDaEmpresa } from "@/lib/server/empresa-config";

export const dynamic = "force-dynamic";

/** Logotipo da empresa aberta na sessão. Nunca de outra: o id vem da sessão, não da URL. */
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, undefined, { allowUnacceptedTerms: true });
    const logo = await logotipoDaEmpresa(context.db, context.organization.id);
    if (!logo) throw new ApiError(404, "logo_not_found", "Esta empresa ainda não enviou logotipo.");
    const bytes = Uint8Array.from(atob(logo.logo_base64), (c) => c.charCodeAt(0));
    return new Response(bytes, {
      headers: {
        "Content-Type": logo.logo_mime,
        // A URL carrega a versão (?v=), então pode ficar no cache do navegador.
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}
