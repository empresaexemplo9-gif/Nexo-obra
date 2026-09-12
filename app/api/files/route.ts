import { ApiError, apiRoute, auditStatement, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { deleteObject, putObject } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

type FileRow = {
  id: string;
  project_id: string;
  project_name: string;
  project_code: string;
  storage_key: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  version: number;
  uploader_name: string | null;
  created_at: string;
};

const fileSelect = `SELECT f.id, f.project_id, p.name AS project_name, p.code AS project_code,
  f.storage_key, f.name, f.mime_type, f.size_bytes, f.version,
  m.name AS uploader_name, f.created_at
  FROM project_files f
  INNER JOIN projects p ON p.id = f.project_id AND p.organization_id = f.organization_id
  LEFT JOIN members m ON m.id = f.uploaded_by_member_id AND m.organization_id = f.organization_id`;

function fileResponse(row: FileRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectCode: row.project_code,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    version: row.version,
    uploaderName: row.uploader_name,
    createdAt: row.created_at,
    downloadUrl: `/api/files/${row.id}`,
  };
}

function safeName(value: string) {
  return value.replaceAll("\\", "/").split("/").at(-1)!
    .replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "arquivo";
}

async function boundedForm(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data;")) {
    throw new ApiError(415, "invalid_upload", "Envie o arquivo pelo formulário.");
  }
  const max = MAX_FILE_BYTES + 128 * 1024;
  const announced = Number(request.headers.get("content-length") ?? 0);
  if (announced > max) throw new ApiError(413, "file_too_large", "Cada arquivo pode ter no máximo 15 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "empty_upload", "Escolha um arquivo.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new ApiError(413, "file_too_large", "Cada arquivo pode ter no máximo 15 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try {
    return await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new ApiError(400, "invalid_upload", "Não foi possível ler o arquivo enviado.");
  }
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "files", "view");
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    const filters = ["f.organization_id = ?1"];
    const values: unknown[] = [context.organization.id];
    if (projectId) { values.push(projectId); filters.push(`f.project_id = ?${values.length}`); }
    const result = await context.db.prepare(
      `${fileSelect} WHERE ${filters.join(" AND ")} ORDER BY f.created_at DESC LIMIT 300`,
    ).bind(...values).all<FileRow>();
    return Response.json({ files: result.results.map(fileResponse) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "files", "edit");
    const form = await boundedForm(request);
    const projectId = String(form.get("projectId") ?? "").trim();
    const file = form.get("file");
    if (!projectId || !file || typeof file === "string") {
      throw new ApiError(400, "invalid_upload", "Escolha um projeto e um arquivo.");
    }
    const project = await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2")
      .bind(projectId, context.organization.id).first<{ id: string }>();
    if (!project) throw new ApiError(400, "invalid_project", "O projeto não pertence à empresa atual.");
    if (!file.size || file.size > MAX_FILE_BYTES) throw new ApiError(413, "file_too_large", "Cada arquivo pode ter no máximo 15 MB.");
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new ApiError(415, "invalid_file_type", "Use PDF, imagem, texto, CSV ou documento do Office. HTML, SVG e executáveis não são aceitos.");
    }
    const name = safeName(file.name);
    const bytes = await file.arrayBuffer();
    const previous = await context.db.prepare(
      "SELECT COALESCE(MAX(version), 0) AS version FROM project_files WHERE organization_id = ?1 AND project_id = ?2 AND lower(name) = lower(?3)",
    ).bind(context.organization.id, projectId, name).first<{ version: number }>();
    const version = Number(previous?.version ?? 0) + 1;
    const id = crypto.randomUUID();
    const key = await putObject(`files/${context.organization.id}/${projectId}/${id}`, bytes, file.type);
    try {
      await context.db.batch([
        context.db.prepare(
          `INSERT INTO project_files (
            id, organization_id, project_id,
            object_key, storage_key, name,
            content_type, mime_type, size, size_bytes,
            revision, version, uploaded_by_user_id, uploaded_by_member_id, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?6, ?7, ?7, ?8, ?8, ?9, ?10, CURRENT_TIMESTAMP)`,
        ).bind(
          id, context.organization.id, projectId, key, name, file.type, file.size,
          version, context.member.externalUserId, context.member.id,
        ),
        auditStatement(context, "file.uploaded", "project_file", id, { projectId, name, version, sizeBytes: file.size }),
      ]);
    } catch (error) {
      const saved = await context.db.prepare("SELECT id FROM project_files WHERE storage_key = ?1 AND organization_id = ?2")
        .bind(key, context.organization.id).first();
      if (!saved) await deleteObject(key).catch(() => undefined);
      throw error;
    }
    const row = await context.db.prepare(`${fileSelect} WHERE f.id = ?1 AND f.organization_id = ?2`)
      .bind(id, context.organization.id).first<FileRow>();
    return Response.json({ file: fileResponse(row!) }, { status: 201 });
  });
}
