"use client";

import { FILE_CHUNK_BYTES, MAX_ORG_FILE_BYTES, MAX_ORG_FILE_LABEL, blockedExtension } from "@/lib/org-files";

// Envio e download de arquivos em partes, do lado do navegador.
//
// Cada parte é enviada com nova tentativa em caso de falha de rede: reenviar a mesma parte
// no servidor substitui a anterior, então repetir é seguro. Nada é dado por enviado antes
// da confirmação do servidor na conclusão.

export type OrgFileInfo = {
  id: string; name: string; extension: string; mimeType: string; sizeBytes: number; chunkCount: number;
  status: string; inLibrary: boolean; projectId: string | null; projectName: string | null; projectCode: string | null;
  sourceFileId: string | null; conversion: string | null; uploadedByName: string; createdAt: string;
};

type UploadOptions = {
  area: "prancheta" | "conversa";
  projectId?: string | null;
  sourceFileId?: string | null;
  conversion?: string | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

async function errorFrom(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return new Error(body.error ?? `Falha de comunicação (HTTP ${response.status}).`);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(operation: () => Promise<T>, signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal?.aborted) throw new Error("Envio cancelado.");
    try { return await operation(); }
    catch (error) {
      lastError = error;
      // Erro de regra (4xx) não melhora repetindo; só rede e 5xx tentam de novo.
      if (error instanceof HttpError && error.status < 500) throw error;
      await wait(800 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Não foi possível enviar o arquivo.");
}

class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function checkBeforeUpload(file: { name: string; size: number }) {
  if (!file.size) return "O arquivo está vazio.";
  if (file.size > MAX_ORG_FILE_BYTES) return `Cada arquivo pode ter no máximo ${MAX_ORG_FILE_LABEL}.`;
  if (blockedExtension(file.name)) return "Executáveis e scripts não são aceitos.";
  return null;
}

export async function uploadOrgFile(blob: Blob, name: string, options: UploadOptions): Promise<OrgFileInfo> {
  const problem = checkBeforeUpload({ name, size: blob.size });
  if (problem) throw new Error(problem);
  const created = await fetch("/api/arquivos", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name, sizeBytes: blob.size, mimeType: blob.type || null, area: options.area,
      projectId: options.projectId ?? null, sourceFileId: options.sourceFileId ?? null, conversion: options.conversion ?? null,
    }),
    signal: options.signal,
  });
  if (!created.ok) throw await errorFrom(created);
  const { upload } = await created.json() as { upload: { id: string; chunkSize: number; chunkCount: number } };
  if (upload.chunkSize !== FILE_CHUNK_BYTES) throw new Error("O servidor mudou o tamanho das partes. Recarregue a página.");

  let sent = 0;
  for (let index = 0; index < upload.chunkCount; index += 1) {
    const slice = blob.slice(index * upload.chunkSize, (index + 1) * upload.chunkSize);
    await withRetry(async () => {
      const response = await fetch(`/api/arquivos/${upload.id}/partes/${index}`, {
        method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: slice, signal: options.signal,
      });
      if (!response.ok) { const error = await errorFrom(response); throw new HttpError(error.message, response.status); }
    }, options.signal);
    sent += slice.size;
    options.onProgress?.(sent / blob.size);
  }
  const finished = await withRetry(async () => {
    const response = await fetch(`/api/arquivos/${upload.id}/concluir`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ area: options.area }), signal: options.signal,
    });
    if (!response.ok) { const error = await errorFrom(response); throw new HttpError(error.message, response.status); }
    return response.json() as Promise<{ file: OrgFileInfo }>;
  }, options.signal);
  return finished.file;
}

/** Junta as partes num Blob com o tipo original. É o arquivo exatamente como foi enviado. */
export async function downloadOrgFile(file: Pick<OrgFileInfo, "id" | "chunkCount" | "mimeType" | "sizeBytes">, onProgress?: (fraction: number) => void, signal?: AbortSignal) {
  const pieces: ArrayBuffer[] = [];
  let received = 0;
  for (let index = 0; index < file.chunkCount; index += 1) {
    const buffer = await withRetry(async () => {
      const response = await fetch(`/api/arquivos/${file.id}/partes/${index}`, { cache: "no-store", signal });
      if (!response.ok) { const error = await errorFrom(response); throw new HttpError(error.message, response.status); }
      return response.arrayBuffer();
    }, signal);
    pieces.push(buffer);
    received += buffer.byteLength;
    onProgress?.(received / Math.max(1, file.sizeBytes));
  }
  if (received !== file.sizeBytes) throw new Error("O arquivo chegou incompleto. Tente de novo.");
  return new Blob(pieces, { type: file.mimeType || "application/octet-stream" });
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.rel = "noopener";
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadAndSave(file: OrgFileInfo, onProgress?: (fraction: number) => void) {
  saveBlob(await downloadOrgFile(file, onProgress), file.name);
}
