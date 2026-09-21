import { getDatabase } from "@/db";
import { ApiError, apiRoute } from "@/lib/server/backend";
import { instrucoesParaApagarContas, instrucoesParaDesvincularContas } from "@/lib/server/apagar-empresa";
import { registrarExclusao } from "@/lib/server/exclusoes";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ userId: string }> };

/**
 * Apaga uma conta da plataforma inteira: a credencial de acesso e todos os vínculos com
 * empresas.
 *
 * ─── AS DUAS TABELAS DE VÍNCULO ───
 *
 * `organization_members` liga a pessoa à empresa para o acesso; `members` guarda o
 * registro dela dentro da empresa, com papel e permissões. Apagar só uma deixaria a
 * pessoa aparecendo na equipe de uma empresa cujo login não existe mais, ou um login que
 * entra e não pertence a lugar nenhum. As duas saem juntas.
 *
 * O que a pessoa produziu não sai: tarefa, diário de obra, lançamento e orçamento
 * pertencem à empresa, não a ela. Apagar a conta de quem saiu não pode apagar o histórico
 * da obra que essa pessoa tocou.
 */
export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const admin = await requireSuperAdmin(request);
    const { userId } = await route.params;

    const db = getDatabase();
    const conta = await db.prepare("SELECT id, email, display_name FROM users WHERE id = ?1")
      .bind(userId).first<{ id: string; email: string; display_name: string | null }>();
    if (!conta) throw new ApiError(404, "account_not_found", "Conta não encontrada.");

    // Apagar a própria conta deixaria a plataforma sem quem administra e a sessão atual
    // apontando para alguém que não existe.
    if (conta.email.toLowerCase() === admin.email.toLowerCase()) {
      throw new ApiError(409, "account_self_delete", "Você não pode apagar a própria conta por aqui.");
    }

    const vinculos = await db.prepare(
      `SELECT count(*) AS total FROM (
         SELECT organization_id FROM organization_members WHERE user_id = ?1
         UNION
         SELECT organization_id FROM members WHERE external_user_id = ?1
       )`,
    ).bind(userId).first<{ total: number }>();

    await db.batch([
      ...instrucoesParaDesvincularContas(db, [userId]),
      ...instrucoesParaApagarContas(db, [userId]),
      registrarExclusao(db, {
        tipo: "account",
        subjectId: userId,
        rotulo: conta.email,
        actor: admin.email,
        detalhes: { empresasVinculadas: vinculos?.total ?? 0 },
      }),
    ]);

    return Response.json({ apagada: true }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
