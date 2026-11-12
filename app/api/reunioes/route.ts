import { getDatabase } from "@/db";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";
import { requestEvidenceHashes } from "@/lib/server/terms";
import { erroDoDia, pedidoReuniaoSchema } from "@/lib/reunioes";

export const dynamic = "force-dynamic";

// Pedido de reunião ou de envio de proposta do visitante que testou a demonstração.
//
// É a única escrita pública sem link assinado, então é a mais exposta a robô. Três
// barreiras, todas no servidor: origem do próprio site, campo-isca e teto por IP. O que
// a pessoa recebe de volta é "pedido registrado" — a reunião só existe quando alguém da
// plataforma confirma o horário; a tela não promete data.

const JANELA_MS = 60 * 60 * 1000;
const TETO_POR_IP = 5;
const TETO_GERAL = 200;

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const parsed = pedidoReuniaoSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const dados = parsed.data;
    const reuniao = dados.kind === "meeting";
    const erroDia = reuniao ? erroDoDia(dados.preferredDay ?? "") : null;
    if (erroDia) throw validationError({ preferredDay: [erroDia] });
    // Pedido de proposta não tem data: os dois campos ficam vazios, nunca inventados.
    const diaPreferido = reuniao ? dados.preferredDay ?? "" : "";
    const periodo = reuniao ? dados.preferredPeriod ?? "" : "";
    // Robô que preencheu a isca recebe a mesma resposta de sucesso e nada é gravado:
    // um erro ensinaria qual campo evitar.
    if (dados.website) return Response.json({ received: true }, { status: 201 });

    const db = getDatabase();
    const agora = Date.now();
    const evidencia = await requestEvidenceHashes(request);
    const recentes = await db.prepare(
      `SELECT SUM(CASE WHEN ip_hash = ?1 THEN 1 ELSE 0 END) AS do_ip, COUNT(*) AS total
         FROM meeting_requests WHERE created_at > ?2`,
    ).bind(evidencia.ipHash, agora - JANELA_MS).first<{ do_ip: number | null; total: number }>();
    if (Number(recentes?.do_ip ?? 0) >= TETO_POR_IP || Number(recentes?.total ?? 0) >= TETO_GERAL) {
      throw new ApiError(429, "too_many_requests", "Muitos pedidos em pouco tempo. Tente de novo em uma hora.");
    }
    // Reenvio do mesmo formulário (duplo clique, rede instável) não vira dois pedidos.
    const repetido = await db.prepare(
      `SELECT id FROM meeting_requests WHERE email = ?1 AND kind = ?2 AND preferred_day = ?3 AND preferred_period = ?4 AND status = 'new' LIMIT 1`,
    ).bind(dados.email, dados.kind, diaPreferido, periodo).first<{ id: string }>();
    if (repetido) return Response.json({ received: true }, { status: 200 });

    await db.prepare(
      `INSERT INTO meeting_requests (id, name, company, email, phone, team_size, preferred_day, preferred_period, message, origin, status, ip_hash, user_agent_hash, created_at, updated_at, kind)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'new', ?11, ?12, ?13, ?13, ?14)`,
    ).bind(crypto.randomUUID(), dados.name, dados.company, dados.email, dados.phone, dados.teamSize, diaPreferido,
      periodo, dados.message, dados.origin, evidencia.ipHash, evidencia.userAgentHash, agora, dados.kind).run();
    return Response.json({ received: true }, { status: 201 });
  });
}
