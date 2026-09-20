"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CircleAlert, DraftingCompass, Files, Image as Icone, LoaderCircle, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Projeto = { id: string; code: string; name: string };

type Resumo = {
  id: string; nome: string; especie: string; revisao: number;
  projectId: string | null; projectName: string | null; projectCode: string | null;
  autor: string | null; criadoEm: string; atualizadoEm: string;
};

type ItemBiblioteca = {
  id: string; nome: string; mimeType: string; sizeBytes: number; categoria: string;
  larguraMm: number | null; alturaMm: number | null; desenhavel: boolean;
  criadoEm: string; url: string;
};

const especieLabels: Record<string, string> = {
  planta: "Planta", corte: "Corte", elevacao: "Elevação",
  detalhe: "Detalhe", apresentacao: "Apresentação",
};

const categoriaLabels: Record<string, string> = {
  mobilia: "Mobiliário", textura: "Textura e acabamento", referencia: "Referência",
  fundo: "Fundo de traçado", anexo: "Anexo (DWG, PDF)",
};

function tamanho(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}

const dataCurta = (valor: string) => {
  const data = new Date(valor.includes("T") ? valor : `${valor.replace(" ", "T")}Z`);
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleDateString("pt-BR");
};

async function mensagemDeErro(resposta: Response) {
  const corpo = await resposta.json().catch(() => ({})) as { error?: string };
  return corpo.error ?? "Não foi possível concluir a operação.";
}

function Biblioteca({ canEdit }: { canEdit: boolean }) {
  const [itens, definirItens] = useState<ItemBiblioteca[]>([]);
  const [categoria, definirCategoria] = useState("todas");
  const [carregando, definirCarregando] = useState(true);
  const [enviando, definirEnviando] = useState(false);
  const [erro, definirErro] = useState("");

  const recarregar = useCallback(async () => {
    definirCarregando(true); definirErro("");
    try {
      const sufixo = categoria === "todas" ? "" : `?categoria=${encodeURIComponent(categoria)}`;
      const resposta = await fetch(`/api/studio/assets${sufixo}`, { cache: "no-store" });
      if (!resposta.ok) throw new Error(await mensagemDeErro(resposta));
      const corpo = await resposta.json() as { itens: ItemBiblioteca[] };
      definirItens(corpo.itens);
    } catch (causa) {
      definirErro(causa instanceof Error ? causa.message : "Não foi possível carregar a biblioteca.");
    } finally {
      definirCarregando(false);
    }
  }, [categoria]);

  useEffect(() => {
    const relogio = window.setTimeout(() => { void recarregar(); }, 0);
    return () => window.clearTimeout(relogio);
  }, [recarregar]);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = new FormData(evento.currentTarget);
    const alvo = evento.currentTarget;
    definirEnviando(true);
    try {
      const resposta = await fetch("/api/studio/assets", { method: "POST", body: formulario });
      if (!resposta.ok) throw new Error(await mensagemDeErro(resposta));
      alvo.reset();
      toast.success("Item enviado para a biblioteca.");
      await recarregar();
    } catch (causa) {
      toast.error(causa instanceof Error ? causa.message : "Não foi possível enviar o arquivo.");
    } finally {
      definirEnviando(false);
    }
  }

  async function remover(item: ItemBiblioteca) {
    if (!window.confirm(`Apagar "${item.nome}" da biblioteca? As pranchas que já usam esta imagem ficarão sem ela.`)) return;
    try {
      const resposta = await fetch(`/api/studio/assets/${item.id}`, { method: "DELETE" });
      if (!resposta.ok && resposta.status !== 204) throw new Error(await mensagemDeErro(resposta));
      toast.success("Item apagado.");
      await recarregar();
    } catch (causa) {
      toast.error(causa instanceof Error ? causa.message : "Não foi possível apagar o item.");
    }
  }

  return <div className="space-y-4">
    {canEdit && <Card><CardContent className="p-5">
      <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-1 xl:col-span-2">
          <Label htmlFor="biblioteca-arquivo">Arquivo</Label>
          <Input id="biblioteca-arquivo" name="file" type="file" required
            accept="image/png,image/jpeg,image/webp,image/avif,application/pdf,.dwg,.dxf" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="biblioteca-categoria">Categoria</Label>
          <NativeSelect id="biblioteca-categoria" name="categoria" defaultValue="referencia">
            {Object.entries(categoriaLabels).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="biblioteca-largura">Largura real (mm)</Label>
          <Input id="biblioteca-largura" name="larguraMm" type="number" inputMode="numeric" min={1} placeholder="Opcional" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="biblioteca-altura">Profundidade real (mm)</Label>
          <Input id="biblioteca-altura" name="alturaMm" type="number" inputMode="numeric" min={1} placeholder="Opcional" />
        </div>
        <div className="sm:col-span-2 xl:col-span-5">
          <Button type="submit" disabled={enviando}>
            {enviando ? <LoaderCircle className="animate-spin" /> : <Upload />}Enviar para a biblioteca
          </Button>
          <p className="mt-2 text-xs leading-5 text-hoikos-500">
            Imagem (PNG, JPEG, WebP, AVIF) entra na prancha. PDF, DWG e DXF ficam guardados como anexo para consulta e download:
            não existe leitor livre confiável de DWG, e abrir errado uma planta é pior do que dizer que não abre.
            A medida real é o que faz o móvel ocupar na planta o espaço que ocupa na sala.
          </p>
        </div>
      </form>
    </CardContent></Card>}

    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="biblioteca-filtro" className="text-xs">Mostrar</Label>
      <NativeSelect id="biblioteca-filtro" value={categoria} onChange={(evento) => definirCategoria(evento.target.value)} className="h-10 w-56">
        <option value="todas">Todas as categorias</option>
        {Object.entries(categoriaLabels).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
      </NativeSelect>
    </div>

    {carregando ? <Card><Empty className="min-h-52 border-0"><LoaderCircle className="size-6 animate-spin text-hoikos-600" /><p className="text-sm text-hoikos-500">Carregando a biblioteca…</p></Empty></Card>
      : erro ? <Card><Empty className="min-h-52 border-0"><EmptyHeader><EmptyMedia variant="icon"><CircleAlert /></EmptyMedia><EmptyTitle>Não foi possível carregar</EmptyTitle><EmptyDescription>{erro}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => void recarregar()}>Tentar novamente</Button></EmptyContent></Empty></Card>
      : !itens.length ? <Card><Empty className="min-h-52 border-0"><EmptyHeader><EmptyMedia variant="icon"><Icone /></EmptyMedia><EmptyTitle>Biblioteca vazia</EmptyTitle><EmptyDescription>Envie mobiliário recortado, texturas, fotos de referência e as plantas que servirão de fundo de traçado.</EmptyDescription></EmptyHeader></Empty></Card>
      : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {itens.map((item) => <Card key={item.id}><CardContent className="space-y-2 p-3">
          <div className="grid aspect-square place-items-center overflow-hidden rounded-md bg-hoikos-50">
            {item.desenhavel
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={item.url} alt={item.nome} className="size-full object-cover" />
              : <div className="p-4 text-center"><Files aria-hidden="true" className="mx-auto size-7 text-hoikos-600" /><p className="mt-2 text-xs text-hoikos-500">Anexo — não entra na prancha</p></div>}
          </div>
          <p className="truncate text-sm font-medium text-hoikos-800" title={item.nome}>{item.nome}</p>
          <p className="text-xs text-hoikos-500">
            {categoriaLabels[item.categoria] ?? item.categoria} · {tamanho(item.sizeBytes)}
            {item.larguraMm && item.alturaMm ? ` · ${item.larguraMm}×${item.alturaMm} mm` : ""}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild><a href={item.url} target="_blank" rel="noreferrer">Abrir</a></Button>
            {canEdit && <Button variant="outline" size="sm" onClick={() => void remover(item)} aria-label={`Apagar ${item.nome}`}><Trash2 /></Button>}
          </div>
        </CardContent></Card>)}
      </div>}
  </div>;
}

export function PranchetaWorkspace({ projects, query, canEdit }: { projects: Projeto[]; query: string; canEdit: boolean }) {
  const [pranchas, definirPranchas] = useState<Resumo[]>([]);
  const [carregando, definirCarregando] = useState(true);
  const [criando, definirCriando] = useState(false);
  const [dialogoAberto, definirDialogoAberto] = useState(false);
  const [erro, definirErro] = useState("");

  const recarregar = useCallback(async () => {
    definirCarregando(true); definirErro("");
    try {
      const resposta = await fetch("/api/studio", { cache: "no-store" });
      if (!resposta.ok) throw new Error(await mensagemDeErro(resposta));
      const corpo = await resposta.json() as { pranchas: Resumo[] };
      definirPranchas(corpo.pranchas);
    } catch (causa) {
      definirErro(causa instanceof Error ? causa.message : "Não foi possível carregar as pranchas.");
    } finally {
      definirCarregando(false);
    }
  }, []);

  useEffect(() => {
    const relogio = window.setTimeout(() => { void recarregar(); }, 0);
    return () => window.clearTimeout(relogio);
  }, [recarregar]);

  async function criar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const novaAba = window.open("", "_blank");
    if (novaAba) novaAba.opener = null;
    const formulario = new FormData(evento.currentTarget);
    const projectId = String(formulario.get("projectId") ?? "");
    definirCriando(true);
    try {
      const resposta = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: String(formulario.get("nome") ?? "").trim(),
          especie: String(formulario.get("especie") ?? "planta"),
          projectId: projectId && projectId !== "nenhum" ? projectId : null,
        }),
      });
      if (!resposta.ok) throw new Error(await mensagemDeErro(resposta));
      const corpo = await resposta.json() as { prancha: Resumo };
      definirDialogoAberto(false);
      await recarregar();
      const destino = `/prancheta/${corpo.prancha.id}`;
      if (novaAba) novaAba.location.href = destino;
      else toast.info("Prancha criada. Abra o editor em outra aba pela lista de pranchas.");
    } catch (causa) {
      novaAba?.close();
      toast.error(causa instanceof Error ? causa.message : "Não foi possível criar a prancha.");
    } finally {
      definirCriando(false);
    }
  }

  async function apagar(prancha: Resumo) {
    if (!window.confirm(`Apagar a prancha "${prancha.nome}"? O desenho não pode ser recuperado.`)) return;
    try {
      const resposta = await fetch(`/api/studio/${prancha.id}`, { method: "DELETE" });
      if (!resposta.ok && resposta.status !== 204) throw new Error(await mensagemDeErro(resposta));
      toast.success("Prancha apagada.");
      await recarregar();
    } catch (causa) {
      toast.error(causa instanceof Error ? causa.message : "Não foi possível apagar a prancha.");
    }
  }

  const termo = query.trim().toLowerCase();
  const visiveis = termo
    ? pranchas.filter((prancha) => [prancha.nome, prancha.projectName, prancha.projectCode]
      .some((campo) => campo?.toLowerCase().includes(termo)))
    : pranchas;

  return <Tabs defaultValue="pranchas" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <TabsList>
        <TabsTrigger value="pranchas">Pranchas</TabsTrigger>
        <TabsTrigger value="biblioteca">Biblioteca</TabsTrigger>
      </TabsList>
      {canEdit && <Button onClick={() => definirDialogoAberto(true)}><Plus />Nova prancha</Button>}
    </div>

    <TabsContent value="pranchas" className="space-y-4">
      {carregando ? <Card><Empty className="min-h-60 border-0"><LoaderCircle className="size-6 animate-spin text-hoikos-600" /><p className="text-sm text-hoikos-500">Carregando as pranchas…</p></Empty></Card>
        : erro ? <Card><Empty className="min-h-60 border-0"><EmptyHeader><EmptyMedia variant="icon"><CircleAlert /></EmptyMedia><EmptyTitle>Não foi possível carregar</EmptyTitle><EmptyDescription>{erro}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => void recarregar()}>Tentar novamente</Button></EmptyContent></Empty></Card>
        : !visiveis.length ? <Card><Empty className="min-h-60 border-0"><EmptyHeader><EmptyMedia variant="icon"><DraftingCompass /></EmptyMedia>
            <EmptyTitle>{pranchas.length ? "Nenhuma prancha encontrada" : "Nenhuma prancha nesta empresa"}</EmptyTitle>
            <EmptyDescription>{pranchas.length
              ? "Nenhuma prancha corresponde à busca. Limpe o campo de busca para ver todas."
              : "Comece uma planta do zero ou suba a planta existente como fundo de traçado na biblioteca."}</EmptyDescription></EmptyHeader>
            {canEdit && !pranchas.length && <EmptyContent><Button onClick={() => definirDialogoAberto(true)}><Plus />Criar a primeira prancha</Button></EmptyContent>}
          </Empty></Card>
        : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((prancha) => <Card key={prancha.id}><CardContent className="space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-medium text-hoikos-900" title={prancha.nome}>{prancha.nome}</p>
                <p className="mt-1 truncate text-xs text-hoikos-500">
                  {prancha.projectName ? `${prancha.projectCode} · ${prancha.projectName}` : "Sem projeto vinculado"}
                </p>
              </div>
              <Badge className="shrink-0 border-hoikos-200 bg-hoikos-50 text-hoikos-800">{especieLabels[prancha.especie] ?? prancha.especie}</Badge>
            </div>
            <p className="text-xs text-hoikos-500">
              Revisão {prancha.revisao} · {dataCurta(prancha.atualizadoEm)}{prancha.autor ? ` · ${prancha.autor}` : ""}
            </p>
            <div className="flex gap-2">
              <Button size="sm" asChild><a href={`/prancheta/${prancha.id}`} target="_blank" rel="noopener noreferrer">
                <DraftingCompass />Abrir editor em outra aba
              </a></Button>
              {canEdit && <Button variant="outline" size="sm" onClick={() => void apagar(prancha)} aria-label={`Apagar ${prancha.nome}`}><Trash2 /></Button>}
            </div>
          </CardContent></Card>)}
        </div>}
    </TabsContent>

    <TabsContent value="biblioteca"><Biblioteca canEdit={canEdit} /></TabsContent>

    <Dialog open={dialogoAberto} onOpenChange={definirDialogoAberto}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova prancha</DialogTitle>
          <DialogDescription>A prancha abre em branco, com as camadas de layout, elétrico, luminotécnico, mobiliário e anotações prontas.</DialogDescription>
        </DialogHeader>
        <form onSubmit={criar} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="prancha-nome">Nome</Label>
            <Input id="prancha-nome" name="nome" required maxLength={120} placeholder="Planta baixa — pavimento térreo" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="prancha-especie">Tipo de desenho</Label>
            <NativeSelect id="prancha-especie" name="especie" defaultValue="planta">
              {Object.entries(especieLabels).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="prancha-projeto">Projeto</Label>
            <NativeSelect id="prancha-projeto" name="projectId" defaultValue="nenhum">
              <option value="nenhum">Sem projeto — estudo livre</option>
              {projects.map((projeto) => <option key={projeto.id} value={projeto.id}>{projeto.code} · {projeto.name}</option>)}
            </NativeSelect>
          </div>
          <Button type="submit" disabled={criando} className="w-full">
            {criando ? <LoaderCircle className="animate-spin" /> : <Plus />}Criar e abrir em outra aba
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  </Tabs>;
}
