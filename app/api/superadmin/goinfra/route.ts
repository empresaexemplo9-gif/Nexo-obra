import { ApiError } from "@/lib/server/api-error";
import { apiRoute, validationError } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";
import { checkPortalOrigin } from "@/lib/server/portal";
import { getDatabase } from "@/db";
import { envioGoinfraSchema, rotuloRegimeGoinfra, rotuloTabelaGoinfra } from "@/lib/integrations/goinfra-planilha";
import { importarGoinfra, limparImportacoesInterrompidas } from "@/lib/server/goinfra-import";
import { tabelasGoinfra } from "@/lib/server/compras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LIMITE = 30 * 1024 * 1024;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

async function situacao() {
  const tabelas = await tabelasGoinfra({ db: getDatabase() });
  return {
    tables: tabelas.filter((t) => !t.tabela.startsWith("importando-")).map((t) => ({
      id: t.id, referencia: t.referencia, tabela: t.tabela, regime: t.regime,
      label: `${rotuloTabelaGoinfra[t.tabela] ?? t.tabela} · ${rotuloRegimeGoinfra[t.regime] ?? t.regime}`,
      arquivo: t.arquivo_nome, sha256: t.arquivo_sha256, bytes: Number(t.arquivo_bytes), aba: t.aba,
      totalItens: Number(t.total_itens), ignoradas: Number(t.ignoradas), importadoPor: t.importado_por, importadoEm: Number(t.importado_em),
    })),
  };
}

export async function GET(request: Request) {
  return apiRoute(async () => { await requireSuperAdmin(request); return json(await situacao()); });
}

// A GOINFRA publica a tabela como arquivo no site, sem API. O superadministrador baixa a
// planilha oficial e envia aqui; o arquivo é lido, conferido e vira a referência ativa.
export async function PUT(request: Request) {
  return apiRoute(async () => {
    checkPortalOrigin(request);
    const admin = await requireSuperAdmin(request);
    const form = await request.formData().catch(() => null);
    if (!form) throw validationError({ formErrors: ["Envie o arquivo como multipart/form-data."], fieldErrors: {} });
    const parsed = envioGoinfraSchema.safeParse({ referencia: form.get("referencia"), tabela: form.get("tabela"), regime: form.get("regime") });
    if (!parsed.success) throw validationError(parsed.error.flatten());
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File) || !arquivo.size) throw validationError({ formErrors: ["Anexe a planilha da GOINFRA (XLSX ou CSV)."], fieldErrors: {} });
    if (arquivo.size > LIMITE) throw validationError({ formErrors: [`O arquivo tem ${Math.round(arquivo.size / 1048576)} MB e o limite é ${LIMITE / 1048576} MB.`], fieldErrors: {} });
    await limparImportacoesInterrompidas();
    try {
      const resultado = await importarGoinfra({ nome: arquivo.name, bytes: Buffer.from(await arquivo.arrayBuffer()) }, parsed.data, admin.email);
      return json({
        imported: !resultado.repetido, repeated: resultado.repetido,
        report: { aba: resultado.interpretacao.aba, linhaDoCabecalho: resultado.interpretacao.linhaDoCabecalho + 1, itens: resultado.interpretacao.itens.length, ignoradas: resultado.interpretacao.ignoradas },
        ...(await situacao()),
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const mensagem = error instanceof Error ? error.message : "";
      if (/^(Não foi possível ler|A planilha tem|Já está ativa)/.test(mensagem)) throw new ApiError(422, "goinfra_invalid_file", mensagem);
      throw error;
    }
  });
}
