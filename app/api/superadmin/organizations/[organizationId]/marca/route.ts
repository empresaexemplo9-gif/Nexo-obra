import { z } from "zod";
import { getDatabase } from "@/db";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";
import { MAINTENANCE_ORGANIZATION_ID } from "@/lib/server/maintenance";
import { marcaDaEmpresa } from "@/lib/server/empresa-config";
import { esquemaDaMarca, gravarMarca } from "@/lib/server/marca-gravar";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ organizationId: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function empresa(organizationId: string) {
  if (!z.string().uuid().safeParse(organizationId).success) throw new ApiError(400, "invalid_organization", "Selecione uma empresa.");
  if (organizationId === MAINTENANCE_ORGANIZATION_ID) throw new ApiError(403, "maintenance_reserved", "O ambiente de manutenção usa a marca da plataforma.");
  if (!await getDatabase().prepare("SELECT id FROM organizations WHERE id = ?1").bind(organizationId).first()) {
    throw new ApiError(404, "organization_not_found", "Empresa não encontrada.");
  }
}

/** Identidade visual de qualquer empresa, lida e gravada pelo superadministrador. */
export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    const { organizationId } = await route.params;
    await empresa(organizationId);
    return json({ branding: await marcaDaEmpresa(getDatabase(), organizationId) });
  });
}

export async function PUT(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const admin = await requireSuperAdmin(request);
    const { organizationId } = await route.params;
    await empresa(organizationId);
    const parsed = esquemaDaMarca.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    return json(await gravarMarca(getDatabase(), organizationId, parsed.data, { email: admin.email, actorId: admin.email, plataforma: true }));
  });
}
