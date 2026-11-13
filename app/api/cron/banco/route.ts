import { getDatabase } from "@/db";
import { apiRoute } from "@/lib/server/backend";
import { autorizarAgendamento } from "@/lib/server/agendamento";
import { atualizarAutomaticamente } from "@/lib/server/migrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Atualização automática do banco. Chamada de hora em hora pelo GitHub Actions
// (.github/workflows/banco-de-dados.yml) e uma vez por dia pelo cron da Vercel, que no
// plano Hobby não aceita intervalo menor. Aplica só migração aditiva; o resto espera o
// painel do superadministrador.
export async function GET(request: Request) {
  return apiRoute(async () => {
    autorizarAgendamento(request);
    const origem = request.headers.get("user-agent")?.includes("vercel-cron") ? "cron da Vercel" : "agendamento de hora em hora";
    const resultado = await atualizarAutomaticamente(getDatabase(), origem);
    if (resultado.applied.length) console.log(`DRAP Backoffice migrações aplicadas automaticamente: ${resultado.applied.map((m) => m.id).join(", ")}`);
    // Pendência que precisa de revisão não é falha do agendamento: responde 200 e diz o
    // motivo, que também aparece no painel do superadministrador.
    return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
  });
}
