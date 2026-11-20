import {
  ApiError, apiRoute, jsonBody, requireOrganizationContext, validationError,
  requireFerramenta,
} from "@/lib/server/backend";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";
import { podeAdministrarEmpresa } from "@/lib/permissions";
import { marcaDaEmpresa } from "@/lib/server/empresa-config";
import { esquemaDaMarca, gravarMarca } from "@/lib/server/marca-gravar";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, undefined, { allowUnacceptedTerms: true });
    return Response.json({ branding: await marcaDaEmpresa(context.db, context.organization.id) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function PUT(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request);
    requireFerramenta(context, "marca");
    if (!podeAdministrarEmpresa(context.member.role)) {
      throw new ApiError(403, "branding_denied", "Somente o contratante ou um administrador altera a identidade visual.");
    }
    const parsed = esquemaDaMarca.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    return Response.json(await gravarMarca(context.db, context.organization.id, parsed.data, {
      email: context.user.email, actorId: context.member.externalUserId,
    }));
  });
}
