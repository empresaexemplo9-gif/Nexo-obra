"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Download, File, Files, LoaderCircle, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Project = { id: string; code: string; name: string };
type ProjectFile = {
  id: string; projectId: string; projectName: string; projectCode: string; name: string;
  mimeType: string; sizeBytes: number; version: number; uploaderName: string | null;
  createdAt: string; downloadUrl: string;
};

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}

async function errorMessage(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? "Não foi possível concluir a operação.";
}

export function FilesWorkspace({ projects, query, canEdit }: { projects: Project[]; query: string; canEdit: boolean }) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [projectId, setProjectId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const suffix = projectId === "all" ? "" : `?projectId=${encodeURIComponent(projectId)}`;
      const response = await fetch(`/api/files${suffix}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json() as { files: ProjectFile[] };
      setFiles(body.files);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os arquivos."); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { void reload(); }, [reload]);

  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const filtered = useMemo(() => files.filter((item) => !normalized || `${item.name} ${item.projectName} ${item.projectCode}`.toLocaleLowerCase("pt-BR").includes(normalized)), [files, normalized]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setUploading(true);
    const form = new FormData(event.currentTarget);
    try {
      const file = form.get("file");
      if (!(file instanceof globalThis.File) || !file.size) throw new Error("Escolha um arquivo.");
      if (file.size > 15 * 1024 * 1024) throw new Error("Cada arquivo pode ter no máximo 15 MB.");
      const response = await fetch("/api/files", { method: "POST", body: form });
      if (!response.ok) throw new Error(await errorMessage(response));
      event.currentTarget.reset(); toast.success("Arquivo enviado e cifrado"); await reload();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível enviar o arquivo."); }
    finally { setUploading(false); }
  }

  async function remove(item: ProjectFile) {
    if (!window.confirm(`Excluir “${item.name}” do projeto ${item.projectCode}?`)) return;
    try {
      const response = await fetch(`/api/files/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response));
      toast.success("Arquivo excluído"); await reload();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível excluir o arquivo."); }
  }

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow text-hoikos-600">Documentos</p><h1 className="display-heading mt-2 text-4xl text-hoikos-950">Arquivos</h1><p className="mt-2 text-sm text-hoikos-500">Arquivos por projeto, cifrados antes de chegar ao armazenamento e baixados somente após autorização.</p></div><select aria-label="Filtrar por projeto" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-10 rounded-md border border-hoikos-200 bg-white px-3 text-sm"><option value="all">Todos os projetos</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></div>
    {canEdit ? <Card><CardContent className="p-5"><form onSubmit={upload} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end"><div><label htmlFor="file-project" className="mb-1.5 block text-sm font-medium">Projeto/obra</label><select id="file-project" name="projectId" required defaultValue="" className="h-10 w-full rounded-md border border-hoikos-200 bg-white px-3 text-sm"><option value="" disabled>Selecione</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></div><div><label htmlFor="project-file" className="mb-1.5 block text-sm font-medium">Arquivo</label><input id="project-file" name="file" type="file" required className="block h-10 w-full rounded-md border border-hoikos-200 bg-white px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-transparent file:font-medium" /></div><Button type="submit" disabled={uploading || !projects.length}>{uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}Enviar</Button></form><p className="mt-3 text-xs leading-5 text-hoikos-500">Até 15 MB. PDF, imagens, texto, CSV e documentos do Office. HTML, SVG e executáveis são recusados.</p></CardContent></Card> : null}
    {loading ? <Card className="p-8 text-center text-sm text-hoikos-500"><LoaderCircle className="mx-auto mb-3 animate-spin" />Carregando arquivos…</Card> : error ? <Card className="p-6"><p className="text-sm text-hoikos-700">{error}</p><Button variant="outline" className="mt-4" onClick={() => void reload()}>Tentar novamente</Button></Card> : !filtered.length ? <Card className="p-8 text-center"><Files className="mx-auto size-8 text-hoikos-500" /><p className="mt-3 font-medium">Nenhum arquivo encontrado</p><p className="mt-1 text-sm text-hoikos-500">Envie o primeiro documento vinculado a um projeto ou obra.</p></Card> : <Card className="overflow-hidden"><div className="divide-y">{filtered.map((item) => <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><span className="grid size-10 shrink-0 place-items-center rounded-md bg-hoikos-50 text-hoikos-700"><File className="size-5" /></span><div className="min-w-0 flex-1"><p className="truncate font-medium">{item.name}</p><p className="mt-1 text-xs text-hoikos-500">{item.projectCode} · {item.projectName} · {sizeLabel(item.sizeBytes)} · {item.uploaderName ?? "Usuário"}</p></div><Badge variant="outline">v{item.version}</Badge><Button asChild size="sm" variant="outline"><a href={item.downloadUrl}><Download />Baixar</a></Button>{canEdit ? <Button size="icon" variant="outline" aria-label={`Excluir ${item.name}`} onClick={() => void remove(item)}><Trash2 /></Button> : null}</div>)}</div></Card>}
  </div>;
}
