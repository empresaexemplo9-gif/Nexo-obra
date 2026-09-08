"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { BookOpenText, Camera, ChevronLeft, ChevronRight, CircleAlert, CloudSun, FileText, History, LoaderCircle, Pencil, Plus, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { diaryDate, DIARY_PAGE_SIZE, MAX_DIARY_PHOTO_BYTES, MAX_DIARY_PHOTOS, occurrenceLabels, weatherLabels, type DiaryDetail, type DiaryEntry, type DiaryFields, type DiaryProject } from "@/lib/diary";

class DiaryRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new DiaryRequestError(body.error ?? "Não foi possível concluir a operação.", response.status);
  return body as T;
}
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : "Não foi possível concluir a operação.";
function timestamp(value: string) {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toLocaleString("pt-BR");
}
function Notice({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="flex items-start gap-3 rounded-xl border border-hoikos-200 bg-hoikos-50 p-4 text-sm text-hoikos-950"><CircleAlert className="mt-0.5 size-4 shrink-0" /><div>{children}</div></div>;
}

export function DiaryWorkspace({ projectId, canEdit, query = "" }: { projectId?: string; canEdit: boolean; query?: string }) {
  const [projects, setProjects] = useState<DiaryProject[]>([]);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [selectedProject, setSelectedProject] = useState(projectId ?? "all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [occurrencesOnly, setOccurrencesOnly] = useState(false);
  const [pagination, setPagination] = useState({ filters: "", page: 1 });
  const [data, setData] = useState<{ entries: DiaryEntry[]; total: number; key: string }>({ entries: [], total: 0, key: "" });
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<DiaryEntry | "new" | null>(null);
  const initialProjectRead = useRef(false);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ projects: DiaryProject[]; timezone: string }>("/api/diary/projects", { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setProjects(result.projects); setTimezone(result.timezone); setOptionsError("");
        if (!projectId && !initialProjectRead.current) {
          initialProjectRead.current = true;
          const requested = new URLSearchParams(window.location.search).get("project");
          if (requested) setSelectedProject(requested);
        }
      })
      .catch((cause) => { if (!controller.signal.aborted) setOptionsError(errorText(cause)); });
    return () => controller.abort();
  }, [refreshKey, projectId]);

  const filters = new URLSearchParams();
  if (selectedProject !== "all") filters.set("projectId", selectedProject);
  if (from) filters.set("from", from);
  if (to) filters.set("to", to);
  if (query.trim()) filters.set("q", query.trim());
  if (occurrencesOnly) filters.set("occurrencesOnly", "true");
  const filterString = filters.toString();
  const page = pagination.filters === filterString ? pagination.page : 1;
  const requestKey = `${filterString}&page=${page}&refresh=${refreshKey}`;
  const loading = loadedKey !== requestKey;
  const setPage = (change: (page: number) => number) => setPagination({ filters: filterString, page: change(page) });

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await requestJson<{ entries: DiaryEntry[]; total: number }>(`/api/diary?${filterString}&page=${page}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setData({ ...result, key: requestKey }); setError(""); setLastSync(new Date());
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(errorText(cause));
        const forbidden = cause instanceof DiaryRequestError && [401, 403, 404].includes(cause.status);
        setData((current) => forbidden || current.key !== requestKey ? { entries: [], total: 0, key: requestKey } : current);
        if (forbidden) { setDetailId(null); setEditor(null); }
      } finally { pending = false; if (!controller.signal.aborted) setLoadedKey(requestKey); }
    };
    void load();
    const syncVisible = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(syncVisible, 15000);
    document.addEventListener("visibilitychange", syncVisible);
    window.addEventListener("online", syncVisible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", syncVisible); window.removeEventListener("online", syncVisible); };
  }, [filterString, page, requestKey]);

  return <section className="space-y-5">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><h2 className="display-heading flex items-center gap-3 text-2xl font-semibold tracking-tight text-hoikos-950"><span className="grid size-11 place-items-center rounded-xl bg-primary text-hoikos-300"><BookOpenText className="size-5" /></span>Diário de obra</h2><p className="mt-2 text-sm text-hoikos-500">Atividades, ocorrências e fotos, no contexto de cada trabalho.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="icon" aria-label="Atualizar diário" onClick={refresh}><RefreshCw className="size-4" /></Button>{data.total > 0 && data.total <= 31 && !error && <Button variant="outline" asChild><a href={`/api/diary/report?${filterString}`} target="_blank" rel="noopener noreferrer"><FileText className="size-4" />Relatório / PDF</a></Button>}{canEdit && <Button disabled={!projects.length || Boolean(optionsError)} onClick={() => setEditor("new")}><Plus className="size-4" />Novo registro</Button>}</div>
    </div>
    <Card className="border-border shadow-none"><CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end">
      {!projectId && <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="diary-project-filter">Obra / projeto</Label><Select value={selectedProject} onValueChange={setSelectedProject}><SelectTrigger id="diary-project-filter" className="w-full"><SelectValue placeholder="Selecione a obra" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as obras e projetos</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select></div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="diary-from">De</Label><Input id="diary-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="diary-to">Até</Label><Input id="diary-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div></div>
      <div className="flex min-h-9 items-center gap-2"><Checkbox id="diary-occurrences" checked={occurrencesOnly} onCheckedChange={(value) => setOccurrencesOnly(value === true)} /><Label htmlFor="diary-occurrences">Só com ocorrências</Label></div>
    </CardContent></Card>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-hoikos-500"><p>{data.total} registro(s){data.total > 31 ? " · Para gerar um relatório, filtre até 31 registros." : ""}</p><p className="flex items-center gap-2"><span className={`size-2 rounded-full ${error ? "bg-hoikos-950" : "bg-hoikos-300"}`} />{lastSync ? `Atualizado às ${lastSync.toLocaleTimeString("pt-BR")}` : "Conectando…"} · a cada 15 s</p></div>
    {optionsError && <Notice>{optionsError} <Button variant="link" onClick={refresh}>Tentar novamente</Button></Notice>}
    {error && <Notice>{error} {data.entries.length > 0 ? "Exibindo a última atualização recebida." : ""} <Button variant="link" onClick={refresh}>Tentar novamente</Button></Notice>}
    {loading ? <div className="space-y-4"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div> : data.entries.length ? <div className="space-y-4">{data.entries.map((entry) => <Card key={entry.id} className="overflow-hidden border-border shadow-none"><CardContent className="flex flex-col gap-5 p-5 sm:flex-row"><div className="flex shrink-0 items-center gap-3 sm:block sm:w-20 sm:text-center"><div className="rounded-xl bg-hoikos-50 px-3 py-2 text-hoikos-800"><p className="text-3xl font-semibold">{entry.entryDate.slice(8, 10)}</p><p className="text-sm">{entry.entryDate.slice(5, 7)}/{entry.entryDate.slice(0, 4)}</p></div><p className="mt-2 text-xs text-hoikos-500">Rev. {entry.revision}</p></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-hoikos-900">{entry.projectCode} · {entry.projectName}</p>{entry.occurrenceType !== "none" && <Badge variant="outline" className="border-hoikos-200 bg-hoikos-50 text-hoikos-800">{occurrenceLabels[entry.occurrenceType]}</Badge>}</div><p className="mt-3 line-clamp-3 whitespace-pre-wrap break-words text-base leading-7 text-hoikos-700">{entry.summary}</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-hoikos-500"><span className="flex items-center gap-1.5"><CloudSun className="size-4" />{weatherLabels[entry.weather] ?? entry.weather}</span><span className="flex items-center gap-1.5"><Users className="size-4" />{entry.workforceCount} no local</span><span className="flex items-center gap-1.5"><Camera className="size-4" />{entry.photoCount} foto(s)</span><span>Por {entry.authorName}</span></div></div><Button variant="outline" className="self-start" onClick={() => setDetailId(entry.id)}>Abrir registro<ChevronRight className="size-4" /></Button></CardContent></Card>)}</div> : !error && <Card><Empty className="min-h-64"><EmptyHeader><EmptyMedia variant="icon"><BookOpenText /></EmptyMedia><EmptyTitle>{projects.length ? "Nenhum registro neste período" : "Cadastre uma obra para começar"}</EmptyTitle><EmptyDescription>{projects.length ? "Registre o que foi executado, os impedimentos e as fotos do dia." : "O diário fica vinculado a um projeto ou obra real da empresa."}</EmptyDescription></EmptyHeader>{canEdit && projects.length > 0 && <Button onClick={() => setEditor("new")}><Plus className="size-4" />Criar primeiro registro</Button>}</Empty></Card>}
    {data.total > DIARY_PAGE_SIZE && <div className="flex items-center justify-end gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Página anterior"><ChevronLeft className="size-4" /></Button><p className="text-sm">{page} de {Math.ceil(data.total / DIARY_PAGE_SIZE)}</p><Button variant="outline" disabled={page * DIARY_PAGE_SIZE >= data.total} onClick={() => setPage((value) => value + 1)} aria-label="Próxima página"><ChevronRight className="size-4" /></Button></div>}
    {!canEdit && <p className="text-sm text-hoikos-500">Acesso de leitura. O administrador da empresa define quem pode registrar e corrigir o diário.</p>}
    {editor && <DiaryEditor initial={editor === "new" ? undefined : editor} projects={projects} projectId={projectId ?? (selectedProject === "all" ? undefined : selectedProject)} timezone={timezone} onClose={() => setEditor(null)} onSaved={(entry) => { setEditor(null); setDetailId(entry.id); refresh(); }} />}
    {detailId && <DiaryRecord key={detailId} id={detailId} canEdit={canEdit} onClose={() => setDetailId(null)} onChanged={refresh} onEdit={(entry) => { setDetailId(null); setEditor(entry); }} />}
  </section>;
}

function DiaryEditor({ initial, projects, projectId, timezone, onClose, onSaved }: { initial?: DiaryEntry; projects: DiaryProject[]; projectId?: string; timezone: string; onClose: () => void; onSaved: (entry: DiaryEntry) => void }) {
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [selectedProject, setSelectedProject] = useState(initial?.projectId ?? projectId ?? "");
  const [values, setValues] = useState<DiaryFields>(() => initial ?? { entryDate: new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()), weather: "unreported", workforceCount: 0, summary: "", blockers: "", occurrenceType: "none" });
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitted = useRef(false);
  function update<K extends keyof DiaryFields>(key: K, value: DiaryFields[K]) { setValues((current) => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitted.current) return;
    submitted.current = true; setSaving(true); setError("");
    try {
      const fields: DiaryFields = { entryDate: values.entryDate, weather: values.weather, workforceCount: values.workforceCount, summary: values.summary, blockers: values.blockers, occurrenceType: values.occurrenceType };
      const { entry } = await requestJson<{ entry: DiaryEntry }>(initial ? `/api/diary/${id}` : "/api/diary", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(initial ? { ...fields, revision: initial.revision, reason } : { ...fields, id, projectId: selectedProject }) });
      onSaved(entry);
    } catch (cause) { setError(errorText(cause)); }
    finally { submitted.current = false; setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{initial ? "Corrigir registro" : "Novo registro de obra"}</DialogTitle><DialogDescription>{initial ? `Revisão ${initial.revision}. A versão anterior será preservada.` : "Registre as atividades do dia. Depois de salvar, você poderá anexar as fotos."}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><fieldset disabled={saving} className="space-y-4">
    <div className="space-y-2"><Label htmlFor="diary-editor-project">Obra / projeto</Label><Select value={selectedProject} onValueChange={setSelectedProject} disabled={Boolean(initial || projectId)} required><SelectTrigger id="diary-editor-project" className="w-full"><SelectValue placeholder="Selecione a obra" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select></div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="diary-date">Data da atividade</Label><Input id="diary-date" type="date" required value={values.entryDate} onChange={(event) => update("entryDate", event.target.value)} /></div><div className="space-y-2"><Label htmlFor="diary-weather">Clima</Label><Select value={values.weather} onValueChange={(value) => update("weather", value as DiaryFields["weather"])}><SelectTrigger id="diary-weather" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(weatherLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="diary-workforce">Pessoas no local</Label><Input id="diary-workforce" type="number" inputMode="numeric" min={0} max={10000} required value={values.workforceCount} onChange={(event) => update("workforceCount", Number(event.target.value))} /></div></div>
    <div className="space-y-2"><Label htmlFor="diary-summary">Atividades executadas</Label><Textarea id="diary-summary" required minLength={3} maxLength={10000} rows={5} placeholder="Descreva os serviços realizados e os avanços do dia." value={values.summary} onChange={(event) => update("summary", event.target.value)} /></div>
    <div className="space-y-2"><Label htmlFor="diary-occurrence">Ocorrência</Label><Select value={values.occurrenceType} onValueChange={(value) => update("occurrenceType", value as DiaryFields["occurrenceType"])}><SelectTrigger id="diary-occurrence" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(occurrenceLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
    {(values.occurrenceType !== "none" || Boolean(values.blockers)) && <div className="space-y-2"><Label htmlFor="diary-blockers">Descrição e providências</Label><Textarea id="diary-blockers" required={values.occurrenceType !== "none"} maxLength={5000} rows={3} value={values.blockers} onChange={(event) => update("blockers", event.target.value)} placeholder="O que aconteceu, impacto e providências adotadas." />{values.occurrenceType === "none" && <p className="text-sm text-hoikos-700">Remova a descrição ou selecione um tipo de ocorrência.</p>}</div>}
    {initial && <div className="space-y-2"><Label htmlFor="diary-reason">Motivo da correção</Label><Input id="diary-reason" required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></div>}
    </fieldset>{error && <Notice>{error}</Notice>}<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving || !selectedProject}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <BookOpenText className="size-4" />}{initial ? "Salvar correção" : "Salvar registro"}</Button></div></form></DialogContent></Dialog>;
}

function DiaryRecord({ id, canEdit, onClose, onEdit, onChanged }: { id: string; canEdit: boolean; onClose: () => void; onEdit: (entry: DiaryEntry) => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<DiaryDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ id: string; file: File } | null>(null);
  const [caption, setCaption] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const result = await requestJson<DiaryDetail>(`/api/diary/${id}`, { signal: controller.signal });
        if (!controller.signal.aborted) { setDetail(result); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) { setError(errorText(cause)); if (cause instanceof DiaryRequestError && [401, 403, 404].includes(cause.status)) setDetail(null); }
      } finally { pending = false; }
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden && !showHistory) void load(); }, 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [id, refreshKey, showHistory]);

  async function sendPhoto(event: FormEvent) {
    event.preventDefault();
    if (!upload || uploading.current) return;
    uploading.current = true; setBusy(true); setUploadError("");
    const form = new FormData(); form.append("id", upload.id); form.append("photo", upload.file); form.append("caption", caption);
    try {
      await requestJson(`/api/diary/${id}/photos`, { method: "POST", body: form });
      setUpload(null); setCaption(""); if (input.current) input.current.value = "";
      setRefreshKey((value) => value + 1); onChanged();
    } catch (cause) { setUploadError(errorText(cause)); }
    finally { uploading.current = false; setBusy(false); }
  }
  async function olderHistory() {
    if (!detail?.nextHistoryBefore || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const result = await requestJson<DiaryDetail>(`/api/diary/${id}?historyBefore=${detail.nextHistoryBefore}`);
      setDetail((current) => current ? { ...current, revisions: [...current.revisions, ...result.revisions], nextHistoryBefore: result.nextHistoryBefore } : current);
    } catch (cause) { setError(errorText(cause)); }
    finally { setLoadingHistory(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{detail ? `${diaryDate(detail.entry.entryDate)} · ${detail.entry.projectName}` : "Registro de obra"}</DialogTitle><DialogDescription>{detail ? `Por ${detail.entry.authorName} · Registrado em ${timestamp(detail.entry.createdAt)} · Revisão ${detail.entry.revision}` : "Carregando informações do registro."}</DialogDescription></DialogHeader>
    {error && <Notice>{error} <Button variant="link" onClick={() => setRefreshKey((value) => value + 1)}>Tentar novamente</Button></Notice>}
    {!detail && !error && <Skeleton className="h-64 rounded-xl" />}
    {detail && <div className="space-y-6"><div className="flex flex-wrap items-center gap-3"><Badge variant="outline"><CloudSun className="size-4" />{weatherLabels[detail.entry.weather] ?? detail.entry.weather}</Badge><Badge variant="outline"><Users className="size-4" />{detail.entry.workforceCount} pessoas no local</Badge>{canEdit && <Button variant="outline" size="sm" disabled={busy || Boolean(error)} onClick={() => onEdit(detail.entry)}><Pencil className="size-4" />Corrigir registro</Button>}</div>
      <section><h3 className="text-sm font-semibold text-hoikos-500">Atividades executadas</h3><p className="mt-2 whitespace-pre-wrap break-words text-base leading-7">{detail.entry.summary}</p></section>
      <section className={`rounded-xl border p-4 ${detail.entry.blockers ? "border-hoikos-200 bg-hoikos-50" : "border-hoikos-200 bg-hoikos-50"}`}><h3 className="font-semibold">{occurrenceLabels[detail.entry.occurrenceType]}</h3><p className="mt-2 whitespace-pre-wrap break-words text-base leading-7">{detail.entry.blockers || "Nenhuma ocorrência informada neste registro."}</p></section>
      <section><h3 className="flex items-center gap-2 font-semibold"><Camera className="size-5 text-hoikos-600" />Fotos · {detail.photos.length}/{MAX_DIARY_PHOTOS}</h3><div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">{detail.photos.map((photo) => <figure key={photo.id} className="overflow-hidden rounded-xl border border-hoikos-200"><a href={photo.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir foto: ${photo.caption || photo.name}`}>
        {/* Protected images must bypass public image-optimization caches. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={photo.caption || photo.name} loading="lazy" className="h-48 w-full bg-hoikos-100 object-cover" /></a><figcaption className="space-y-1 p-3"><p className="break-words text-sm font-medium">{photo.caption || photo.name}</p><p className="text-xs text-hoikos-500">{photo.uploadedByName} · {timestamp(photo.createdAt)}</p><details className="text-xs text-hoikos-500"><summary className="cursor-pointer">Identificação do arquivo</summary><p className="mt-2 break-all">SHA-256: {photo.sha256}</p></details></figcaption></figure>)}</div>{!detail.photos.length && <p className="mt-3 text-sm text-hoikos-500">Nenhuma foto anexada.</p>}
        {canEdit && detail.photos.length < MAX_DIARY_PHOTOS && <form onSubmit={sendPhoto} className="mt-4 space-y-3 rounded-xl border border-dashed border-hoikos-200 bg-hoikos-50/40 p-4"><Label htmlFor="diary-photo">Anexar foto · JPEG, PNG ou WebP, até 5 MB</Label><Input ref={input} id="diary-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || Boolean(error)} onChange={(event) => { const file = event.target.files?.[0]; setUploadError(""); if (file && file.size > MAX_DIARY_PHOTO_BYTES) { setUpload(null); setUploadError("Cada foto pode ter no máximo 5 MB."); event.target.value = ""; } else setUpload(file ? { file, id: crypto.randomUUID() } : null); }} /><Label htmlFor="diary-caption">Legenda (opcional)</Label><Input id="diary-caption" value={caption} maxLength={300} disabled={busy} onChange={(event) => setCaption(event.target.value)} placeholder="Local, serviço ou detalhe documentado" /><p className="text-xs text-hoikos-500">O arquivo original e sua autoria ficam preservados. Confira a foto antes de enviar.</p>{uploadError && <Notice>{uploadError}</Notice>}<Button type="submit" disabled={!upload || busy || Boolean(error)}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}{busy ? "Enviando foto…" : "Enviar foto"}</Button></form>}
      </section>
      <section className="border-t border-hoikos-200 pt-4"><Button variant="outline" onClick={() => setShowHistory((value) => !value)}><History className="size-4" />{showHistory ? "Ocultar histórico" : "Ver histórico de correções"}</Button>{showHistory && <div className="mt-4 space-y-3">{detail.revisions.map((revision) => <details key={revision.revision} className="rounded-xl border border-hoikos-200 p-4"><summary className="cursor-pointer text-sm font-medium">Revisão {revision.revision} · {revision.editorName} · {timestamp(revision.createdAt)}</summary><p className="mt-3 break-words text-sm text-hoikos-500">{revision.reason}</p><p className="mt-2 text-sm">{diaryDate(revision.snapshot.entryDate)} · {weatherLabels[revision.snapshot.weather] ?? revision.snapshot.weather} · {revision.snapshot.workforceCount} pessoas</p><p className="mt-3 whitespace-pre-wrap break-words text-base">{revision.snapshot.summary}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm">{occurrenceLabels[revision.snapshot.occurrenceType]}: {revision.snapshot.blockers || "Nenhuma ocorrência informada."}</p></details>)}{!detail.revisions.length && <p className="text-sm text-hoikos-500">Registro anterior à ativação do histórico. A primeira correção preservará sua versão atual.</p>}{detail.nextHistoryBefore && <Button disabled={loadingHistory} variant="outline" onClick={() => void olderHistory()}>{loadingHistory ? "Carregando…" : "Carregar versões anteriores"}</Button>}</div>}</section>
    </div>}
  </DialogContent></Dialog>;
}
