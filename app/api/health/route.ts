import { databaseSettings, getDatabase } from "@/db";
import { PLATFORM_BUILD, PLATFORM_BUILT_AT } from "@/lib/build-info";
import { migrationStatus } from "@/lib/server/migrations";
import { runtimeEnv } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

type Estado = "ok" | "nao_configurado" | "inalcancavel" | "falta_migrar" | "configuracao_invalida";

async function estadoDoBanco(): Promise<{ estado: Estado; migracoes?: { aplicadas: number; pendentes: number } }> {
  if (!databaseSettings()) return { estado: "nao_configurado" };
  try {
    const status = await migrationStatus(getDatabase());
    return { estado: status.pending.length ? "falta_migrar" : "ok", migracoes: { aplicadas: status.applied.length, pendentes: status.pending.length } };
  } catch { return { estado: "inalcancavel" }; }
}

function estadoDoSuperadmin(): Estado {
  const env = runtimeEnv();
  if (!env.SUPERADMIN_EMAIL || !env.SUPERADMIN_PASSWORD_HASH || !env.SUPERADMIN_SESSION_SECRET) return "nao_configurado";
  const hash = env.SUPERADMIN_PASSWORD_HASH.trim().replace(/^['"]|['"]$/g, "");
  return /^pbkdf2-sha256([:$])100000\1[A-Za-z0-9_-]{8,}\1[A-Za-z0-9_-]{16,}$/.test(hash) ? "ok" : "configuracao_invalida";
}

function estadoDaSessao(): Estado {
  const env = runtimeEnv();
  const segredo = env.SESSION_SECRET ?? env.SUPERADMIN_SESSION_SECRET;
  if (!segredo) return "nao_configurado";
  return segredo.length >= 32 ? "ok" : "configuracao_invalida";
}

function estadoDoArmazenamento(): Estado {
  const env = runtimeEnv();
  if (!env.BLOB_READ_WRITE_TOKEN || !env.MEDIA_ENCRYPTION_KEY) return "nao_configurado";
  const bytes = (() => { try { return atob(env.MEDIA_ENCRYPTION_KEY.replaceAll("-", "+").replaceAll("_", "/")).length; } catch { return 0; } })();
  return bytes === 32 ? "ok" : "configuracao_invalida";
}

export async function GET() {
  const banco = await estadoDoBanco();
  const areas = {
    banco: banco.estado,
    sessao: estadoDaSessao(),
    superadmin: estadoDoSuperadmin(),
    armazenamento: estadoDoArmazenamento(),
  };
  // Arquivos e fotos agora são parte do fluxo profissional. Por isso armazenamento deixa
  // de ser opcional para o selo `pronto`: publicação sem Blob/chave pode abrir telas, mas
  // não deve ser declarada pronta para uso operacional completo.
  const pronto = areas.banco === "ok" && areas.sessao === "ok" && areas.superadmin === "ok" && areas.armazenamento === "ok";
  return Response.json(
    { pronto, versao: PLATFORM_BUILD, compiladoEm: PLATFORM_BUILT_AT, ...areas, migracoes: banco.migracoes },
    { headers: { "Cache-Control": "no-store" } },
  );
}
