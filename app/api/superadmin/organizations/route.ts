import { z } from "zod";

import { getDatabase } from "@/db";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { platformAudit } from "@/lib/server/platform-access";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(3).max(60).default("America/Sao_Paulo"),
});

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "empresa";
}

// A empresa nasce sem membros: o superadministrador já pode operá-la e o convite
// principal define quem será o contratante proprietário.
export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const admin = await requireSuperAdmin(request);
    const parsed = organizationSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);

    const db = getDatabase();
    const id = crypto.randomUUID();
    const slug = `${slugify(parsed.data.name)}-${id.replaceAll("-", "").slice(0, 8)}`;
    const now = Date.now();
    try {
      await db.batch([
        db.prepare(
          `INSERT INTO organizations (id, name, slug, timezone, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
        ).bind(id, parsed.data.name, slug, parsed.data.timezone, now),
        platformAudit(db, id, admin.email, "platform.organization_created", id, { name: parsed.data.name }),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) {
        throw new ApiError(409, "organization_exists", "Não foi possível gerar um identificador único. Tente novamente.");
      }
      throw error;
    }

    return Response.json(
      { organization: { id, name: parsed.data.name, slug, timezone: parsed.data.timezone } },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
