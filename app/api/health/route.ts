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

// Descreve a FORMA do hash recebido, nunca o valor. Dizer só "ilegível, use ':'" é um
// beco sem saída para quem já usou ':' — a tela manda fazer o que a pessoa acabou de
// fazer. Comprimento, separador e número de partes apontam a causa na hora: 2 partes
// separadas por "$" é o hash mutilado pela expansão do painel; 4 partes com o prefixo
// certo e comprimento curto é outra coisa. Nada disso revela sal ou digest.
function formaDoHash(hash: string): string {
  if (!hash) return "o valor chegou vazio";
  const separador = hash.includes(":") ? ":" : hash.includes("$") ? "$" : null;
  if (!separador) return `recebi ${hash.length} caracteres sem nenhum separador ":" ou "$"`;
  const partes = hash.split(separador);
  const detalhes = [`recebi ${hash.length} caracteres em ${partes.length} parte(s) separadas por "${separador}"`];
  if (partes[0] !== "pbkdf2-sha256") detalhes.push(`a primeira parte deveria ser "pbkdf2-sha256" e veio "${partes[0]?.slice(0, 20) ?? ""}"`);
  if (partes.length === 4 && partes[1] !== "100000") detalhes.push(`o número de iterações deveria ser 100000 e veio "${partes[1]?.slice(0, 12) ?? ""}"`);
  if (partes.length !== 4) detalhes.push("o formato correto tem 4 partes: pbkdf2-sha256, iterações, sal e digest");
  if (separador === "$") detalhes.push("o separador \"$\" costuma ser expandido pelo painel: gere de novo com \":\"");
  return detalhes.join("; ");
}

function estadoDoSuperadmin(): { estado: Estado; detalhe?: string } {
  const env = runtimeEnv();
  if (!env.SUPERADMIN_EMAIL || !env.SUPERADMIN_PASSWORD_HASH || !env.SUPERADMIN_SESSION_SECRET) {
    const faltando = ["SUPERADMIN_EMAIL", "SUPERADMIN_PASSWORD_HASH", "SUPERADMIN_SESSION_SECRET"]
      .filter((nome) => !env[nome as keyof typeof env]);
    return { estado: "nao_configurado", detalhe: `faltam: ${faltando.join(", ")}` };
  }
  const hash = env.SUPERADMIN_PASSWORD_HASH.trim().replace(/^['"]|['"]$/g, "");
  if (/^pbkdf2-sha256([:$])100000\1[A-Za-z0-9_-]{8,}\1[A-Za-z0-9_-]{16,}$/.test(hash)) return { estado: "ok" };
  return { estado: "configuracao_invalida", detalhe: formaDoHash(hash) };
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
  // (o detalhe de qual variável falta é montado no GET, que tem as duas à mão)
  const bytes = (() => { try { return atob(env.MEDIA_ENCRYPTION_KEY.replaceAll("-", "+").replaceAll("_", "/")).length; } catch { return 0; } })();
  return bytes === 32 ? "ok" : "configuracao_invalida";
}

export async function GET() {
  const banco = await estadoDoBanco();
  const superadmin = estadoDoSuperadmin();
  const env = runtimeEnv();
  const areas = {
    banco: banco.estado,
    sessao: estadoDaSessao(),
    superadmin: superadmin.estado,
    armazenamento: estadoDoArmazenamento(),
  };
  // Detalhes estruturais para o diagnóstico da tela de acesso: dizem o que conferir, e
  // nunca carregam valor de segredo, URL, token ou e-mail.
  const detalhes: Record<string, string> = {};
  if (superadmin.detalhe) detalhes.superadmin = superadmin.detalhe;
  if (areas.armazenamento === "nao_configurado") {
    const faltando = ["BLOB_READ_WRITE_TOKEN", "MEDIA_ENCRYPTION_KEY"].filter((nome) => !env[nome as keyof typeof env]);
    detalhes.armazenamento = `faltam: ${faltando.join(", ")}`;
  }
  // Arquivos e fotos agora são parte do fluxo profissional. Por isso armazenamento deixa
  // de ser opcional para o selo `pronto`: publicação sem Blob/chave pode abrir telas, mas
  // não deve ser declarada pronta para uso operacional completo.
  const pronto = areas.banco === "ok" && areas.sessao === "ok" && areas.superadmin === "ok" && areas.armazenamento === "ok";
  return Response.json(
    {
      pronto, versao: PLATFORM_BUILD, compiladoEm: PLATFORM_BUILT_AT, ...areas,
      migracoes: banco.migracoes,
      ...(Object.keys(detalhes).length ? { detalhes } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
