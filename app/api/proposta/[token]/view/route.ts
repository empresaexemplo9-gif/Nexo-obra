import { getDatabase } from "@/db";
import { apiRoute, authenticatedIdentity } from "@/lib/server/backend";
import { loadProposalByToken } from "@/lib/server/proposals";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

// Registro de abertura pelo cliente, chamado pela página depois que ela carrega no
// navegador. Não é o GET da página que conta: o WhatsApp e o e-mail buscam o link para
// montar a prévia, e isso não pode virar "o cliente abriu".
//
// Quem é da própria empresa conferindo o link também não conta. Recarregar dentro de dez
// minutos não soma outra abertura.

const RELOAD_WINDOW = 10 * 60_000;

async function isTeamMember(request: Request, organizationId: string) {
  try {
    const identity = await authenticatedIdentity(request);
    if (identity.scope === "superadmin" || identity.scope === "maintenance") return true;
    const member = await getDatabase().prepare("SELECT 1 AS ok FROM members WHERE organization_id = ?1 AND external_user_id = ?2 AND active = 1")
      .bind(organizationId, identity.id).first<{ ok: number }>();
    return Boolean(member);
  } catch {
    return false;
  }
}

export async function POST(request: Request, route: { params: Promise<{ token: string }> }) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const { token } = await route.params;
    const db = getDatabase();
    const row = await loadProposalByToken(db, token);
    if (!row) return Response.json({ recorded: false }, { status: 404 });
    if (await isTeamMember(request, row.organization_id)) return Response.json({ recorded: false, reason: "team" });
    const now = Date.now();
    if (row.last_viewed_at && now - row.last_viewed_at < RELOAD_WINDOW) {
      await db.prepare("UPDATE proposals SET last_viewed_at = ?1 WHERE id = ?2").bind(now, row.id).run();
      return Response.json({ recorded: false, reason: "reload" });
    }
    await db.prepare(
      "UPDATE proposals SET first_viewed_at = COALESCE(first_viewed_at, ?1), last_viewed_at = ?1, view_count = view_count + 1 WHERE id = ?2",
    ).bind(now, row.id).run();
    return Response.json({ recorded: true });
  });
}
