import { z } from "zod";

import { ApiError, auditStatement, isPlatformSuperAdmin, type OrganizationContext } from "@/lib/server/backend";
import { deleteObject, getObject, putObject } from "@/lib/server/storage";
import {
  blockedExtension, chunkCountFor, expectedChunkSize, extensionOf, FILE_CHUNK_BYTES, MAX_ORG_FILE_BYTES,
  MAX_ORG_FILE_LABEL, mimeFor, safeFileName,
} from "@/lib/org-files";

// Arquivos da empresa em partes cifradas. Ver o comentário de `org_files` em db/schema.ts.
//
// A autorização é sempre pela empresa da sessão: toda consulta filtra `organization_id`,
// e um identificador de outra empresa responde 404, igual a um que não existe.

export type OrgFileRow = {
  id: string; organization_id: string; project_id: string | null; project_name?: string | null; project_code?: string | null;
  name: string; extension: string; mime_type: string; size_bytes: number; chunk_size: number; chunk_count: number;
  status: string; in_library: number; source_file_id: string | null; conversion: string | null;
  uploaded_by_member_id: string; uploaded_by_name: string; created_at: string; ready_at: string | null;
};

export const fileSelect = `SELECT f.id, f.organization_id, f.project_id, p.name AS project_name, p.code AS project_code,
  f.name, f.extension, f.mime_type, f.size_bytes, f.chunk_size, f.chunk_count, f.status, f.in_library,
  f.source_file_id, f.conversion, f.uploaded_by_member_id, f.uploaded_by_name, f.created_at, f.ready_at
  FROM org_files f
  LEFT JOIN projects p ON p.id = f.project_id AND p.organization_id = f.organization_id`;

export function fileResponse(row: OrgFileRow) {
  return {
    id: row.id,
    name: row.name,
    extension: row.extension,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    chunkCount: Number(row.chunk_count),
    status: row.status,
    inLibrary: Boolean(row.in_library),
    projectId: row.project_id,
    projectName: row.project_name ?? null,
    projectCode: row.project_code ?? null,
    sourceFileId: row.source_file_id,
    conversion: row.conversion,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
  };
}

export type OrgFile = ReturnType<typeof fileResponse>;

export const createUploadSchema = z.object({
  name: z.string().trim().min(1).max(240),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().max(160).optional().nullable(),
  // prancheta: entra na biblioteca ao concluir; conversa: só existe como anexo.
  area: z.enum(["prancheta", "conversa"]),
  projectId: z.string().trim().min(1).max(80).optional().nullable(),
  sourceFileId: z.string().trim().min(1).max(80).optional().nullable(),
  conversion: z.enum(["dxf-pdf", "dxf-svg", "dxf-png", "pdf-png", "pdf-jpg", "imagem-pdf"]).optional().nullable(),
}).strict();

const now = () => new Date().toISOString();

export async function findFile(context: OrganizationContext, fileId: string) {
  const row = await context.db.prepare(`${fileSelect} WHERE f.id = ?1 AND f.organization_id = ?2`)
    .bind(fileId, context.organization.id).first<OrgFileRow>();
  if (!row) throw new ApiError(404, "file_not_found", "Arquivo não encontrado.");
  return row;
}

function canUseLibrary(context: OrganizationContext, action: "view" | "edit") {
  return isPlatformSuperAdmin(context) || context.member.permissions.studio[action];
}

/**
 * Quem pode ler: a biblioteca segue a permissão da Prancheta; o anexo segue a conversa
 * em que foi enviado. Quem enviou sempre lê o que enviou.
 */
export async function canReadFile(context: OrganizationContext, file: OrgFileRow, depth = 0): Promise<boolean> {
  if (file.uploaded_by_member_id === context.member.id) return true;
  if (file.status !== "ready") return false;
  if (file.in_library && canUseLibrary(context, "view")) return true;
  // Cópia para visualização (o DXF de um DWG): quem lê o original lê a cópia.
  if (!file.in_library && file.source_file_id && file.conversion === "dwg-dxf" && depth === 0) {
    const source = await context.db.prepare(`${fileSelect} WHERE f.id = ?1 AND f.organization_id = ?2`)
      .bind(file.source_file_id, context.organization.id).first<OrgFileRow>();
    if (source && await canReadFile(context, source, 1)) return true;
  }
  const shared = await context.db.prepare(
    `SELECT 1 AS ok FROM chat_message_files mf
     INNER JOIN chat_messages m ON m.id = mf.message_id AND m.organization_id = mf.organization_id AND m.deleted_at IS NULL
     INNER JOIN chat_channels c ON c.id = m.channel_id AND c.organization_id = m.organization_id
     LEFT JOIN chat_participants cp ON cp.channel_id = c.id AND cp.member_id = ?3 AND cp.is_member = 1
     WHERE mf.organization_id = ?1 AND mf.file_id = ?2 AND (c.kind = 'canal' OR cp.id IS NOT NULL)
     LIMIT 1`,
  ).bind(context.organization.id, file.id, context.member.id).first<{ ok: number }>();
  return Boolean(shared);
}

export async function requireReadableFile(context: OrganizationContext, fileId: string) {
  const file = await findFile(context, fileId);
  // Sem acesso responde igual a inexistente: não se confirma a existência do arquivo.
  if (!(await canReadFile(context, file))) throw new ApiError(404, "file_not_found", "Arquivo não encontrado.");
  return file;
}

export async function createUpload(context: OrganizationContext, input: z.infer<typeof createUploadSchema>) {
  if (input.area === "prancheta" && !canUseLibrary(context, "edit")) {
    throw new ApiError(403, "module_permission_denied", "Seu acesso não permite enviar arquivos à Prancheta.");
  }
  const name = safeFileName(input.name);
  if (blockedExtension(name)) {
    throw new ApiError(415, "blocked_file_type", "Executáveis e scripts não são aceitos. Compacte em .zip só se for indispensável e avise quem vai receber.");
  }
  if (input.sizeBytes > MAX_ORG_FILE_BYTES) {
    throw new ApiError(413, "file_too_large", `Cada arquivo pode ter no máximo ${MAX_ORG_FILE_LABEL}.`);
  }
  if (input.projectId) {
    const project = await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2")
      .bind(input.projectId, context.organization.id).first();
    if (!project) throw new ApiError(400, "invalid_project", "O projeto não pertence à empresa atual.");
  }
  if (Boolean(input.sourceFileId) !== Boolean(input.conversion)) {
    throw new ApiError(400, "invalid_conversion", "Informe o arquivo de origem e o tipo de conversão juntos.");
  }
  if (input.sourceFileId) await requireReadableFile(context, input.sourceFileId);

  await removeStaleUploads(context);
  const id = crypto.randomUUID();
  const chunkCount = chunkCountFor(input.sizeBytes);
  await context.db.prepare(
    `INSERT INTO org_files (id, organization_id, project_id, name, extension, mime_type, size_bytes, chunk_size, chunk_count,
      status, in_library, source_file_id, conversion, uploaded_by_member_id, uploaded_by_name, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'uploading', 0, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(
    id, context.organization.id, input.projectId ?? null, name, extensionOf(name), mimeFor(name, input.mimeType),
    input.sizeBytes, FILE_CHUNK_BYTES, chunkCount, input.sourceFileId ?? null, input.conversion ?? null,
    context.member.id, context.user.displayName, now(),
  ).run();
  return { id, chunkSize: FILE_CHUNK_BYTES, chunkCount, area: input.area };
}

async function readBoundedBody(request: Request, limit: number) {
  const announced = Number(request.headers.get("content-length") ?? 0);
  if (announced > limit) throw new ApiError(413, "chunk_too_large", "Parte maior que o permitido.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "empty_chunk", "Parte vazia.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new ApiError(413, "chunk_too_large", "Parte maior que o permitido."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

/** Grava uma parte. Reenviar a mesma parte substitui a anterior: o retry é seguro. */
export async function storeChunk(context: OrganizationContext, fileId: string, index: number, request: Request) {
  const file = await findFile(context, fileId);
  if (file.uploaded_by_member_id !== context.member.id) throw new ApiError(404, "file_not_found", "Arquivo não encontrado.");
  if (file.status !== "uploading") throw new ApiError(409, "upload_closed", "Este envio já foi concluído.");
  const expected = Number.isInteger(index) ? expectedChunkSize(Number(file.size_bytes), index) : -1;
  if (expected < 0) throw new ApiError(400, "invalid_chunk", "Parte fora do arquivo.");
  const bytes = await readBoundedBody(request, FILE_CHUNK_BYTES);
  if (bytes.byteLength !== expected) {
    throw new ApiError(400, "invalid_chunk_size", `A parte ${index + 1} chegou com ${bytes.byteLength} bytes; eram esperados ${expected}.`);
  }
  const key = await putObject(`org-files/${context.organization.id}/${file.id}/${index}`, bytes.slice().buffer, "application/octet-stream");
  const previous = await context.db.prepare(
    "SELECT storage_key FROM org_file_chunks WHERE file_id = ?1 AND organization_id = ?2 AND chunk_index = ?3",
  ).bind(file.id, context.organization.id, index).first<{ storage_key: string }>();
  try {
    await context.db.prepare(
      `INSERT INTO org_file_chunks (id, file_id, organization_id, chunk_index, storage_key, size_bytes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(file_id, chunk_index) DO UPDATE SET storage_key = excluded.storage_key, size_bytes = excluded.size_bytes`,
    ).bind(crypto.randomUUID(), file.id, context.organization.id, index, key, bytes.byteLength).run();
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    throw error;
  }
  if (previous && previous.storage_key !== key) await deleteObject(previous.storage_key).catch(() => undefined);
  return { index, sizeBytes: bytes.byteLength };
}

export async function completeUpload(context: OrganizationContext, fileId: string, area: "prancheta" | "conversa") {
  const file = await findFile(context, fileId);
  if (file.uploaded_by_member_id !== context.member.id) throw new ApiError(404, "file_not_found", "Arquivo não encontrado.");
  if (file.status === "ready") return file;
  if (area === "prancheta" && !canUseLibrary(context, "edit")) {
    throw new ApiError(403, "module_permission_denied", "Seu acesso não permite enviar arquivos à Prancheta.");
  }
  const parts = await context.db.prepare(
    "SELECT chunk_index, size_bytes FROM org_file_chunks WHERE file_id = ?1 AND organization_id = ?2 ORDER BY chunk_index",
  ).bind(file.id, context.organization.id).all<{ chunk_index: number; size_bytes: number }>();
  const total = parts.results.reduce((sum, part) => sum + Number(part.size_bytes), 0);
  const complete = parts.results.length === Number(file.chunk_count)
    && parts.results.every((part, index) => Number(part.chunk_index) === index)
    && total === Number(file.size_bytes);
  if (!complete) {
    const missing = Number(file.chunk_count) - parts.results.length;
    throw new ApiError(409, "upload_incomplete", missing > 0 ? `Faltam ${missing} parte(s) do arquivo. Envie novamente.` : "As partes não somam o tamanho do arquivo. Envie novamente.");
  }
  // Só a primeira conclusão vale: duas abas concluindo o mesmo envio não duplicam auditoria.
  const claimed = await context.db.prepare(
    "UPDATE org_files SET status = 'ready', in_library = ?3, ready_at = ?4 WHERE id = ?1 AND organization_id = ?2 AND status = 'uploading'",
  ).bind(file.id, context.organization.id, area === "prancheta" ? 1 : 0, now()).run();
  if (Number(claimed.meta?.changes ?? 0) > 0) {
    await auditStatement(context, area === "prancheta" ? "prancheta.file_added" : "chat.file_uploaded", "org_file", file.id, {
      name: file.name, sizeBytes: Number(file.size_bytes), conversion: file.conversion, sourceFileId: file.source_file_id,
    }).run();
  }
  return findFile(context, file.id);
}

export async function readChunk(context: OrganizationContext, fileId: string, index: number) {
  const file = await requireReadableFile(context, fileId);
  if (file.status !== "ready") throw new ApiError(409, "upload_incomplete", "O envio deste arquivo ainda não terminou.");
  if (!Number.isInteger(index) || index < 0 || index >= Number(file.chunk_count)) throw new ApiError(400, "invalid_chunk", "Parte fora do arquivo.");
  const part = await context.db.prepare(
    "SELECT storage_key FROM org_file_chunks WHERE file_id = ?1 AND organization_id = ?2 AND chunk_index = ?3",
  ).bind(file.id, context.organization.id, index).first<{ storage_key: string }>();
  const object = part ? await getObject(part.storage_key) : null;
  if (!object?.body) throw new ApiError(404, "file_content_missing", "O conteúdo deste arquivo não está disponível no armazenamento.");
  return object.body;
}

/** O arquivo inteiro na memória do servidor. Só para conversão, com teto próprio. */
export async function readWholeFile(context: OrganizationContext, file: OrgFileRow, maxBytes: number) {
  if (Number(file.size_bytes) > maxBytes) throw new ApiError(413, "file_too_large_to_convert", "Arquivo grande demais para converter no servidor.");
  const output = new Uint8Array(Number(file.size_bytes));
  let offset = 0;
  for (let index = 0; index < Number(file.chunk_count); index += 1) {
    const body = await readChunk(context, file.id, index);
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    if (offset + bytes.byteLength > output.byteLength) throw new ApiError(500, "file_corrupted", "As partes do arquivo não conferem com o tamanho registrado.");
    output.set(bytes, offset);
    offset += bytes.byteLength;
  }
  if (offset !== output.byteLength) throw new ApiError(500, "file_corrupted", "As partes do arquivo não conferem com o tamanho registrado.");
  return output;
}

/** Grava um arquivo gerado no servidor (conversão), já em partes e pronto. */
export async function storeGeneratedFile(context: OrganizationContext, input: {
  name: string; mimeType: string; bytes: Uint8Array; sourceFileId: string; conversion: string; projectId: string | null; inLibrary: boolean;
}) {
  const id = crypto.randomUUID();
  const chunkCount = chunkCountFor(input.bytes.byteLength);
  const keys: string[] = [];
  try {
    const statements = [context.db.prepare(
      `INSERT INTO org_files (id, organization_id, project_id, name, extension, mime_type, size_bytes, chunk_size, chunk_count,
        status, in_library, source_file_id, conversion, uploaded_by_member_id, uploaded_by_name, created_at, ready_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'ready', ?10, ?11, ?12, ?13, ?14, ?15, ?15)`,
    ).bind(
      id, context.organization.id, input.projectId, safeFileName(input.name), extensionOf(input.name), input.mimeType,
      input.bytes.byteLength, FILE_CHUNK_BYTES, chunkCount, input.inLibrary ? 1 : 0, input.sourceFileId, input.conversion,
      context.member.id, context.user.displayName, now(),
    )];
    for (let index = 0; index < chunkCount; index += 1) {
      const part = input.bytes.slice(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES);
      const key = await putObject(`org-files/${context.organization.id}/${id}/${index}`, part.buffer, "application/octet-stream");
      keys.push(key);
      statements.push(context.db.prepare(
        "INSERT INTO org_file_chunks (id, file_id, organization_id, chunk_index, storage_key, size_bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      ).bind(crypto.randomUUID(), id, context.organization.id, index, key, part.byteLength));
    }
    statements.push(auditStatement(context, "prancheta.file_converted", "org_file", id, { sourceFileId: input.sourceFileId, conversion: input.conversion }));
    await context.db.batch(statements);
  } catch (error) {
    await Promise.all(keys.map((key) => deleteObject(key).catch(() => undefined)));
    throw error;
  }
  return findFile(context, id);
}

/** Apaga o arquivo quando não está na biblioteca e nenhuma mensagem o usa. */
export async function purgeIfOrphan(context: OrganizationContext, fileId: string) {
  const file = await context.db.prepare("SELECT id, in_library, status FROM org_files WHERE id = ?1 AND organization_id = ?2")
    .bind(fileId, context.organization.id).first<{ id: string; in_library: number; status: string }>();
  if (!file || (file.in_library && file.status === "ready")) return false;
  const used = await context.db.prepare("SELECT 1 AS ok FROM chat_message_files WHERE organization_id = ?1 AND file_id = ?2 LIMIT 1")
    .bind(context.organization.id, fileId).first();
  // Conversão feita a partir dele continua valendo sozinha: o vínculo é só informativo.
  if (used) return false;
  await purgeFile(context.db, context.organization.id, fileId);
  return true;
}

async function purgeFile(db: D1Database, organizationId: string, fileId: string): Promise<void> {
  // A cópia de visualização some junto; conversão que está na biblioteca ou numa conversa fica.
  const hidden = await db.prepare(
    `SELECT f.id FROM org_files f WHERE f.organization_id = ?1 AND f.source_file_id = ?2 AND f.in_library = 0
     AND NOT EXISTS (SELECT 1 FROM chat_message_files mf WHERE mf.organization_id = f.organization_id AND mf.file_id = f.id)`,
  ).bind(organizationId, fileId).all<{ id: string }>();
  for (const derived of hidden.results) await purgeFile(db, organizationId, derived.id);
  const parts = await db.prepare("SELECT storage_key FROM org_file_chunks WHERE file_id = ?1 AND organization_id = ?2")
    .bind(fileId, organizationId).all<{ storage_key: string }>();
  await db.batch([
    db.prepare("DELETE FROM org_file_chunks WHERE file_id = ?1 AND organization_id = ?2").bind(fileId, organizationId),
    db.prepare("UPDATE org_files SET source_file_id = NULL WHERE source_file_id = ?1 AND organization_id = ?2").bind(fileId, organizationId),
    db.prepare("DELETE FROM org_files WHERE id = ?1 AND organization_id = ?2").bind(fileId, organizationId),
  ]);
  await Promise.all(parts.results.map((part) => deleteObject(part.storage_key).catch(() => undefined)));
}

/** Envio abandonado há mais de um dia não ocupa armazenamento para sempre. */
async function removeStaleUploads(context: OrganizationContext) {
  const limit = new Date(Date.now() - 86_400_000).toISOString();
  const stale = await context.db.prepare(
    "SELECT id FROM org_files WHERE organization_id = ?1 AND status = 'uploading' AND created_at < ?2 LIMIT 20",
  ).bind(context.organization.id, limit).all<{ id: string }>();
  for (const row of stale.results) await purgeFile(context.db, context.organization.id, row.id);
}

/** Tira da biblioteca. O arquivo continua para quem o recebeu numa conversa. */
export async function removeFromLibrary(context: OrganizationContext, fileId: string) {
  const file = await findFile(context, fileId);
  // Envio próprio que não foi à biblioteca: anexo que a pessoa desistiu de mandar. Só some
  // se nenhuma mensagem o usa (purgeIfOrphan confere).
  const ownPending = file.uploaded_by_member_id === context.member.id && (file.status === "uploading" || !file.in_library);
  if (ownPending && !file.in_library) {
    await purgeIfOrphan(context, file.id);
    return;
  }
  if (!ownPending && !canUseLibrary(context, "edit")) {
    throw new ApiError(403, "module_permission_denied", "Seu acesso não permite excluir arquivos da Prancheta.");
  }
  if (!ownPending && !file.in_library) throw new ApiError(404, "file_not_found", "Arquivo não encontrado.");
  await context.db.batch([
    context.db.prepare("UPDATE org_files SET in_library = 0 WHERE id = ?1 AND organization_id = ?2").bind(file.id, context.organization.id),
    auditStatement(context, "prancheta.file_removed", "org_file", file.id, { name: file.name }),
  ]);
  await purgeIfOrphan(context, file.id);
}
