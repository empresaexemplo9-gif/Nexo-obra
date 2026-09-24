"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowLeft, Box, Download, File, FileImage, FileSpreadsheet, FileText, FileVideo, LoaderCircle, MessageSquareShare,
  PenTool, RefreshCw, Trash2, Upload, DraftingCompass,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { EnviarParaConversa } from "@/components/comunicacao/enviar-para-conversa";
import { VisualizadorArquivo } from "@/components/prancheta/visualizador-arquivo";
import type { ControleVisualizador, OpcoesConversao } from "@/components/prancheta/tipos";
import { CONVERSION_LABELS, MAX_ORG_FILE_LABEL, sizeLabel } from "@/lib/org-files";
import { checkBeforeUpload, downloadAndSave, saveBlob, uploadOrgFile, type OrgFileInfo } from "@/lib/org-files-client";
import { abrirNoEditorCad } from "@/lib/cad-abrir-client";
import { CONVERSOES, FORMATOS_ACEITOS_RESUMO, conversoesPara, visualizadorPara, type Conversao } from "@/lib/prancheta-formatos";
import { FOLHAS, type Folha } from "@/lib/prancheta-desenho";

type Project = { id: string; code: string; name: string };
type Envio = { chave: string; nome: string; progresso: number; erro?: string };

const icones = { cad: PenTool, pdf: FileText, imagem: FileImage, documento: FileText, planilha: FileSpreadsheet, modelo3d: Box, video: FileVideo, audio: File, texto: FileText, nenhum: File };

async function erroDe(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? "Não foi possível concluir a operação.";
}

const dataCurta = (valor: string) => new Date(valor.includes("T") ? valor : `${valor.replace(" ", "T")}Z`).toLocaleDateString("pt-BR");

export function PranchetaWorkspace({ projects, query, canEdit }: { projects: Project[]; query: string; canEdit: boolean }) {
  const [arquivos, setArquivos] = useState<OrgFileInfo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [projeto, setProjeto] = useState("todos");
  const [projetoEnvio, setProjetoEnvio] = useState("");
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [aberto, setAberto] = useState<OrgFileInfo | null>(null);
  const [controle, setControle] = useState<ControleVisualizador | null>(null);
  const [conversao, setConversao] = useState<Conversao["id"] | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesConversao>({ folha: "A3", monocromatico: false, paginas: "todas" });
  const [convertendo, setConvertendo] = useState(false);
  const [compartilhar, setCompartilhar] = useState<OrgFileInfo | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true); setErro("");
    try {
      const sufixo = projeto === "todos" ? "" : `?projectId=${encodeURIComponent(projeto)}`;
      const response = await fetch(`/api/arquivos${sufixo}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await erroDe(response));
      setArquivos((await response.json() as { files: OrgFileInfo[] }).files);
    } catch (causa) { setErro(causa instanceof Error ? causa.message : "Não foi possível carregar a biblioteca."); }
    finally { setCarregando(false); }
  }, [projeto]);
  useEffect(() => { const timer = window.setTimeout(() => { void recarregar(); }, 0); return () => window.clearTimeout(timer); }, [recarregar]);

  const termo = query.trim().toLocaleLowerCase("pt-BR");
  const filtrados = useMemo(() => arquivos.filter((item) => !termo || `${item.name} ${item.projectName ?? ""} ${item.projectCode ?? ""} ${item.uploadedByName}`.toLocaleLowerCase("pt-BR").includes(termo)), [arquivos, termo]);
  const nomes = useMemo(() => new Map(arquivos.map((item) => [item.id, item.name])), [arquivos]);

  async function enviar(lista: FileList | File[]) {
    if (!canEdit) return;
    const itens = [...lista];
    for (const arquivo of itens) {
      const chave = crypto.randomUUID();
      const problema = checkBeforeUpload(arquivo);
      setEnvios((atuais) => [...atuais, { chave, nome: arquivo.name, progresso: 0, erro: problema ?? undefined }]);
      if (problema) continue;
      try {
        await uploadOrgFile(arquivo, arquivo.name, {
          area: "prancheta", projectId: projetoEnvio || null,
          onProgress: (fracao) => setEnvios((atuais) => atuais.map((item) => item.chave === chave ? { ...item, progresso: fracao } : item)),
        });
        setEnvios((atuais) => atuais.filter((item) => item.chave !== chave));
        toast.success(`“${arquivo.name}” guardado na Prancheta`);
      } catch (causa) {
        const mensagem = causa instanceof Error ? causa.message : "Falha no envio.";
        setEnvios((atuais) => atuais.map((item) => item.chave === chave ? { ...item, erro: mensagem } : item));
      }
    }
    await recarregar();
  }

  function soltar(evento: DragEvent<HTMLDivElement>) {
    evento.preventDefault(); setArrastando(false);
    if (evento.dataTransfer.files.length) void enviar(evento.dataTransfer.files);
  }

  async function baixar(item: OrgFileInfo) {
    if (baixando) return;
    setBaixando(item.id);
    try { await downloadAndSave(item); }
    catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível baixar."); }
    finally { setBaixando(null); }
  }

  async function excluir(item: OrgFileInfo) {
    if (!window.confirm(`Excluir “${item.name}” da Prancheta? Quem recebeu o arquivo numa conversa continua com ele.`)) return;
    const response = await fetch(`/api/arquivos/${item.id}`, { method: "DELETE" });
    if (!response.ok) { toast.error(await erroDe(response)); return; }
    toast.success("Arquivo excluído da Prancheta");
    if (aberto?.id === item.id) setAberto(null);
    await recarregar();
  }

  async function executarConversao(id: Conversao["id"]) {
    if (!aberto || convertendo) return;
    setConvertendo(true);
    try {
      if (id === "dwg-dxf") {
        const response = await fetch(`/api/arquivos/${aberto.id}/converter`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ para: "dxf", biblioteca: canEdit }) });
        if (!response.ok) throw new Error(await erroDe(response));
        const { file } = await response.json() as { file: OrgFileInfo };
        if (canEdit) toast.success(`“${file.name}” salvo na biblioteca`, { action: { label: "Baixar", onClick: () => void downloadAndSave(file) } });
        else await downloadAndSave(file);
      } else {
        if (!controle) throw new Error("Espere o arquivo terminar de abrir.");
        const saidas = await controle.converter(id, opcoes);
        for (const saida of saidas) {
          if (!canEdit) { saveBlob(saida.blob, saida.nome); continue; }
          await uploadOrgFile(saida.blob, saida.nome, { area: "prancheta", projectId: aberto.projectId, sourceFileId: aberto.id, conversion: id });
        }
        if (canEdit) toast.success(saidas.length > 1 ? `${saidas.length} arquivos salvos na biblioteca` : `“${saidas[0].nome}” salvo na biblioteca`, {
          action: saidas.length === 1 ? { label: "Baixar", onClick: () => saveBlob(saidas[0].blob, saidas[0].nome) } : undefined,
        });
      }
      setConversao(null);
      await recarregar();
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível converter."); }
    finally { setConvertendo(false); }
  }

  const disponiveis = aberto ? conversoesPara(aberto.extension) : [];
  const pedeOpcoes = (id: Conversao["id"]) => ["dxf-pdf", "dxf-svg", "dxf-png", "pdf-png", "pdf-jpg"].includes(id);

  if (aberto) {
    return <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setAberto(null); setControle(null); }}><ArrowLeft />Biblioteca</Button>
          <div className="min-w-0"><h1 className="truncate text-lg font-semibold text-hoikos-950" title={aberto.name}>{aberto.name}</h1>
            <p className="text-xs text-hoikos-500">{sizeLabel(aberto.sizeBytes)}{aberto.projectCode ? ` · ${aberto.projectCode}` : ""} · {aberto.uploadedByName}</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void baixar(aberto)} disabled={baixando === aberto.id}>{baixando === aberto.id ? <LoaderCircle className="animate-spin" /> : <Download />}Baixar original</Button>
          <Button size="sm" variant="outline" onClick={() => setCompartilhar(aberto)}><MessageSquareShare />Enviar numa conversa</Button>
          {canEdit && ["dwg", "dxf"].includes(aberto.extension) ? <Button size="sm" variant="outline" onClick={() => void abrirNoEditorCad(aberto).catch((causa) => toast.error(causa instanceof Error ? causa.message : "Não foi possível abrir no Editor CAD."))}><DraftingCompass />Editar no Editor CAD</Button> : null}
        </div>
      </div>
      {disponiveis.length ? <div className="flex flex-wrap items-center gap-2" aria-label="Converter">
        <span className="text-sm font-medium text-hoikos-700">Converter para:</span>
        {disponiveis.map((id) => {
          const pronta = id === "dwg-dxf" || Boolean(controle?.disponiveis.includes(id));
          return <Button key={id} size="sm" variant="secondary" disabled={!pronta || convertendo} title={CONVERSOES[id].descricao}
            onClick={() => pedeOpcoes(id) ? setConversao(id) : void executarConversao(id)}>{convertendo && conversao === null ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}{CONVERSOES[id].rotulo}</Button>;
        })}
      </div> : null}
      <Card className="overflow-hidden p-0"><div className="flex h-[calc(100svh-15rem)] min-h-[480px] flex-col">
        <VisualizadorArquivo key={aberto.id} file={aberto} onControle={setControle} />
      </div></Card>

      <Dialog open={conversao !== null} onOpenChange={(open) => { if (!open && !convertendo) setConversao(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Converter para {conversao ? CONVERSOES[conversao].rotulo : ""}</DialogTitle><DialogDescription>{conversao ? CONVERSOES[conversao].descricao : ""}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            {conversao === "dxf-pdf" ? <div><Label htmlFor="folha">Folha</Label><NativeSelect id="folha" value={opcoes.folha} onChange={(event) => setOpcoes((o) => ({ ...o, folha: event.target.value as Folha }))} className="mt-1.5 w-full">
              {Object.entries(FOLHAS).map(([folha, [a, b]]) => <option key={folha} value={folha}>{folha} · {a} × {b} mm</option>)}
            </NativeSelect></div> : null}
            {conversao?.startsWith("dxf-") ? <div className="flex items-center gap-2"><Checkbox id="mono" checked={opcoes.monocromatico} onCheckedChange={(valor) => setOpcoes((o) => ({ ...o, monocromatico: valor === true }))} /><Label htmlFor="mono">Preto e branco, como plotagem</Label></div> : null}
            {conversao?.startsWith("pdf-") ? <fieldset className="space-y-2"><legend className="text-sm font-medium">Páginas</legend>
              {(["todas", "atual"] as const).map((valor) => <label key={valor} className="flex items-center gap-2 text-sm"><input type="radio" name="paginas" value={valor} checked={opcoes.paginas === valor} onChange={() => setOpcoes((o) => ({ ...o, paginas: valor }))} />{valor === "todas" ? "Todas (até 60)" : "Só a página que está na tela"}</label>)}
            </fieldset> : null}
            <p className="text-xs text-hoikos-500">{canEdit ? "O resultado entra na biblioteca ligado a este arquivo." : "Seu acesso à Prancheta é só de leitura: o resultado será baixado, sem ir para a biblioteca."}</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setConversao(null)} disabled={convertendo}>Cancelar</Button><Button onClick={() => conversao && void executarConversao(conversao)} disabled={convertendo}>{convertendo ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Converter</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <EnviarParaConversa arquivo={compartilhar} onFechar={() => setCompartilhar(null)} />
    </div>;
  }

  return <div className="space-y-5">
    <div className="hoikos-module-heading flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow text-hoikos-600">Arquivos de projeto</p><h1 className="display-heading mt-2 text-3xl text-hoikos-950 sm:text-4xl">Prancheta</h1>
        <p className="mt-2 max-w-2xl text-sm text-hoikos-500">Abra DWG, PDF, IFC e os demais arquivos de arquitetura, engenharia civil e elétrica sem instalar nada. Converta formatos e envie pela Comunicação no arquivo original.</p></div>
      <NativeSelect aria-label="Filtrar por projeto" value={projeto} onChange={(event) => setProjeto(event.target.value)}><option value="todos">Todos os projetos</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</NativeSelect>
    </div>

    {canEdit ? <Card><CardContent className="space-y-3 p-4">
      <div onDragOver={(event) => { event.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)} onDrop={soltar}
        className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors sm:flex-row sm:text-left ${arrastando ? "border-hoikos-600 bg-hoikos-50" : "border-hoikos-200"}`}>
        <Upload className="size-8 shrink-0 text-hoikos-600" />
        <div className="min-w-0 flex-1"><p className="font-medium text-hoikos-900">Arraste os arquivos para cá</p><p className="text-xs text-hoikos-500">{FORMATOS_ACEITOS_RESUMO}. Até {MAX_ORG_FILE_LABEL} por arquivo, cifrado antes de chegar ao armazenamento.</p></div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <NativeSelect aria-label="Vincular ao projeto" value={projetoEnvio} onChange={(event) => setProjetoEnvio(event.target.value)}><option value="">Sem projeto</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</NativeSelect>
          <Button onClick={() => entrada.current?.click()}><Upload />Escolher arquivos</Button>
          <input ref={entrada} type="file" multiple className="sr-only" aria-label="Escolher arquivos para a Prancheta" onChange={(event) => { if (event.target.files?.length) void enviar(event.target.files); event.target.value = ""; }} />
        </div>
      </div>
      {envios.length ? <ul className="space-y-2" aria-label="Envios em andamento">{envios.map((item) => <li key={item.chave} className="rounded-md border p-2 text-sm">
        <div className="flex items-center justify-between gap-2"><span className="truncate">{item.nome}</span>{item.erro ? <Button size="sm" variant="ghost" onClick={() => setEnvios((atuais) => atuais.filter((envio) => envio.chave !== item.chave))}>Fechar</Button> : <span className="tabular-nums text-hoikos-500">{Math.round(item.progresso * 100)}%</span>}</div>
        {item.erro ? <p className="mt-1 text-xs text-red-700" role="alert">{item.erro}</p> : <Progress value={item.progresso * 100} className="mt-1.5 h-1.5" aria-label={`Envio de ${item.nome}`} />}
      </li>)}</ul> : null}
    </CardContent></Card> : null}

    {carregando ? <Card className="p-8 text-center text-sm text-hoikos-500" role="status"><LoaderCircle className="mx-auto mb-3 animate-spin" />Carregando a biblioteca…</Card>
      : erro ? <Card className="p-6"><p className="text-sm text-hoikos-700" role="alert">{erro}</p><Button variant="outline" className="mt-4" onClick={() => void recarregar()}>Tentar novamente</Button></Card>
        : !filtrados.length ? <Card className="p-8 text-center"><PenTool className="mx-auto size-8 text-hoikos-500" /><p className="mt-3 font-medium">{arquivos.length ? "Nenhum arquivo com essa busca" : "A biblioteca está vazia"}</p><p className="mt-1 text-sm text-hoikos-500">{canEdit ? "Envie plantas, memoriais, modelos e fotos do projeto." : "Quando alguém da empresa enviar um arquivo, ele aparece aqui."}</p></Card>
          : <Card className="overflow-hidden"><ul className="divide-y">{filtrados.map((item) => {
            const Icone = icones[visualizadorPara(item.extension)];
            return <li key={item.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <button type="button" onClick={() => setAberto(item)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-hoikos-50 text-hoikos-700"><Icone className="size-5" /></span>
                <span className="min-w-0"><span className="block truncate font-medium text-hoikos-950">{item.name}</span>
                  <span className="mt-0.5 block text-xs text-hoikos-500">{item.extension.toUpperCase() || "Arquivo"} · {sizeLabel(item.sizeBytes)}{item.projectCode ? ` · ${item.projectCode}` : ""} · {item.uploadedByName} · {dataCurta(item.createdAt)}</span>
                  {item.conversion ? <span className="mt-1 block text-xs text-hoikos-600">{CONVERSION_LABELS[item.conversion] ?? "Conversão"}{item.sourceFileId && nomes.get(item.sourceFileId) ? ` de “${nomes.get(item.sourceFileId)}”` : ""}</span> : null}
                </span>
              </button>
              <div className="flex flex-wrap gap-2 sm:shrink-0">
                {item.conversion ? <Badge variant="outline" className="hidden sm:inline-flex">Convertido</Badge> : null}
                <Button size="sm" onClick={() => setAberto(item)}>Abrir</Button>
                <Button size="sm" variant="outline" onClick={() => void baixar(item)} disabled={baixando === item.id} aria-label={`Baixar ${item.name}`}>{baixando === item.id ? <LoaderCircle className="animate-spin" /> : <Download />}<span className="sm:sr-only">Baixar</span></Button>
                <Button size="sm" variant="outline" onClick={() => setCompartilhar(item)} aria-label={`Enviar ${item.name} numa conversa`}><MessageSquareShare /><span className="sm:sr-only">Enviar</span></Button>
                {canEdit ? <Button size="sm" variant="outline" onClick={() => void excluir(item)} aria-label={`Excluir ${item.name}`}><Trash2 /><span className="sm:sr-only">Excluir</span></Button> : null}
              </div>
            </li>;
          })}</ul></Card>}
    <EnviarParaConversa arquivo={compartilhar} onFechar={() => setCompartilhar(null)} />
  </div>;
}
