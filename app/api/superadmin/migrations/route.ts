import { getDatabase } from "@/db";
import { ApiError, apiRoute } from "@/lib/server/backend";
import { aplicarPeloPainel, migrationStatus, motivoParaRevisao, migrations, ultimaExecucao } from "@/lib/server/migrations";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

// Estado do banco e aplicação do que falta. Sem sessão de superadministrador, nada aqui
// responde: aplicar migração altera o esquema de todas as empresas.
export async function GET(request: Request) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    const db = getDatabase();
    const status = await migrationStatus(db);
    return Response.json({
      ...status,
      // O que o agendamento não aplica sozinho e por quê.
      needsReview: status.pending.map((id) => motivoParaRevisao(migrations.find((m) => m.id === id)!)).filter(Boolean),
      automatic: await ultimaExecucao(db),
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const admin = await requireSuperAdmin(request);
    const db = getDatabase();
    const result = await aplicarPeloPainel(db, `painel (${admin.email})`);
    if (!result) throw new ApiError(409, "migration_in_progress", "Uma atualização do banco já está em andamento. Aguarde alguns segundos e recarregue.");
    if (result.applied.length) {
      console.log(`DRAP Backoffice migrações aplicadas por ${admin.email}: ${result.applied.map((item) => item.id).join(", ")}`);
    }
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  });
}
