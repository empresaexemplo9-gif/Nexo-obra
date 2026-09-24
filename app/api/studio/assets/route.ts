import { ApiError, apiRoute, auditStatement, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { deleteObject, putObject } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

// 12 MB: cabe foto de referência e PDF de planta escaneada, e continua abaixo do limite
// de corpo de requisição da publicação.
const MAX_BYTES = 12 * 1024 * 1024;

// Só o que a tela consegue de fato desenhar ou exibir. DWG e DXF entram como anexo
// declarado: não existe leitor livre confiável do formato, e abrir errado uma planta é
// pior do que dizer que não abre.
const TIPOS_DESENHAVEIS = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);
const TIPOS_ANEXO = new Set(["application/pdf", "application/acad", "image/vnd.dwg", "application/dxf", "image/vnd.dxf", "application/octet-stream"]);
const CATEGORIAS = new Set(["mobilia", "textura", "referencia", "fundo", "anexo"]);

type Linha = {
  id: string; nome: string; mime_type: string; size_bytes: number; categoria: string;
  largura_mm: number | null; altura_mm: number | null; created_at: string;
};

function respostaAsset(linha: Linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    mimeType: linha.mime_type,
    sizeBytes: linha.size_bytes,
    categoria: linha.categoria,
    larguraMm: linha.largura_mm,
    alturaMm: linha.altura_mm,
    // Desenhável quer dizer que a tela consegue colocar na prancha. O que não é, aparece
    // como anexo para baixar — e é dito assim, não escondido.
    desenhavel: TIPOS_DESENHAVEIS.has(linha.mime_type),
    criadoEm: linha.created_at,
    url: `/api/studio/assets/${linha.id}`,
  };
}

const selecao = `SELECT id, nome, mime_type, size_bytes, categoria, largura_mm, altura_mm, created_at
  FROM studio_assets`;

function nomeSeguro(valor: string) {
  return valor.replaceAll("\\", "/").split("/").at(-1)!
    .replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "arquivo";
}

function medida(valor: FormDataEntryValue | null) {
  if (valor === null || valor === "") return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 200_000) {
    throw new ApiError(400, "invalid_measure", "A medida real deve ser um número inteiro de milímetros entre 1 e 200000.");
  }
  return numero;
}

async function formularioLimitado(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data;")) {
    throw new ApiError(415, "invalid_upload", "Envie o arquivo pelo formulário.");
  }
  const maximo = MAX_BYTES + 128 * 1024;
  const anunciado = Number(request.headers.get("content-length") ?? 0);
  if (anunciado > maximo) throw new ApiError(413, "file_too_large", "Cada arquivo pode ter no máximo 12 MB.");
  const leitor = request.body?.getReader();
  if (!leitor) throw new ApiError(400, "empty_upload", "Escolha um arquivo.");
  const pedacos: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximo) {
        await leitor.cancel();
        throw new ApiError(413, "file_too_large", "Cada arquivo pode ter no máximo 12 MB.");
      }
      pedacos.push(value);
    }
  } finally {
    leitor.releaseLock();
  }
  const corpo = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) { corpo.set(pedaco, posicao); posicao += pedaco.length; }
  try {
    return await new Response(corpo, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new ApiError(400, "invalid_upload", "Não foi possível ler o arquivo enviado.");
  }
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "view");
    const categoria = new URL(request.url).searchParams.get("categoria")?.trim();
    const filtros = ["organization_id = ?1"];
    const valores: unknown[] = [context.organization.id];
    if (categoria && CATEGORIAS.has(categoria)) { valores.push(categoria); filtros.push(`categoria = ?${valores.length}`); }
    const resultado = await context.db.prepare(
      `${selecao} WHERE ${filtros.join(" AND ")} ORDER BY created_at DESC LIMIT 500`,
    ).bind(...valores).all<Linha>();
    return Response.json({ itens: resultado.results.map(respostaAsset) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "edit");
    const formulario = await formularioLimitado(request);
    const arquivo = formulario.get("file");
    if (!arquivo || typeof arquivo === "string") throw new ApiError(400, "invalid_upload", "Escolha um arquivo.");
    const categoria = String(formulario.get("categoria") ?? "referencia");
    if (!CATEGORIAS.has(categoria)) throw new ApiError(400, "invalid_category", "Categoria inválida para a biblioteca.");
    if (!arquivo.size || arquivo.size > MAX_BYTES) throw new ApiError(413, "file_too_large", "Cada arquivo pode ter no máximo 12 MB.");
    // O navegador costuma mandar .dwg e .dxf sem tipo nenhum; a extensão decide nesse caso.
    const extensao = arquivo.name.toLowerCase().split(".").pop();
    const tipo = arquivo.type || (extensao === "dwg" ? "image/vnd.dwg" : extensao === "dxf" ? "image/vnd.dxf" : "");
    if (!TIPOS_DESENHAVEIS.has(tipo) && !TIPOS_ANEXO.has(tipo)) {
      throw new ApiError(415, "invalid_file_type", "Use imagem (PNG, JPEG, WebP ou AVIF), PDF, DWG ou DXF.");
    }
    const larguraMm = medida(formulario.get("larguraMm"));
    const alturaMm = medida(formulario.get("alturaMm"));
    const nome = nomeSeguro(arquivo.name);
    const id = crypto.randomUUID();
    const bytes = await arquivo.arrayBuffer();
    const chave = await putObject(`studio/${context.organization.id}/${id}`, bytes, tipo);
    try {
      await context.db.batch([
        context.db.prepare(
          `INSERT INTO studio_assets (id, organization_id, storage_key, nome, mime_type, size_bytes,
             categoria, largura_mm, altura_mm, enviado_por_membro_id, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CURRENT_TIMESTAMP)`,
        ).bind(id, context.organization.id, chave, nome, tipo, arquivo.size,
          categoria, larguraMm, alturaMm, context.member.id),
        auditStatement(context, "studio.asset.uploaded", "studio_asset", id, { nome, categoria, sizeBytes: arquivo.size }),
      ]);
    } catch (erro) {
      // Objeto gravado sem linha no banco é lixo invisível que ninguém apaga depois.
      const salvo = await context.db.prepare("SELECT id FROM studio_assets WHERE storage_key = ?1 AND organization_id = ?2")
        .bind(chave, context.organization.id).first();
      if (!salvo) await deleteObject(chave).catch(() => undefined);
      throw erro;
    }
    const linha = await context.db.prepare(`${selecao} WHERE id = ?1 AND organization_id = ?2`)
      .bind(id, context.organization.id).first<Linha>();
    return Response.json({ item: respostaAsset(linha!) }, { status: 201 });
  });
}
