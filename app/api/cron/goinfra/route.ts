import { apiRoute } from "@/lib/server/backend";
import { autorizarAgendamento } from "@/lib/server/agendamento";
import { buscarGoinfra } from "@/lib/server/goinfra-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Busca diária da tabela GOINFRA (cron da Vercel). Importa só referência mais nova que a
// ativa; nos outros dias responde "atual" sem baixar planilha.
export async function GET(request: Request) {
  return apiRoute(async () => {
    autorizarAgendamento(request);
    return Response.json({ ok: true, ...(await buscarGoinfra("agendamento automático")) }, { headers: { "Cache-Control": "no-store" } });
  });
}
