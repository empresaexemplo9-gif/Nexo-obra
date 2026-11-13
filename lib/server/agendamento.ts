import { timingSafeEqual } from "node:crypto";

import { ApiError } from "@/lib/server/api-error";
import { runtimeEnv } from "@/lib/server/runtime";

// Rotas chamadas por agendamento (cron da Vercel e GitHub Actions) só respondem a quem
// manda `Authorization: Bearer <CRON_SECRET>`. A Vercel envia esse cabeçalho sozinha nos
// crons dela; o GitHub Actions envia o mesmo segredo guardado nos secrets do repositório.
export function autorizarAgendamento(request: Request) {
  const segredo = runtimeEnv().CRON_SECRET;
  const recebido = Buffer.from(request.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${segredo}`);
  if (!segredo || recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
    throw new ApiError(401, "unauthorized", "Agendamento não autorizado.");
  }
}
