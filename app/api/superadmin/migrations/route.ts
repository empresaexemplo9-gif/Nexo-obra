import { getDatabase } from "@/db";
import { apiRoute } from "@/lib/server/backend";
import { applyMigrations, migrationStatus } from "@/lib/server/migrations";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

// Estado do banco e aplicação do que falta. Sem sessão de superadministrador, nada aqui
// responde: aplicar migração altera o esquema de todas as empresas.
export async function GET(request: Request) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    return Response.json(await migrationStatus(getDatabase()), { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const admin = await requireSuperAdmin(request);
    const db = getDatabase();
    const result = await applyMigrations(db);
    if (result.applied.length) {
      console.log(`H.OIKOS migrações aplicadas por ${admin.email}: ${result.applied.map((item) => item.id).join(", ")}`);
    }
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  });
}
