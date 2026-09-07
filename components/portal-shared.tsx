"use client";
import { BookOpenCheck, CalendarDays, CircleAlert, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { portalStatusLabels, type PortalItem } from "@/lib/portal";
import { diaryDate } from "@/lib/diary";

export function PortalError({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><CircleAlert className="size-5 shrink-0" /><p className="min-w-0 flex-1">{message}</p>{retry && <Button variant="outline" size="sm" onClick={retry}>Tentar novamente</Button>}</div>;
}
export function portalTime(value: string) { return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toLocaleString("pt-BR"); }
export function PortalItemCard({ item, children }: { item: PortalItem; children?: React.ReactNode }) {
  return <Card className="overflow-hidden border-slate-200 shadow-sm"><CardContent className="space-y-4 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="mb-2 flex items-center gap-2 text-sm text-slate-500"><BookOpenCheck className="size-4" />{item.kind === "approval" ? "Solicitação de aprovação" : "Atualização da obra"}</p><h3 className="break-words text-xl font-semibold text-slate-950">{item.title}</h3></div><Badge variant="outline" className={item.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : item.status === "open" && item.kind === "approval" ? "border-blue-200 bg-blue-50 text-blue-800" : "bg-slate-50 text-slate-700"}>{item.kind === "update" && item.status === "open" ? "Compartilhado" : portalStatusLabels[item.status]}</Badge></div>
    <p className="whitespace-pre-wrap break-words text-base leading-7 text-slate-700">{item.body}</p>
    {item.dueDate && <p className="flex items-center gap-2 text-sm font-medium text-slate-600"><CalendarDays className="size-4" />Resposta solicitada até {diaryDate(item.dueDate)}</p>}
    {item.photos.length > 0 && <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium"><ImageIcon className="mr-2 inline size-4" />{item.photos.length} foto(s) compartilhada(s)</summary><div className="mt-4 grid gap-3 sm:grid-cols-2">{item.photos.map((photo) => <figure key={photo.id}><a href={photo.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${photo.caption || photo.name}`}>
      {/* Authenticated originals must not pass through the public image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={photo.caption || photo.name} loading="lazy" className="h-52 w-full rounded-lg bg-slate-100 object-contain" /></a><figcaption className="mt-2 break-words text-sm text-slate-600">{photo.caption || photo.name}</figcaption></figure>)}</div></details>}
    {item.decision && <div className={`rounded-xl border p-4 ${item.decision.choice === "approved" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><p className="font-semibold">{portalStatusLabels[item.decision.choice]}</p><p className="mt-1 text-sm">{item.decision.actorName} · {portalTime(item.decision.createdAt)}</p>{item.decision.comment && <p className="mt-3 whitespace-pre-wrap break-words leading-7">{item.decision.comment}</p>}<p className="mt-2 text-xs text-slate-500">Protocolo {item.decision.id}</p></div>}
    {item.status === "withdrawn" && <p className="rounded-xl bg-slate-100 p-4 text-sm">Retirado por {item.withdrawnByName} em {portalTime(item.updatedAt)}: {item.withdrawalReason}</p>}
    <p className="text-xs text-slate-500">Compartilhado por {item.authorName} · {portalTime(item.createdAt)}</p>{children}
  </CardContent></Card>;
}
