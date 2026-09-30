import { getDatabase } from "@/db";
import { apiRoute } from "@/lib/server/backend";
import { MAINTENANCE_ORGANIZATION_ID } from "@/lib/server/maintenance";
import { requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

/**
 * As contas que existem na plataforma.
 *
 * `empresas` é a informação que decide a ação: apagar uma conta que está em três
 * empresas tira a pessoa das três. Zero empresas é conta que entra e não vê nada — sobra
 * de teste ou de empresa já apagada, e é justamente a que se quer limpar.
 *
 * ─── O AMBIENTE DE MANUTENÇÃO NÃO CONTA ───
 *
 * Ele é uma organização no banco, mas "Empresas cadastradas" o esconde de propósito: não
 * é empresa de cliente. Contá-lo aqui fazia a tela se contradizer — a conta dizia "1
 * empresa" com a lista de empresas vazia, e não havia como descobrir qual era.
 *
 * Uma coluna que existe para decidir se apagar é seguro precisa contar as MESMAS
 * empresas que a tela mostra. Quem administra a manutenção já é identificado pelo próprio
 * nome na linha.
 */
export async function GET(request: Request) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    const db = getDatabase();
    const { results } = await db.prepare(
      `SELECT u.id, u.email, u.display_name,
              (SELECT COUNT(*) FROM (
                 SELECT organization_id FROM organization_members WHERE user_id = u.id AND organization_id <> ?1
                 UNION
                 SELECT organization_id FROM members WHERE external_user_id = u.id AND organization_id <> ?1
               )) AS empresas,
              (SELECT COUNT(*) FROM user_credentials c WHERE c.user_id = u.id) AS tem_senha
         FROM users u
        ORDER BY u.created_at DESC
        LIMIT 200`,
    ).bind(MAINTENANCE_ORGANIZATION_ID).all<{ id: string; email: string; display_name: string | null; empresas: number; tem_senha: number }>();

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
