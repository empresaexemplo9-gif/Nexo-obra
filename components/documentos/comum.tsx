"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Archive, Download, FolderOpen, HardDriveUpload, LoaderCircle, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { criarZip } from "@/lib/documentos-pdf";
import { extensionOf, sizeLabel, type DocumentConversion } from "@/lib/org-files";
import { downloadOrgFile, saveBlob, uploadOrgFile, type OrgFileInfo } from "@/lib/org-files-client";

export type Projeto = { id: string; code: string; name: string };

/** Arquivo aberto na aba: os bytes ficam no navegador até a pessoa decidir guardar. */
export type Entrada = { chave: string; nome: string; bytes: Uint8Array; origemId: string | null; projectId: string | null };
export type Saida = { nome: string; blob: Blob };

const MAX_ENTRADA_BYTES = 100 * 1024 * 1024;

export function nomeBase(nome: string) {
  return nome.replace(/\.[a-z0-9]{1,12}$/i, "") || "arquivo";
}

export function mensagemDe(causa: unknown, padrao: string) {
  return causa instanceof Error && causa.message ? causa.message : padrao;
}

export const blobDe = (bytes: Uint8Array, tipo: string) => new Blob([bytes.slice().buffer], { type: tipo });

/**
 * Escolha de arquivo do computador (botão ou arrastar) ou da biblioteca da Prancheta.
 * A extensão é conferida aqui; o conteúdo é conferido por quem abre o arquivo.
 */
export function SeletorArquivos({ extensoes, multiplo, rotulo, onAdicionar, desabilitado }: {
  extensoes: string[]; multiplo?: boolean; rotulo: string; desabilitado?: boolean; onAdicionar: (entradas: Entrada[]) => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [biblioteca, setBiblioteca] = useState(false);
  const aceitos = extensoes.map((e) => `.${e}`).join(",");

  async function lerLocais(lista: FileList | File[]) {
    const entradas: Entrada[] = [];
    for (const arquivo of [...lista].slice(0, multiplo ? 60 : 1)) {
      if (!extensoes.includes(extensionOf(arquivo.name))) { toast.error(`“${arquivo.name}” não é ${extensoes.map((e) => e.toUpperCase()).join(", ")}.`); continue; }
      if (arquivo.size > MAX_ENTRADA_BYTES) { toast.error(`“${arquivo.name}” passa de ${sizeLabel(MAX_ENTRADA_BYTES)}.`); continue; }
      entradas.push({ chave: crypto.randomUUID(), nome: arquivo.name, bytes: new Uint8Array(await arquivo.arrayBuffer()), origemId: null, projectId: null });
    }
    if (entradas.length) onAdicionar(entradas);
  }

  function soltar(evento: DragEvent<HTMLDivElement>) {
    evento.preventDefault(); setArrastando(false);
    if (!desabilitado && evento.dataTransfer.files.length) void lerLocais(evento.dataTransfer.files);
  }

  return <div
    onDragOver={(evento) => { evento.preventDefault(); setArrastando(true); }}
    onDragLeave={() => setArrastando(false)}
    onDrop={soltar}
    className={`rounded-lg border border-dashed p-4 text-center transition-colors ${arrastando ? "border-drap-600 bg-drap-50" : "border-drap-200 bg-white"}`}
  >
    <p className="text-sm font-medium">{rotulo}</p>
    <p className="mt-1 text-xs text-drap-500">Arraste para cá ou escolha. {extensoes.map((e) => e.toUpperCase()).join(", ")} · até {sizeLabel(MAX_ENTRADA_BYTES)}. O arquivo é processado neste navegador.</p>
    <div className="mt-3 flex flex-wrap justify-center gap-2">
      <input ref={campo} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept={aceitos} multiple={multiplo} onChange={(evento) => { if (evento.target.files) void lerLocais(evento.target.files); evento.target.value = ""; }} />
      <Button type="button" variant="outline" disabled={desabilitado} onClick={() => campo.current?.click()}><HardDriveUpload />Do computador</Button>
      <Button type="button" variant="outline" disabled={desabilitado} onClick={() => setBiblioteca(true)}><FolderOpen />Da biblioteca</Button>
    </div>
    <EscolherDaBiblioteca aberto={biblioteca} onFechar={() => setBiblioteca(false)} extensoes={extensoes} multiplo={multiplo} onEscolher={onAdicionar} />
  </div>;
}

function EscolherDaBiblioteca({ aberto, onFechar, extensoes, multiplo, onEscolher }: {
  aberto: boolean; onFechar: () => void; extensoes: string[]; multiplo?: boolean; onEscolher: (entradas: Entrada[]) => void;
}) {
  const [arquivos, setArquivos] = useState<OrgFileInfo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [termo, setTermo] = useState("");
  const [baixando, setBaixando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro("");
    try {
      const resposta = await fetch("/api/arquivos", { cache: "no-store" });
      const corpo = await resposta.json().catch(() => ({})) as { files?: OrgFileInfo[]; error?: string };
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível carregar a biblioteca.");
      setArquivos(corpo.files ?? []);
    } catch (causa) { setErro(mensagemDe(causa, "Não foi possível carregar a biblioteca.")); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { if (!aberto) return; const timer = window.setTimeout(() => { void carregar(); }, 0); return () => window.clearTimeout(timer); }, [aberto, carregar]);

  const normalizado = termo.trim().toLocaleLowerCase("pt-BR");
  const filtrados = useMemo(() => arquivos.filter((item) => extensoes.includes(item.extension) && (!normalizado || `${item.name} ${item.projectCode ?? ""} ${item.projectName ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalizado))), [arquivos, extensoes, normalizado]);

  async function escolher(item: OrgFileInfo) {
    if (baixando) return;
    setBaixando(item.id);
    try {
      const blob = await downloadOrgFile(item);
      onEscolher([{ chave: crypto.randomUUID(), nome: item.name, bytes: new Uint8Array(await blob.arrayBuffer()), origemId: item.id, projectId: item.projectId }]);
      if (!multiplo) onFechar();
      else toast.success(`“${item.name}” adicionado`);
    } catch (causa) { toast.error(mensagemDe(causa, "Não foi possível abrir o arquivo.")); }
    finally { setBaixando(null); }
  }

  return <Dialog open={aberto} onOpenChange={(valor) => { if (!valor) onFechar(); }}>
    <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
      <DialogHeader><DialogTitle>Abrir da biblioteca</DialogTitle><DialogDescription>Arquivos guardados na Prancheta desta empresa.</DialogDescription></DialogHeader>
      <Label htmlFor="busca-biblioteca" className="sr-only">Buscar arquivo</Label>
      <Input id="busca-biblioteca" placeholder="Buscar por nome ou projeto" value={termo} onChange={(evento) => setTermo(evento.target.value)} />
      <div className="max-h-[50vh] overflow-y-auto rounded-md border">
        {carregando ? <p className="flex items-center justify-center gap-2 p-6 text-sm text-drap-500" role="status"><LoaderCircle className="animate-spin" />Carregando…</p>
          : erro ? <div className="p-4 text-sm"><p role="alert">{erro}</p><Button variant="outline" className="mt-3" onClick={() => void carregar()}>Tentar novamente</Button></div>
            : !filtrados.length ? <p className="p-6 text-center text-sm text-drap-500">Nenhum arquivo {extensoes.map((e) => e.toUpperCase()).join(", ")} na biblioteca.</p>
              : <ul className="divide-y">{filtrados.map((item) => <li key={item.id}><button type="button" disabled={Boolean(baixando)} onClick={() => void escolher(item)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-drap-50 focus-visible:bg-drap-50 focus-visible:outline-none disabled:opacity-60">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name}</span><span className="block text-xs text-drap-500">{item.projectCode ? `${item.projectCode} · ` : ""}{sizeLabel(item.sizeBytes)}</span></span>
                {baixando === item.id ? <LoaderCircle className="size-4 animate-spin" /> : null}
              </button></li>)}</ul>}
      </div>
    </DialogContent>
  </Dialog>;
}

/**
 * Resultado de uma operação: baixar cada arquivo, baixar tudo num ZIP ou guardar na
 * biblioteca. Guardar só é dado como feito depois que o servidor confirma cada arquivo.
 */
export function PainelResultado({ saidas, origem, conversao, canEdit, projects, aviso }: {
  saidas: Saida[]; origem: Entrada | null; conversao: DocumentConversion | null; canEdit: boolean; projects: Projeto[]; aviso?: string;
}) {
  const [projeto, setProjeto] = useState(origem?.projectId ?? "");
  const [guardando, setGuardando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [guardados, setGuardados] = useState(0);
  const [erro, setErro] = useState("");

  async function baixarTudo() {
    const entradas = await Promise.all(saidas.map(async (saida) => ({ nome: saida.nome, bytes: new Uint8Array(await saida.blob.arrayBuffer()) })));
    saveBlob(blobDe(criarZip(entradas), "application/zip"), `${nomeBase(saidas[0].nome)} e outros.zip`);
  }

  async function guardar() {
    if (guardando) return;
    setGuardando(true); setErro(""); setProgresso(0);
    let feitos = guardados;
    try {
      // Retoma de onde parou: o que já foi confirmado não é enviado de novo.
      for (let indice = guardados; indice < saidas.length; indice += 1) {
        const saida = saidas[indice];
        await uploadOrgFile(saida.blob, saida.nome, {
          area: "prancheta", projectId: projeto || null,
          sourceFileId: origem?.origemId && conversao ? origem.origemId : null, conversion: origem?.origemId && conversao ? conversao : null,
          onProgress: (fracao) => setProgresso((indice + fracao) / saidas.length),
        });
        feitos = indice + 1;
        setGuardados(feitos);
      }
      toast.success(saidas.length > 1 ? `${saidas.length} arquivos guardados na biblioteca` : `“${saidas[0].nome}” guardado na biblioteca`);
    } catch (causa) {
      setErro(`${mensagemDe(causa, "Não foi possível guardar.")}${feitos ? ` ${feitos} de ${saidas.length} já guardado(s).` : ""}`);
    } finally { setGuardando(false); }
  }

  if (!saidas.length) return null;
  const total = saidas.reduce((soma, saida) => soma + saida.blob.size, 0);
  const tudoGuardado = guardados === saidas.length;
  return <Card className="border-drap-300" aria-live="polite">
    <CardContent className="space-y-4 p-5">
      <div><p className="font-medium">Pronto: {saidas.length > 1 ? `${saidas.length} arquivos` : saidas[0].nome}</p><p className="text-xs text-drap-500">{sizeLabel(total)} no total{aviso ? ` · ${aviso}` : ""}</p></div>
      <ul className="divide-y rounded-md border">{saidas.slice(0, 50).map((saida) => <li key={saida.nome} className="flex items-center gap-3 p-2.5 text-sm">
        <span className="min-w-0 flex-1 truncate">{saida.nome}</span><span className="shrink-0 text-xs text-drap-500">{sizeLabel(saida.blob.size)}</span>
        <Button size="sm" variant="outline" onClick={() => saveBlob(saida.blob, saida.nome)} aria-label={`Baixar ${saida.nome}`}><Download />Baixar</Button>
      </li>)}</ul>
      {saidas.length > 50 ? <p className="text-xs text-drap-500">Mais {saidas.length - 50} arquivo(s) no ZIP.</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        {saidas.length > 1 ? <Button variant="outline" onClick={() => void baixarTudo()}><Archive />Baixar tudo (.zip)</Button> : null}
        {canEdit ? <>
          <div className="min-w-48"><Label htmlFor="resultado-projeto" className="mb-1.5 block text-xs">Projeto na biblioteca</Label>
            <NativeSelect id="resultado-projeto" value={projeto} disabled={guardando || tudoGuardado} onChange={(evento) => setProjeto(evento.target.value)} className="w-full"><NativeSelectOption value="">Sem projeto</NativeSelectOption>{projects.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.code} · {p.name}</NativeSelectOption>)}</NativeSelect></div>
          <Button onClick={() => void guardar()} disabled={guardando || tudoGuardado}>{guardando ? <LoaderCircle className="animate-spin" /> : <Save />}{tudoGuardado ? "Guardado na biblioteca" : guardando ? `Guardando ${Math.round(progresso * 100)}%` : guardados ? "Continuar guardando" : "Guardar na biblioteca"}</Button>
        </> : <p className="text-xs text-drap-500">Seu acesso permite baixar, mas não guardar na biblioteca.</p>}
      </div>
      {erro ? <p className="text-sm text-red-700" role="alert">{erro}</p> : null}
    </CardContent>
  </Card>;
}
