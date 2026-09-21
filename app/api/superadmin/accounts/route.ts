import { getDatabase } from "@/db";
import { apiRoute } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

/**
 * As contas que existem na plataforma.
 *
 * `empresas` é a informação que decide a ação: apagar uma conta que está em três
 * empresas tira a pessoa das três. Zero empresas é conta que entra e não vê nada — sobra
 * de teste ou de empresa já apagada, e é justamente a que se quer limpar.
 */
export async function GET(request: Request) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    const db = getDatabase();
    const { results } = await db.prepare(
      `SELECT u.id, u.email, u.display_name,
              (SELECT COUNT(*) FROM (
                 SELECT organization_id FROM organization_members WHERE user_id = u.id
                 UNION
                 SELECT organization_id FROM members WHERE external_user_id = u.id
               )) AS empresas,
              (SELECT COUNT(*) FROM user_credentials c WHERE c.user_id = u.id) AS tem_senha
         FROM users u
        ORDER BY u.created_at DESC
        LIMIT 200`,
    ).all<{ id: string; email: string; display_name: string | null; empresas: number; tem_senha: number }>();

    return Response.json({
      accounts: (results ?? []).map((linha) => ({
        id: linha.id,
        email: linha.email,
        displayName: linha.display_name,
        empresas: linha.empresas,
        temSenha: linha.tem_senha > 0,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
