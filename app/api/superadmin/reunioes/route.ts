import { getDatabase } from "@/db";
import { apiRoute } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

// Pedidos de reunião feitos na demonstração pública. Só o superadministrador lê: são
// contatos de quem ainda não é cliente e não pertencem a empresa nenhuma.
export async function GET(request: Request) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    const { results } = await getDatabase().prepare(
      `SELECT id, name, company, email, phone, team_size, preferred_day, preferred_period, message, origin, status, created_at, kind
         FROM meeting_requests ORDER BY created_at DESC LIMIT 200`,
    ).all<{
      id: string; name: string; company: string; email: string; phone: string; team_size: string;
      preferred_day: string; preferred_period: string; message: string | null; origin: string; status: string; created_at: number; kind: string;
    }>();
    return Response.json({
      requests: results.map((linha) => ({
        id: linha.id, kind: linha.kind, name: linha.name, company: linha.company, email: linha.email, phone: linha.phone,
        teamSize: linha.team_size, preferredDay: linha.preferred_day, preferredPeriod: linha.preferred_period,
        message: linha.message, origin: linha.origin, status: linha.status, createdAt: Number(linha.created_at),
      })),
    });
  });
}
