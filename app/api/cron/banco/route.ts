import { getDatabase } from "@/db";
import { apiRoute } from "@/lib/server/backend";
import { autorizarAgendamento } from "@/lib/server/agendamento";
import { atualizarAutomaticamente } from "@/lib/server/migrations";
import { sincronizarGoinfra } from "@/lib/server/goinfra-fonte";

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
    // Depois do esquema em dia, as tabelas oficiais da GOINFRA: a mesma chamada de hora em
    // hora confere o site, no máximo uma vez a cada 20 horas. Falha lá não derruba a
    // atualização do banco; fica registrada e aparece no painel.
    let goinfra: unknown = null;
    if (!resultado.pending.length) {
      try { goinfra = await sincronizarGoinfra(origem); }
      catch (error) { goinfra = { ran: false, error: error instanceof Error ? error.message : String(error) }; }
    }
    // Pendência que precisa de revisão não é falha do agendamento: responde 200 e diz o
    // motivo, que também aparece no painel do superadministrador.
    return Response.json({ ...resultado, goinfra }, { headers: { "Cache-Control": "no-store" } });
  });
}
