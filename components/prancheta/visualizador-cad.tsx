"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Layers, LoaderCircle, Maximize, Moon, Ruler, Sun } from "lucide-react";
import type { DxfViewer as DxfViewerType } from "dxf-viewer";

import { Button } from "@/components/ui/button";
import { lerCabecalhoDxf } from "@/lib/dxf-cabecalho";
import { enquadrar, limitesDe, pdfDoDesenho, svgDoDesenho, type Primitiva } from "@/lib/prancheta-desenho";
import { nomeSemExtensao, type PropsVisualizador, type SaidaConversao } from "@/components/prancheta/tipos";

const FONTE = "/vendor/fonts/LiberationSans-Regular.ttf";
type Three = typeof import("three");
type Camada = { nome: string; rotulo: string; cor: number; visivel: boolean };
type Ponto = { x: number; y: number };

function criarWorker() {
  return new Worker(new URL("./dxf-worker.ts", import.meta.url), { type: "module" });
}

/**
 * O que está na tela, como primitivas vetoriais. Cada objeto da cena é um lote de traços
 * ou triângulos; blocos (INSERT) vêm como instâncias com matriz 2×3, aplicada aqui do
 * mesmo jeito que o shader do visualizador aplica. Camada desligada não entra.
 */
function primitivasDaCena(viewer: DxfViewerType): Primitiva[] {
  const saida: Primitiva[] = [];
  for (const objeto of viewer.GetScene().children as Array<import("three").Object3D & {
    geometry?: import("three").BufferGeometry; material?: { uniforms?: { color?: { value?: import("three").Color } } };
    isLineSegments?: boolean; isMesh?: boolean; isPoints?: boolean;
  }>) {
    if (!objeto.visible || objeto.userData?.medida || !objeto.geometry) continue;
    const tipo = objeto.isLineSegments ? "linhas" : objeto.isMesh ? "triangulos" : objeto.isPoints ? "pontos" : null;
    const posicao = objeto.geometry.getAttribute("position");
    if (!tipo || !posicao) continue;
    const indice = objeto.geometry.getIndex();
    const base: number[] = [];
    if (indice) for (let i = 0; i < indice.count; i += 1) { const k = indice.getX(i); base.push(posicao.getX(k), posicao.getY(k)); }
    else for (let k = 0; k < posicao.count; k += 1) base.push(posicao.getX(k), posicao.getY(k));
    const t0 = objeto.geometry.getAttribute("instanceTransform0");
    const t1 = objeto.geometry.getAttribute("instanceTransform1");
    const tp = objeto.geometry.getAttribute("instanceTransform");
    const cor = objeto.material?.uniforms?.color?.value?.getHex() ?? 0;
    if (t0 && t1) {
      const coords = new Float64Array(base.length * t0.count);
      let o = 0;
      for (let j = 0; j < t0.count; j += 1) {
        const a = t0.getX(j), b = t0.getY(j), c = t0.getZ(j), d = t1.getX(j), e = t1.getY(j), f = t1.getZ(j);
        for (let i = 0; i < base.length; i += 2) { coords[o++] = a * base[i] + b * base[i + 1] + c; coords[o++] = d * base[i] + e * base[i + 1] + f; }
      }
      saida.push({ tipo, cor, coords });
    } else if (tp) {
      const coords = new Float64Array(base.length * tp.count);
      let o = 0;
      for (let j = 0; j < tp.count; j += 1) {
        const dx = tp.getX(j), dy = tp.getY(j);
        for (let i = 0; i < base.length; i += 2) { coords[o++] = base[i] + dx; coords[o++] = base[i + 1] + dy; }
      }
      saida.push({ tipo, cor, coords });
    } else saida.push({ tipo, cor, coords: Float64Array.from(base) });
  }
  return saida;
}

/** PNG com fundo branco, lado maior de 6000 px: legível impresso em A1. */
async function pngDoDesenho(primitivas: Primitiva[]) {
  const limites = limitesDe(primitivas);
  if (!limites) throw new Error("O desenho não tem nada visível para exportar. Ligue alguma camada.");
  const w = limites.maxX - limites.minX || 1, h = limites.maxY - limites.minY || 1;
  const lado = 6000;
  const largura = Math.max(200, Math.round(w >= h ? lado : lado * (w / h)));
  const altura = Math.max(200, Math.round(w >= h ? lado * (h / w) : lado));
  const canvas = document.createElement("canvas");
  canvas.width = largura; canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não permitiu desenhar a imagem.");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, largura, altura);
  const t = enquadrar(limites, largura, altura, 40, true);
  ctx.lineWidth = Math.max(1, lado / 3000); ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const p of primitivas) {
    const c = p.coords, cor = `#${p.cor.toString(16).padStart(6, "0")}`;
    ctx.beginPath();
    if (p.tipo === "linhas") {
      ctx.strokeStyle = cor;
      for (let i = 0; i + 3 < c.length; i += 4) { ctx.moveTo(t.x(c[i]), t.y(c[i + 1])); ctx.lineTo(t.x(c[i + 2]), t.y(c[i + 3])); }
      ctx.stroke();
    } else if (p.tipo === "triangulos") {
      ctx.fillStyle = cor;
      for (let i = 0; i + 5 < c.length; i += 6) { ctx.moveTo(t.x(c[i]), t.y(c[i + 1])); ctx.lineTo(t.x(c[i + 2]), t.y(c[i + 3])); ctx.lineTo(t.x(c[i + 4]), t.y(c[i + 5])); ctx.closePath(); }
      ctx.fill();
    } else {
      ctx.fillStyle = cor;
      for (let i = 0; i + 1 < c.length; i += 2) ctx.rect(t.x(c[i]) - 1, t.y(c[i + 1]) - 1, 2, 2);
      ctx.fill();
    }
  }
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG.")), "image/png"));
}

export default function VisualizadorCad({ blob, nome, onControle }: PropsVisualizador) {
  const host = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<DxfViewerType | null>(null);
  const threeRef = useRef<Three | null>(null);
  const escuroRef = useRef(true);
  const medindoRef = useRef(false);
  const pontoA = useRef<Ponto | null>(null);
  const [fase, setFase] = useState<"carregando" | "pronto" | "erro">("carregando");
  const [progresso, setProgresso] = useState("Preparando o visualizador…");
  const [erro, setErro] = useState("");
  const [camadas, setCamadas] = useState<Camada[]>([]);
  const [painelCamadas, setPainelCamadas] = useState(false);
  const [escuro, setEscuro] = useState(true);
  const [medindo, setMedindo] = useState(false);
  const [medida, setMedida] = useState<string | null>(null);
  const [unidade, setUnidade] = useState<string | null>(null);

  const enquadrarTudo = useCallback(() => {
    const viewer = viewerRef.current;
    const limites = viewer?.GetBounds();
    if (!viewer || !limites) return;
    const origem = viewer.GetOrigin();
    viewer.FitView(limites.minX - origem.x, limites.maxX - origem.x, limites.minY - origem.y, limites.maxY - origem.y);
  }, []);

  const removerMedida = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const objeto of [...viewer.GetScene().children]) if (objeto.userData?.medida) viewer.GetScene().remove(objeto);
    viewer.Render();
  }, []);

  // Extração com fundo branco: a correção de contraste do visualizador troca o branco do
  // CAD (cor 7) por preto, como numa plotagem. Depois o fundo da tela volta ao que era.
  const exportar = useCallback((): Primitiva[] => {
    const viewer = viewerRef.current;
    if (!viewer) throw new Error("O desenho ainda não terminou de abrir.");
    viewer.SetClearColor(0xffffff);
    try { return primitivasDaCena(viewer); }
    finally { viewer.SetClearColor(escuroRef.current ? 0x1d1b16 : 0xffffff); viewer.Render(); }
  }, []);

  useEffect(() => {
    let cancelado = false;
    let url = "";
    const viewerAtual: { valor: DxfViewerType | null } = { valor: null };
    (async () => {
      const cabecalho = lerCabecalhoDxf(new Uint8Array(await blob.slice(0, 131072).arrayBuffer()));
      setUnidade(cabecalho.unidade);
      const [{ DxfViewer }, three] = await Promise.all([import("dxf-viewer"), import("three")]);
      if (cancelado || !host.current) return;
      threeRef.current = three;
      const viewer = new DxfViewer(host.current, {
        autoResize: true, antialias: true, colorCorrection: true, clearColor: new three.Color(0x1d1b16),
        fileEncoding: cabecalho.codificacao, sceneOptions: { suppressPaperSpace: true },
      });
      viewerAtual.valor = viewer; viewerRef.current = viewer;
      if (!viewer.HasRenderer()) throw new Error("Este navegador não tem WebGL ativo, que o visualizador de desenho usa. Ative a aceleração gráfica ou baixe o arquivo.");
      url = URL.createObjectURL(blob);
      const rotulos = { font: "Carregando fontes", fetch: "Lendo o arquivo", parse: "Interpretando o desenho", prepare: "Preparando a tela" } as const;
      const carregar = (workerFactory: (() => Worker) | null) => viewer.Load({
        url, fonts: [FONTE], workerFactory,
        progressCbk: (etapa, feito, total) => setProgresso(`${rotulos[etapa]}${total ? ` · ${Math.round((feito / total) * 100)}%` : "…"}`),
      });
      // Sem worker (navegador que o recusa), a leitura acontece na própria página.
      try { await carregar(criarWorker); } catch { if (!cancelado) await carregar(null); }
      if (cancelado) return;
      setCamadas([...viewer.GetLayers(true)].map((camada) => ({ nome: camada.name, rotulo: camada.displayName || camada.name, cor: camada.color, visivel: true }))
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")));
      viewer.Subscribe("pointerdown", (evento: { detail: { domEvent: PointerEvent; position: Ponto } }) => {
        if (!medindoRef.current || evento.detail.domEvent.button !== 0) return;
        const ponto = evento.detail.position;
        const threeAtual = threeRef.current!;
        if (!pontoA.current) {
          pontoA.current = { x: ponto.x, y: ponto.y };
          setMedida("Clique no segundo ponto.");
          return;
        }
        const a = pontoA.current;
        pontoA.current = null;
        const geometria = new threeAtual.BufferGeometry().setFromPoints([new threeAtual.Vector3(a.x, a.y, 0), new threeAtual.Vector3(ponto.x, ponto.y, 0)]);
        const linha = new threeAtual.Line(geometria, new threeAtual.LineBasicMaterial({ color: 0xf5b700 }));
        linha.userData.medida = true;
        for (const objeto of [...viewer.GetScene().children]) if (objeto.userData?.medida) viewer.GetScene().remove(objeto);
        viewer.GetScene().add(linha);
        viewer.Render();
        const distancia = Math.hypot(ponto.x - a.x, ponto.y - a.y);
        setMedida(distancia.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
      });
      setFase("pronto");
      onControle?.({
        disponiveis: ["dxf-pdf", "dxf-svg", "dxf-png"],
        converter: async (id, opcoes): Promise<SaidaConversao[]> => {
          const base = nomeSemExtensao(nome);
          const primitivas = exportar();
          if (id === "dxf-pdf") {
            const pdf = await pdfDoDesenho(primitivas, { folha: opcoes.folha, monocromatico: opcoes.monocromatico, titulo: base });
            return [{ blob: new Blob([pdf.slice().buffer], { type: "application/pdf" }), nome: `${base}.pdf` }];
          }
          if (id === "dxf-svg") return [{ blob: new Blob([svgDoDesenho(primitivas, { monocromatico: opcoes.monocromatico, titulo: base })], { type: "image/svg+xml" }), nome: `${base}.svg` }];
          if (id === "dxf-png") return [{ blob: await pngDoDesenho(opcoes.monocromatico ? primitivas.map((p) => ({ ...p, cor: 0 })) : primitivas), nome: `${base}.png` }];
          throw new Error("Conversão não disponível para desenho.");
        },
      });
    })().catch((causa) => {
      if (cancelado) return;
      setErro(causa instanceof Error ? causa.message : "Não foi possível abrir o desenho.");
      setFase("erro");
    });
    return () => {
      cancelado = true;
      onControle?.(null);
      viewerAtual.valor?.Destroy();
      viewerRef.current = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, nome, onControle, exportar]);

  function alternarCamada(nomeCamada: string) {
    setCamadas((atuais) => atuais.map((camada) => {
      if (camada.nome !== nomeCamada) return camada;
      viewerRef.current?.ShowLayer(camada.nome, !camada.visivel);
      return { ...camada, visivel: !camada.visivel };
    }));
    viewerRef.current?.Render();
  }

  function todasCamadas(visivel: boolean) {
    for (const camada of camadas) viewerRef.current?.ShowLayer(camada.nome, visivel);
    setCamadas((atuais) => atuais.map((camada) => ({ ...camada, visivel })));
    viewerRef.current?.Render();
  }

  function alternarFundo() {
    const proximo = !escuro;
    setEscuro(proximo); escuroRef.current = proximo;
    viewerRef.current?.SetClearColor(proximo ? 0x1d1b16 : 0xffffff);
    viewerRef.current?.Render();
  }

  function alternarMedicao() {
    const proximo = !medindo;
    setMedindo(proximo); medindoRef.current = proximo; pontoA.current = null;
    setMedida(proximo ? "Clique no primeiro ponto." : null);
    if (!proximo) removerMedida();
  }

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-hoikos-200 bg-white p-2">
      <Button size="sm" variant="outline" onClick={enquadrarTudo} disabled={fase !== "pronto"}><Maximize />Enquadrar</Button>
      <Button size="sm" variant={painelCamadas ? "default" : "outline"} onClick={() => setPainelCamadas((v) => !v)} disabled={fase !== "pronto"} aria-pressed={painelCamadas}><Layers />Camadas{camadas.length ? ` (${camadas.filter((c) => c.visivel).length}/${camadas.length})` : ""}</Button>
      <Button size="sm" variant={medindo ? "default" : "outline"} onClick={alternarMedicao} disabled={fase !== "pronto"} aria-pressed={medindo}><Ruler />Medir</Button>
      <Button size="sm" variant="outline" onClick={alternarFundo} disabled={fase !== "pronto"} aria-label={escuro ? "Fundo claro" : "Fundo escuro"}>{escuro ? <Sun /> : <Moon />}<span className="hidden sm:inline">{escuro ? "Fundo claro" : "Fundo escuro"}</span></Button>
      {medida ? <p className="text-sm font-medium text-hoikos-800" role="status">{/^\d|^-/.test(medida) ? `Distância: ${medida}${unidade ? ` ${unidade}` : " (unidade do desenho)"}` : medida}</p> : null}
    </div>
    <div className="relative flex min-h-0 flex-1">
      <div ref={host} className={`min-h-[360px] flex-1 ${medindo ? "cursor-crosshair" : ""}`} aria-label={`Desenho ${nome}`} role="img" />
      {painelCamadas ? <aside className="absolute inset-y-0 right-0 z-10 flex w-[min(20rem,100%)] flex-col border-l border-hoikos-200 bg-white shadow-lg" aria-label="Camadas do desenho">
        <div className="flex items-center justify-between gap-2 border-b p-2"><p className="text-sm font-semibold">Camadas</p><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => todasCamadas(true)}>Todas</Button><Button size="sm" variant="ghost" onClick={() => todasCamadas(false)}>Nenhuma</Button></div></div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1">{camadas.map((camada) => <li key={camada.nome}><button type="button" onClick={() => alternarCamada(camada.nome)} aria-pressed={camada.visivel} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-hoikos-50 focus-visible:outline-2">
          {camada.visivel ? <Eye className="size-4 shrink-0" /> : <EyeOff className="size-4 shrink-0 text-hoikos-400" />}
          <span className="size-3 shrink-0 rounded-sm border" style={{ background: `#${camada.cor.toString(16).padStart(6, "0")}` }} />
          <span className={`truncate ${camada.visivel ? "" : "text-hoikos-400 line-through"}`}>{camada.rotulo}</span>
        </button></li>)}</ul>
        <p className="border-t p-2 text-xs text-hoikos-500">A exportação leva só as camadas ligadas.</p>
      </aside> : null}
      {fase === "carregando" ? <div className="absolute inset-0 grid place-items-center bg-hoikos-950/60 text-sm text-white" role="status"><p className="flex items-center gap-2"><LoaderCircle className="animate-spin" />{progresso}</p></div> : null}
      {fase === "erro" ? <div className="absolute inset-0 grid place-items-center bg-white p-6 text-center" role="alert"><div><p className="font-medium text-hoikos-900">Não foi possível exibir o desenho</p><p className="mt-2 max-w-md text-sm text-hoikos-500">{erro}</p></div></div> : null}
    </div>
  </div>;
}
