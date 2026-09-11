import { databaseSettings, getDatabase } from "@/db";
import { PLATFORM_BUILD, PLATFORM_BUILT_AT } from "@/lib/build-info";
import { migrationStatus } from "@/lib/server/migrations";
import { runtimeEnv } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

// Diagnóstico da instalação.
//
// Esta rota existe porque faltou exatamente ela. Com o produto publicado e a
// configuração incompleta, a única coisa visível era uma mensagem genérica na tela de
// login; sem logs de runtime no plano gratuito, não havia como distinguir "faltou a
// variável" de "a variável está errada" de "falta migrar". Horas de tentativa às cegas.
//
// O que ela NÃO devolve, por princípio: valor de variável, nome de variável, endereço do
// banco, token, e-mail, ou o texto do erro do driver. Só uma palavra por área. Quem
// tiver a URL aprende que a plataforma existe e se está instalada — nada além disso.

type Estado = "ok" | "nao_configurado" | "inalcancavel" | "falta_migrar" | "configuracao_invalida";

async function estadoDoBanco(): Promise<{ estado: Estado; migracoes?: { aplicadas: number; pendentes: number } }> {
  if (!databaseSettings()) return { estado: "nao_configurado" };
  try {
    const status = await migrationStatus(getDatabase());
    return {
      estado: status.pending.length ? "falta_migrar" : "ok",
      migracoes: { aplicadas: status.applied.length, pendentes: status.pending.length },
    };
  } catch {
    // Conexão recusada, token vencido, servidor fora. O motivo exato fica no log do
    // servidor; aqui só a categoria.
    return { estado: "inalcancavel" };
  }
}

function estadoDoSuperadmin(): Estado {
  const env = runtimeEnv();
  if (!env.SUPERADMIN_EMAIL || !env.SUPERADMIN_PASSWORD_HASH || !env.SUPERADMIN_SESSION_SECRET) return "nao_configurado";
  // Um hash mutilado pela expansão de `$` no painel já aconteceu aqui: `$salt` e `$digest`
  // viraram texto vazio e o login passou a recusar a senha correta sem dizer por quê.
  // Conferir só o formato basta para separar "senha errada" de "hash corrompido".
  const hash = env.SUPERADMIN_PASSWORD_HASH.trim().replace(/^['"]|['"]$/g, "");
  const formato = /^pbkdf2-sha256([:$])100000\1[A-Za-z0-9_-]{8,}\1[A-Za-z0-9_-]{16,}$/.test(hash);
  return formato ? "ok" : "configuracao_invalida";
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
  // A chave precisa ter 32 bytes em base64; senão nenhuma foto é gravada.
  const bytes = (() => {
    try { return atob(env.MEDIA_ENCRYPTION_KEY.replaceAll("-", "+").replaceAll("_", "/")).length; } catch { return 0; }
  })();
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
  // "pronto" só quando o que o produto precisa para operar está de pé. O armazenamento de
  // fotos não entra: sem ele o diário ainda funciona em texto.
  const pronto = areas.banco === "ok" && areas.sessao === "ok" && areas.superadmin === "ok";
  return Response.json(
    { pronto, versao: PLATFORM_BUILD, compiladoEm: PLATFORM_BUILT_AT, ...areas, migracoes: banco.migracoes },
    { headers: { "Cache-Control": "no-store" } },
  );
}
