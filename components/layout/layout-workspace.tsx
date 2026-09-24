"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Copy, DoorOpen, Download, FileImage, FileText, Fence, LoaderCircle, MessageSquareShare, MousePointer2, Plus, Redo2,
  RotateCcw, RotateCw, Save, Sofa, Square, Trash2, Undo2, Warehouse, AppWindow, BrickWall,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EnviarParaConversa } from "@/components/comunicacao/enviar-para-conversa";
import { PlantaEditor, type Ferramenta, type PlantaRef, type Selecao } from "@/components/layout/planta-editor";
import { Previa3d, type Previa3dRef } from "@/components/layout/previa-3d";
import { SimboloItem } from "@/components/layout/simbolos-2d";
import { plantaPng, pranchaPdf } from "@/components/layout/exportar";
import { pedir } from "@/lib/chat-client";
import { CATALOGO, categoriaLabels, itemDoCatalogo, materialDoItem, materialLabels, type Categoria, type Material } from "@/lib/layout-catalogo";
import {
  aberturaLabels, areaM2, comprimentoDaParede, itemNovo, MODELOS, novoId, PISOS, pisoLabels, type LayoutConteudo, type Piso,
} from "@/lib/layout";
import { saveBlob, uploadOrgFile, type OrgFileInfo } from "@/lib/org-files-client";

type Project = { id: string; code: string; name: string };
type Resumo = {
  id: string; name: string; projectId: string | null; projectCode: string | null; projectName: string | null; revision: number;
  updatedByName: string; updatedAt: string; itens: number; comodos: number; areaM2: number;
};
type Aberto = Resumo & { content: LayoutConteudo };

const dataHora = (valor: string) => new Date(valor).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const m2 = (valor: number) => `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`;

export function LayoutWorkspace({ projects, query, canEdit, empresa }: { projects: Project[]; query: string; canEdit: boolean; empresa: string }) {
  const [lista, setLista] = useState<Resumo[] | null>(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [novo, setNovo] = useState({ name: "", projectId: "", modelo: "casa-garagem" });
  const [criando, setCriando] = useState(false);

  const recarregar = useCallback(async () => {
    try { setLista((await pedir<{ layouts: Resumo[] }>("/api/layouts")).layouts); setErro(""); }
    catch (causa) { setErro(causa instanceof Error ? causa.message : "Não foi possível carregar os layouts."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void recarregar(); }, 0); return () => window.clearTimeout(timer); }, [recarregar]);

  async function abrir(id: string) {
    setAbrindo(id);
    try { setAberto((await pedir<{ layout: Aberto }>(`/api/layouts/${id}`)).layout); }
    catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível abrir o layout."); }
    finally { setAbrindo(null); }
  }

  async function criar(duplicarDe?: Resumo) {
    if (criando) return;
    const nome = duplicarDe ? `${duplicarDe.name} (cópia)` : novo.name.trim();
    if (!nome) { toast.error("Dê um nome ao layout."); return; }
    setCriando(true);
    try {
      const { layout } = await pedir<{ layout: Aberto }>("/api/layouts", { method: "POST", body: JSON.stringify(duplicarDe ? { name: nome.slice(0, 100), projectId: duplicarDe.projectId, duplicarDe: duplicarDe.id } : { name: nome, projectId: novo.projectId || null, modelo: novo.modelo }) });
      setNovo((atual) => ({ ...atual, name: "" }));
      await recarregar();
      setAberto(layout);
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível criar o layout."); }
    finally { setCriando(false); }
  }

  async function excluir(item: Resumo) {
    if (!window.confirm(`Excluir o layout “${item.name}”? As imagens já exportadas para a Prancheta continuam lá.`)) return;
    try { await pedir(`/api/layouts/${item.id}`, { method: "DELETE" }); toast.success("Layout excluído"); await recarregar(); }
    catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível excluir."); }
  }

  if (aberto) return <Editor key={aberto.id} inicial={aberto} projects={projects} canEdit={canEdit} empresa={empresa} fechar={() => { setAberto(null); void recarregar(); }} />;

  const termo = query.trim().toLocaleLowerCase("pt-BR");
  const filtrados = (lista ?? []).filter((item) => !termo || `${item.name} ${item.projectCode ?? ""} ${item.projectName ?? ""}`.toLocaleLowerCase("pt-BR").includes(termo));

  return <div className="space-y-5">
    <div className="hoikos-module-heading"><p className="eyebrow text-hoikos-600">Proposta</p><h1 className="display-heading mt-2 text-3xl text-hoikos-950 sm:text-4xl">Criador de layout</h1>
      <p className="mt-2 max-w-2xl text-sm text-hoikos-500">Monte a planta com móveis, eletrodomésticos e carros na medida real e mostre ao cliente, em 3D, como o espaço vai ficar pronto.</p></div>
    {canEdit ? <Card><CardContent className="p-4">
      <form className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_auto] md:items-end" onSubmit={(evento) => { evento.preventDefault(); void criar(); }}>
        <div><Label htmlFor="layout-nome">Nome</Label><Input id="layout-nome" className="mt-1.5" value={novo.name} maxLength={100} onChange={(evento) => setNovo({ ...novo, name: evento.target.value })} placeholder="Ex.: Casa Lago — estudo de layout" /></div>
        <div><Label htmlFor="layout-modelo">Começar de</Label><NativeSelect id="layout-modelo" className="mt-1.5 w-full" value={novo.modelo} onChange={(evento) => setNovo({ ...novo, modelo: evento.target.value })}>{MODELOS.map((modelo) => <option key={modelo.id} value={modelo.id}>{modelo.nome}</option>)}</NativeSelect></div>
        <div><Label htmlFor="layout-projeto">Projeto (opcional)</Label><NativeSelect id="layout-projeto" className="mt-1.5 w-full" value={novo.projectId} onChange={(evento) => setNovo({ ...novo, projectId: evento.target.value })}><option value="">Sem projeto</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</NativeSelect></div>
        <Button type="submit" disabled={criando}>{criando ? <LoaderCircle className="animate-spin" /> : <Plus />}Criar layout</Button>
      </form>
      <p className="mt-2 text-xs text-hoikos-500">{MODELOS.find((modelo) => modelo.id === novo.modelo)?.descricao}</p>
    </CardContent></Card> : null}
    {erro ? <Card className="p-6"><p className="text-sm" role="alert">{erro}</p><Button variant="outline" className="mt-3" onClick={() => void recarregar()}>Tentar novamente</Button></Card>
      : !lista ? <Card className="p-8 text-center text-sm" role="status"><LoaderCircle className="mx-auto mb-2 animate-spin" />Carregando layouts…</Card>
        : !filtrados.length ? <Card className="p-8 text-center"><Sofa className="mx-auto size-8 text-hoikos-500" /><p className="mt-3 font-medium">{lista.length ? "Nenhum layout com essa busca" : "Nenhum layout ainda"}</p><p className="mt-1 text-sm text-hoikos-500">{canEdit ? "Comece por um modelo pronto e ajuste à obra." : "Quando a equipe criar um layout, ele aparece aqui."}</p></Card>
          : <Card className="overflow-hidden"><ul className="divide-y">{filtrados.map((item) => <li key={item.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <button type="button" className="min-w-0 flex-1 rounded text-left focus-visible:outline-2" onClick={() => void abrir(item.id)}>
              <span className="block truncate font-medium text-hoikos-950">{item.name}</span>
              <span className="mt-0.5 block text-xs text-hoikos-500">{item.projectCode ? `${item.projectCode} · ` : ""}{item.comodos} cômodo(s) · {m2(item.areaM2)} · {item.itens} item(ns) · {item.updatedByName}, {dataHora(item.updatedAt)}</span>
            </button>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void abrir(item.id)} disabled={abrindo === item.id}>{abrindo === item.id ? <LoaderCircle className="animate-spin" /> : null}Abrir</Button>
              {canEdit ? <Button size="sm" variant="outline" onClick={() => void criar(item)} aria-label={`Duplicar ${item.name}`}><Copy /><span className="sm:sr-only">Duplicar</span></Button> : null}
              {canEdit ? <Button size="sm" variant="outline" onClick={() => void excluir(item)} aria-label={`Excluir ${item.name}`}><Trash2 /><span className="sm:sr-only">Excluir</span></Button> : null}
            </div>
          </li>)}</ul></Card>}
  </div>;
}

function CampoNumero({ id, rotulo, valor, unidade, min, max, aoMudar, desativado }: { id: string; rotulo: string; valor: number; unidade: string; min: number; max: number; aoMudar: (valor: number) => void; desativado?: boolean }) {
  const [texto, setTexto] = useState(String(Math.round(valor * 100) / 100).replace(".", ","));
  const [anterior, setAnterior] = useState(valor);
  if (anterior !== valor) { setAnterior(valor); setTexto(String(Math.round(valor * 100) / 100).replace(".", ",")); }
  const confirmar = () => {
    const numero = Number(texto.replace(",", "."));
    if (!Number.isFinite(numero)) { setTexto(String(valor).replace(".", ",")); return; }
    const limitado = Math.min(max, Math.max(min, numero));
    if (limitado !== numero) toast.info(`${rotulo}: entre ${min} e ${max} ${unidade}.`);
    aoMudar(limitado);
    setTexto(String(limitado).replace(".", ","));
  };
  return <div><Label htmlFor={id} className="text-xs">{rotulo} ({unidade})</Label>
    <Input id={id} inputMode="decimal" className="mt-1 h-8" value={texto} disabled={desativado} onChange={(evento) => setTexto(evento.target.value)} onBlur={confirmar} onKeyDown={(evento) => { if (evento.key === "Enter") confirmar(); }} /></div>;
}

const ferramentas: Array<{ id: Ferramenta; rotulo: string; icone: typeof MousePointer2; tecla: string }> = [
  { id: "selecionar", rotulo: "Selecionar", icone: MousePointer2, tecla: "V" },
  { id: "parede", rotulo: "Parede", icone: BrickWall, tecla: "W" },
  { id: "comodo", rotulo: "Cômodo", icone: Square, tecla: "C" },
  { id: "porta", rotulo: "Porta", icone: DoorOpen, tecla: "P" },
  { id: "janela", rotulo: "Janela", icone: AppWindow, tecla: "J" },
  { id: "portao", rotulo: "Portão", icone: Warehouse, tecla: "G" },
  { id: "vao", rotulo: "Vão", icone: Fence, tecla: "" },
];

function Editor({ inicial, projects, canEdit, empresa, fechar }: { inicial: Aberto; projects: Project[]; canEdit: boolean; empresa: string; fechar: () => void }) {
  const [doc, setDoc] = useState<LayoutConteudo>(inicial.content);
  const [nome, setNome] = useState(inicial.name);
  const [projeto, setProjeto] = useState(inicial.projectId ?? "");
  const [revisao, setRevisao] = useState(inicial.revision);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [selecao, setSelecao] = useState<Selecao>(null);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("selecionar");
  const [modo, setModo] = useState<"planta" | "3d" | "ambos">(() => (typeof window !== "undefined" && window.matchMedia("(min-width: 1600px)").matches ? "ambos" : "planta"));
  const [categoria, setCategoria] = useState<Categoria>("sala");
  const [exportando, setExportando] = useState<string | null>(null);
  const [compartilhar, setCompartilhar] = useState<OrgFileInfo | null>(null);
  const [ultimo, setUltimo] = useState<OrgFileInfo | null>(null);
  const historico = useRef<{ passado: LayoutConteudo[]; futuro: LayoutConteudo[]; grupo: string | null }>({ passado: [], futuro: [], grupo: null });
  const planta = useRef<PlantaRef>(null);
  const previa = useRef<Previa3dRef>(null);
  const somenteLeitura = !canEdit;

  const alterar = useCallback((proximo: LayoutConteudo, opcoes: { agrupar?: string } = {}) => {
    setDoc((atual) => {
      const h = historico.current;
      // Um arraste inteiro vira um passo só no desfazer.
      if (!opcoes.agrupar || h.grupo !== opcoes.agrupar) { h.passado.push(atual); if (h.passado.length > 150) h.passado.shift(); }
      h.grupo = opcoes.agrupar ?? null; h.futuro = [];
      return proximo;
    });
    setSujo(true);
  }, []);

  const desfazer = useCallback(() => {
    const h = historico.current;
    const anterior = h.passado.pop();
    if (!anterior) return;
    setDoc((atual) => { h.futuro.push(atual); return anterior; });
    h.grupo = null; setSujo(true); setSelecao(null);
  }, []);
  const refazer = useCallback(() => {
    const h = historico.current;
    const proximo = h.futuro.pop();
    if (!proximo) return;
    setDoc((atual) => { h.passado.push(atual); return proximo; });
    h.grupo = null; setSujo(true); setSelecao(null);
  }, []);

  const salvar = useCallback(async () => {
    if (somenteLeitura || salvando) return;
    setSalvando(true);
    try {
      const { layout } = await pedir<{ layout: Aberto }>(`/api/layouts/${inicial.id}`, { method: "PUT", body: JSON.stringify({ name: nome.trim() || inicial.name, projectId: projeto || null, revision: revisao, content: doc }) });
      setRevisao(layout.revision); setSujo(false);
      toast.success("Layout salvo");
    } catch (causa) {
      // Falhou: nada é dado por salvo e o desenho continua na tela para tentar de novo.
      toast.error(causa instanceof Error ? causa.message : "Não foi possível salvar. Tente de novo.");
    } finally { setSalvando(false); }
  }, [doc, inicial.id, inicial.name, nome, projeto, revisao, salvando, somenteLeitura]);

  const apagarSelecao = useCallback(() => {
    if (!selecao || somenteLeitura) return;
    const proximo = structuredClone(doc);
    if (selecao.tipo === "item") proximo.itens = proximo.itens.filter((i) => i.id !== selecao.id);
    if (selecao.tipo === "abertura") proximo.aberturas = proximo.aberturas.filter((a) => a.id !== selecao.id);
    if (selecao.tipo === "comodo") proximo.comodos = proximo.comodos.filter((c) => c.id !== selecao.id);
    if (selecao.tipo === "parede") {
      proximo.paredes = proximo.paredes.filter((p) => p.id !== selecao.id);
      proximo.aberturas = proximo.aberturas.filter((a) => a.paredeId !== selecao.id);
    }
    alterar(proximo); setSelecao(null);
  }, [alterar, doc, selecao, somenteLeitura]);

  const girar = useCallback((graus: number) => {
    if (selecao?.tipo !== "item" || somenteLeitura) return;
    const proximo = structuredClone(doc);
    const item = proximo.itens.find((i) => i.id === selecao.id);
    if (!item) return;
    item.rotacao = (((item.rotacao + graus) % 360) + 360) % 360;
    alterar(proximo);
  }, [alterar, doc, selecao, somenteLeitura]);

  const duplicar = useCallback(() => {
    if (selecao?.tipo !== "item" || somenteLeitura) return;
    const origem = doc.itens.find((i) => i.id === selecao.id);
    if (!origem) return;
    const proximo = structuredClone(doc);
    const copia = { ...structuredClone(origem), id: novoId("it"), x: origem.x + 300, y: origem.y + 300 };
    proximo.itens.push(copia);
    alterar(proximo); setSelecao({ tipo: "item", id: copia.id });
  }, [alterar, doc, selecao, somenteLeitura]);

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      const ctrl = evento.ctrlKey || evento.metaKey;
      // Salvar vale de qualquer lugar, inclusive com o cursor num campo; o resto não
      // atrapalha quem está digitando.
      if (ctrl && evento.key.toLowerCase() === "s") { evento.preventDefault(); void salvar(); return; }
      const alvo = evento.target as HTMLElement;
      if (alvo.closest("input, textarea, select, [contenteditable=true]")) return;
      if (ctrl && evento.key.toLowerCase() === "z") { evento.preventDefault(); if (evento.shiftKey) refazer(); else desfazer(); return; }
      if (ctrl && evento.key.toLowerCase() === "y") { evento.preventDefault(); refazer(); return; }
      if (ctrl && evento.key.toLowerCase() === "d") { evento.preventDefault(); duplicar(); return; }
      if (evento.key === "Escape") { setFerramenta("selecionar"); setSelecao(null); return; }
      if (evento.key === "Delete" || evento.key === "Backspace") { if (selecao) { evento.preventDefault(); apagarSelecao(); } return; }
      if (evento.key.toLowerCase() === "r" && !ctrl) { girar(evento.shiftKey ? -90 : 90); return; }
      if (evento.key.startsWith("Arrow") && selecao?.tipo === "item" && !somenteLeitura) {
        evento.preventDefault();
        const passo = evento.shiftKey ? 100 : 10;
        const proximo = structuredClone(doc);
        const item = proximo.itens.find((i) => i.id === selecao.id);
        if (!item) return;
        if (evento.key === "ArrowLeft") item.x -= passo; if (evento.key === "ArrowRight") item.x += passo;
        if (evento.key === "ArrowUp") item.y -= passo; if (evento.key === "ArrowDown") item.y += passo;
        alterar(proximo, { agrupar: `teclado:${item.id}` });
        return;
      }
      const atalho = ferramentas.find((f) => f.tecla && f.tecla.toLowerCase() === evento.key.toLowerCase());
      if (atalho && !ctrl && !somenteLeitura) setFerramenta(atalho.id);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [alterar, apagarSelecao, desfazer, doc, duplicar, girar, refazer, salvar, selecao, somenteLeitura]);

  useEffect(() => {
    if (!sujo) return;
    const aviso = (evento: BeforeUnloadEvent) => { evento.preventDefault(); };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  function voltar() {
    if (sujo && !window.confirm("Há alterações não salvas. Sair mesmo assim?")) return;
    fechar();
  }

  function adicionarItem(catalogo: string) {
    if (somenteLeitura) return;
    const centro = planta.current?.centro() ?? { x: 0, y: 0 };
    const proximo = structuredClone(doc);
    const item = itemNovo(catalogo, centro.x, centro.y);
    proximo.itens.push(item);
    alterar(proximo); setSelecao({ tipo: "item", id: item.id }); setFerramenta("selecionar");
    if (modo === "3d") setModo("ambos");
  }

  function atualizar(mudar: (rascunho: LayoutConteudo) => void) {
    const proximo = structuredClone(doc);
    mudar(proximo);
    alterar(proximo);
  }

  async function exportar(tipo: "3d" | "planta" | "prancha") {
    if (exportando) return;
    setExportando(tipo);
    try {
      const base = (nome.trim() || inicial.name).replace(/[\\/:*?"<>|]+/g, "-");
      // A vista que falta abre sozinha; a exportação espera ela montar.
      const larga = window.matchMedia("(min-width: 1024px)").matches;
      if ((tipo !== "planta" && !previa.current) || (tipo !== "3d" && !planta.current)) setModo(tipo === "3d" && !larga ? "3d" : tipo === "planta" && !larga ? "planta" : "ambos");
      const esperar = async (pronto: () => boolean, mensagem: string) => {
        for (let i = 0; i < 150 && !pronto(); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
        if (!pronto()) throw new Error(mensagem);
      };
      if (tipo !== "planta") await esperar(() => Boolean(previa.current?.pronta()), "A prévia 3D não abriu neste navegador.");
      if (tipo !== "3d") await esperar(() => Boolean(planta.current?.svg()), "A planta não abriu.");
      const svg = planta.current?.svg();
      let blob: Blob, arquivo: string;
      if (tipo === "3d") { blob = await previa.current!.capturar(2400); arquivo = `${base} - prévia 3D.png`; }
      else if (tipo === "planta") { blob = await plantaPng(svg!, doc); arquivo = `${base} - planta humanizada.png`; }
      else {
        const [imagem3d, imagemPlanta] = await Promise.all([previa.current!.capturar(2000), plantaPng(svg!, doc, 2200)]);
        const projetoAtual = projects.find((p) => p.id === projeto);
        const pdf = await pranchaPdf({ titulo: nome.trim() || inicial.name, subtitulo: projetoAtual ? `${projetoAtual.code} · ${projetoAtual.name}` : "Estudo de layout", empresa, doc, imagem3d, planta: imagemPlanta });
        blob = new Blob([pdf.slice().buffer], { type: "application/pdf" }); arquivo = `${base} - prancha de proposta.pdf`;
      }
      if (!canEdit) { saveBlob(blob, arquivo); return; }
      const salvo = await uploadOrgFile(blob, arquivo, { area: "prancheta", projectId: projeto || null });
      setUltimo(salvo);
      toast.success(`“${arquivo}” salvo na Prancheta`, { action: { label: "Baixar", onClick: () => saveBlob(blob, arquivo) } });
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível exportar."); }
    finally { setExportando(null); }
  }

  const itemSel = selecao?.tipo === "item" ? doc.itens.find((i) => i.id === selecao.id) : null;
  const paredeSel = selecao?.tipo === "parede" ? doc.paredes.find((p) => p.id === selecao.id) : null;
  const aberturaSel = selecao?.tipo === "abertura" ? doc.aberturas.find((a) => a.id === selecao.id) : null;
  const comodoSel = selecao?.tipo === "comodo" ? doc.comodos.find((c) => c.id === selecao.id) : null;
  const areaTotal = useMemo(() => doc.comodos.reduce((soma, c) => soma + areaM2(c.pontos), 0), [doc.comodos]);
  const categorias = Object.keys(categoriaLabels) as Categoria[];

  return <div className="space-y-3">
    <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={voltar}><ArrowLeft />Layouts</Button>
        <Input aria-label="Nome do layout" value={nome} maxLength={100} onChange={(evento) => { setNome(evento.target.value); setSujo(true); }} disabled={somenteLeitura} className="h-9 w-full max-w-xs font-semibold sm:w-72" />
        <NativeSelect aria-label="Projeto do layout" value={projeto} onChange={(evento) => { setProjeto(evento.target.value); setSujo(true); }} disabled={somenteLeitura} className="h-9"><option value="">Sem projeto</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</NativeSelect>
        <Badge variant="outline" role="status">{somenteLeitura ? "Somente leitura" : sujo ? "Alterações não salvas" : "Salvo"}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {!somenteLeitura ? <>
          <Button size="icon" variant="outline" onClick={desfazer} aria-label="Desfazer (Ctrl+Z)"><Undo2 /></Button>
          <Button size="icon" variant="outline" onClick={refazer} aria-label="Refazer (Ctrl+Shift+Z)"><Redo2 /></Button>
          <Button size="sm" onClick={() => void salvar()} disabled={salvando || !sujo}>{salvando ? <LoaderCircle className="animate-spin" /> : <Save />}Salvar</Button>
        </> : null}
        <Button size="sm" variant="outline" onClick={() => void exportar("3d")} disabled={Boolean(exportando)}>{exportando === "3d" ? <LoaderCircle className="animate-spin" /> : <FileImage />}Imagem 3D</Button>
        <Button size="sm" variant="outline" onClick={() => void exportar("planta")} disabled={Boolean(exportando)}>{exportando === "planta" ? <LoaderCircle className="animate-spin" /> : <Download />}Planta</Button>
        <Button size="sm" variant="outline" onClick={() => void exportar("prancha")} disabled={Boolean(exportando)}>{exportando === "prancha" ? <LoaderCircle className="animate-spin" /> : <FileText />}Prancha PDF</Button>
        {ultimo ? <Button size="sm" variant="outline" onClick={() => setCompartilhar(ultimo)}><MessageSquareShare />Enviar numa conversa</Button> : null}
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      {!somenteLeitura ? <ToggleGroup type="single" value={ferramenta} onValueChange={(valor) => { if (valor) setFerramenta(valor as Ferramenta); }} variant="outline" size="sm" aria-label="Ferramentas" className="flex-wrap">
        {ferramentas.map((f) => <ToggleGroupItem key={f.id} value={f.id} aria-label={`${f.rotulo}${f.tecla ? ` (${f.tecla})` : ""}`} title={`${f.rotulo}${f.tecla ? ` (${f.tecla})` : ""}`}><f.icone /><span className="hidden sm:inline">{f.rotulo}</span></ToggleGroupItem>)}
      </ToggleGroup> : null}
      <ToggleGroup type="single" value={modo} onValueChange={(valor) => { if (valor) setModo(valor as typeof modo); }} variant="outline" size="sm" aria-label="Vista" className="ml-auto">
        <ToggleGroupItem value="planta">Planta</ToggleGroupItem><ToggleGroupItem value="ambos" className="hidden lg:inline-flex">Lado a lado</ToggleGroupItem><ToggleGroupItem value="3d">3D</ToggleGroupItem>
      </ToggleGroup>
    </div>

    <div className="grid gap-3 xl:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="order-2 space-y-3 xl:order-1">
      {!somenteLeitura ? <Card className="overflow-hidden p-0" aria-label="Catálogo de itens">
        <div className="border-b p-2"><Label htmlFor="categoria" className="text-xs">Categoria do catálogo</Label>
          <NativeSelect id="categoria" value={categoria} onChange={(evento) => setCategoria(evento.target.value as Categoria)} className="mt-1 w-full">{categorias.map((c) => <option key={c} value={c}>{categoriaLabels[c]}</option>)}</NativeSelect></div>
        <ul className="grid max-h-[40svh] grid-cols-2 gap-1 overflow-y-auto p-2 sm:grid-cols-4 xl:grid-cols-2">
          {CATALOGO.filter((item) => item.categoria === categoria).map((item) => {
            const lado = Math.max(item.largura, item.profundidade) * 1.3;
            return <li key={item.id}><button type="button" draggable onDragStart={(evento) => { evento.dataTransfer.setData("application/x-hoikos-item", item.id); evento.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => adicionarItem(item.id)} className="flex w-full flex-col items-center gap-1 rounded-md border border-transparent p-1.5 text-center text-[11px] leading-tight hover:border-hoikos-200 hover:bg-hoikos-50 focus-visible:outline-2" title={`${item.nome} · ${item.largura / 10} × ${item.profundidade / 10} cm${item.materiais ? ` · acabamentos: ${item.materiais.map((m) => materialLabels[m].toLowerCase()).join(", ")}` : ""}`}>
              <svg viewBox={`${-lado / 2} ${-lado / 2} ${lado} ${lado}`} className="size-14" aria-hidden><SimboloItem forma={item.forma} variante={item.variante} w={item.largura} d={item.profundidade} cor={item.cor} material={item.material} /></svg>
              <span>{item.nome}</span>
            </button></li>;
          })}
        </ul>
        <p className="border-t p-2 text-[11px] text-hoikos-500">Clique para pôr no centro da tela ou arraste para a planta.</p>
      </Card> : null}

      <Card className="space-y-3 p-3" aria-label="Propriedades">
        {itemSel ? (() => {
          const base = itemDoCatalogo(itemSel.catalogo)!;
          const mudar = (campo: "largura" | "profundidade" | "altura" | "rotacao" | "cor" | "rotulo", valor: number | string) => atualizar((d) => { const alvo = d.itens.find((i) => i.id === itemSel.id); if (alvo) (alvo as Record<string, unknown>)[campo] = valor; });
          return <>
            <p className="font-semibold text-hoikos-950">{base.nome}</p>
            <div><Label htmlFor="rotulo" className="text-xs">Rótulo</Label><Input id="rotulo" className="mt-1 h-8" value={itemSel.rotulo} maxLength={60} disabled={somenteLeitura} onChange={(evento) => mudar("rotulo", evento.target.value)} placeholder="Opcional" /></div>
            <div className="grid grid-cols-3 gap-2">
              <CampoNumero id="larg" rotulo="Largura" unidade="cm" valor={itemSel.largura / 10} min={5} max={2000} desativado={somenteLeitura} aoMudar={(v) => mudar("largura", Math.round(v * 10))} />
              <CampoNumero id="prof" rotulo="Prof." unidade="cm" valor={itemSel.profundidade / 10} min={5} max={2000} desativado={somenteLeitura} aoMudar={(v) => mudar("profundidade", Math.round(v * 10))} />
              <CampoNumero id="alt" rotulo="Altura" unidade="cm" valor={itemSel.altura / 10} min={0.1} max={2000} desativado={somenteLeitura} aoMudar={(v) => mudar("altura", Math.max(1, Math.round(v * 10)))} />
            </div>
            {!somenteLeitura ? <div><p className="text-xs font-medium">Girar ({Math.round(itemSel.rotacao)}°)</p><div className="mt-1 flex gap-1">
              <Button size="sm" variant="outline" onClick={() => girar(-90)} aria-label="Girar 90° à esquerda"><RotateCcw />90°</Button>
              <Button size="sm" variant="outline" onClick={() => girar(-15)} aria-label="Girar 15° à esquerda">−15°</Button>
              <Button size="sm" variant="outline" onClick={() => girar(15)} aria-label="Girar 15° à direita">+15°</Button>
              <Button size="sm" variant="outline" onClick={() => girar(90)} aria-label="Girar 90° à direita"><RotateCw />90°</Button>
            </div></div> : null}
            {base.materiais?.length ? <div><Label htmlFor="material" className="text-xs">Acabamento</Label>
              <NativeSelect id="material" className="mt-1 w-full" value={materialDoItem(base, itemSel.material) ?? ""} disabled={somenteLeitura || base.materiais.length < 2}
                onChange={(evento) => atualizar((d) => { const alvo = d.itens.find((i) => i.id === itemSel.id); if (alvo) alvo.material = evento.target.value as Material; })}>
                {base.materiais.map((m) => <option key={m} value={m}>{materialLabels[m]}</option>)}
              </NativeSelect></div> : null}
            <div className="flex items-center gap-2"><Label htmlFor="cor" className="text-xs">{base.alvenaria ? "Cor da alvenaria" : "Cor"}</Label><input id="cor" type="color" value={itemSel.cor} disabled={somenteLeitura} onChange={(evento) => mudar("cor", evento.target.value)} className="h-8 w-14 cursor-pointer rounded border" />
              {itemSel.cor !== base.cor && !somenteLeitura ? <Button size="sm" variant="ghost" onClick={() => mudar("cor", base.cor)}>Cor original</Button> : null}</div>
            {!somenteLeitura ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={duplicar}><Copy />Duplicar</Button><Button size="sm" variant="outline" onClick={apagarSelecao}><Trash2 />Excluir</Button></div> : null}
          </>;
        })() : paredeSel ? <>
          <p className="font-semibold">Parede · {(comprimentoDaParede(paredeSel) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m</p>
          <div className="grid grid-cols-2 gap-2">
            <CampoNumero id="esp" rotulo="Espessura" unidade="cm" valor={paredeSel.espessura / 10} min={5} max={60} desativado={somenteLeitura} aoMudar={(v) => atualizar((d) => { const p = d.paredes.find((x) => x.id === paredeSel.id); if (p) p.espessura = Math.round(v * 10); })} />
            <CampoNumero id="pe" rotulo="Pé-direito" unidade="cm" valor={paredeSel.altura / 10} min={50} max={800} desativado={somenteLeitura} aoMudar={(v) => atualizar((d) => {
              const p = d.paredes.find((x) => x.id === paredeSel.id); if (!p) return;
              p.altura = Math.round(v * 10);
              for (const a of d.aberturas) if (a.paredeId === p.id && a.peitoril + a.altura > p.altura) a.altura = Math.max(300, p.altura - a.peitoril);
            })} />
          </div>
          <p className="text-xs text-hoikos-500">Arraste as bolinhas nas pontas para mudar o comprimento; os cantos ligados acompanham.</p>
          {!somenteLeitura ? <Button size="sm" variant="outline" onClick={apagarSelecao}><Trash2 />Excluir parede</Button> : null}
        </> : aberturaSel ? (() => {
          const parede = doc.paredes.find((p) => p.id === aberturaSel.paredeId);
          const comprimento = parede ? comprimentoDaParede(parede) : 0;
          const mudar = (campo: "largura" | "altura" | "peitoril" | "posicao", mm: number) => atualizar((d) => {
            const a = d.aberturas.find((x) => x.id === aberturaSel.id); if (!a || !parede) return;
            a[campo] = mm;
            a.largura = Math.min(a.largura, comprimento);
            a.posicao = Math.min(Math.max(a.posicao, a.largura / 2), comprimento - a.largura / 2);
            a.peitoril = Math.min(a.peitoril, parede.altura - 300);
            a.altura = Math.min(a.altura, parede.altura - a.peitoril);
          });
          return <>
            <p className="font-semibold">{aberturaLabels[aberturaSel.tipo]}</p>
            <div className="grid grid-cols-2 gap-2">
              <CampoNumero id="ab-l" rotulo="Largura" unidade="cm" valor={aberturaSel.largura / 10} min={30} max={Math.floor(comprimento / 10)} desativado={somenteLeitura} aoMudar={(v) => mudar("largura", Math.round(v * 10))} />
              <CampoNumero id="ab-a" rotulo="Altura" unidade="cm" valor={aberturaSel.altura / 10} min={30} max={700} desativado={somenteLeitura} aoMudar={(v) => mudar("altura", Math.round(v * 10))} />
              {aberturaSel.tipo === "janela" ? <CampoNumero id="ab-p" rotulo="Peitoril" unidade="cm" valor={aberturaSel.peitoril / 10} min={0} max={500} desativado={somenteLeitura} aoMudar={(v) => mudar("peitoril", Math.round(v * 10))} /> : null}
              <CampoNumero id="ab-x" rotulo="Do início" unidade="cm" valor={aberturaSel.posicao / 10} min={0} max={Math.floor(comprimento / 10)} desativado={somenteLeitura} aoMudar={(v) => mudar("posicao", Math.round(v * 10))} />
            </div>
            {!somenteLeitura && aberturaSel.tipo === "porta" ? <Button size="sm" variant="outline" onClick={() => atualizar((d) => { const a = d.aberturas.find((x) => x.id === aberturaSel.id); if (a) a.inverter = !a.inverter; })}>Inverter abertura</Button> : null}
            {!somenteLeitura ? <Button size="sm" variant="outline" onClick={apagarSelecao}><Trash2 />Excluir</Button> : null}
          </>;
        })() : comodoSel ? <>
          <p className="font-semibold">Cômodo · {m2(areaM2(comodoSel.pontos))}</p>
          <div><Label htmlFor="comodo-nome" className="text-xs">Nome</Label><Input id="comodo-nome" className="mt-1 h-8" value={comodoSel.nome} maxLength={60} disabled={somenteLeitura} onChange={(evento) => atualizar((d) => { const c = d.comodos.find((x) => x.id === comodoSel.id); if (c) c.nome = evento.target.value; })} /></div>
          <div><Label htmlFor="comodo-piso" className="text-xs">Piso</Label><NativeSelect id="comodo-piso" className="mt-1 w-full" value={comodoSel.piso} disabled={somenteLeitura} onChange={(evento) => atualizar((d) => { const c = d.comodos.find((x) => x.id === comodoSel.id); if (c) c.piso = evento.target.value as Piso; })}>{PISOS.map((p) => <option key={p} value={p}>{pisoLabels[p]}</option>)}</NativeSelect></div>
          {!somenteLeitura ? <Button size="sm" variant="outline" onClick={apagarSelecao}><Trash2 />Excluir piso</Button> : null}
        </> : <>
          <p className="font-semibold">Resumo</p>
          <p className="text-sm text-hoikos-600">{doc.comodos.length} cômodo(s) · {m2(areaTotal)} · {doc.paredes.length} parede(s) · {doc.itens.length} item(ns)</p>
          <ul className="space-y-1 text-xs text-hoikos-500">
            <li>Clique num item, parede, porta ou piso para editar.</li>
            <li>Atalhos: V seleciona, W parede, C cômodo, P porta, J janela, G portão.</li>
            <li>R gira, setas movem, Ctrl+D duplica, Delete apaga, Ctrl+S salva.</li>
          </ul>
        </>}
      </Card>
      </div>

      <Card className="order-1 overflow-hidden p-0 xl:order-2">
        <div className={`grid h-[calc(100svh-17rem)] min-h-[440px] ${modo === "ambos" ? "lg:grid-cols-2" : ""}`}>
          {modo !== "3d" ? <div className="flex min-h-0 flex-col border-hoikos-200 lg:border-r">
            <PlantaEditor ref={planta} doc={doc} alterar={alterar} selecao={selecao} selecionar={setSelecao} ferramenta={ferramenta} setFerramenta={setFerramenta} somenteLeitura={somenteLeitura} avisar={(mensagem) => toast.info(mensagem)} />
          </div> : null}
          {modo !== "planta" ? <div className="min-h-0"><Previa3d ref={previa} doc={doc} /></div> : null}
        </div>
      </Card>

    </div>
    <EnviarParaConversa arquivo={compartilhar} onFechar={() => setCompartilhar(null)} />
  </div>;
}
