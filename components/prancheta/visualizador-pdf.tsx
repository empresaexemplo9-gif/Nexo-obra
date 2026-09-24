"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import { Button } from "@/components/ui/button";
import { nomeSemExtensao, type PropsVisualizador, type SaidaConversao } from "@/components/prancheta/tipos";

const VENDOR = "/vendor/pdfjs";
// Limite seguro de canvas nos navegadores (Safari corta acima de ~16,7 milhões de pixels).
const MAX_PIXELS = 16_000_000;

// Build "legacy": o padrão do pdf.js 6 usa recursos de JavaScript que Safari, Chrome e
// Firefox em uso ainda não têm (Map.getOrInsertComputed), e a página sai em branco.
async function abrirPdf(blob: Blob) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdf.worker.min.mjs`;
  return pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: `${VENDOR}/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${VENDOR}/standard_fonts/`, wasmUrl: `${VENDOR}/wasm/`, iccUrl: `${VENDOR}/iccs/`,
  });
}

function escalaSegura(largura: number, altura: number, escala: number) {
  const area = largura * altura * escala * escala;
  return area > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / (largura * altura)) : escala;
}

/** Desenha a página no canvas. Devolve a tarefa, que pode ser cancelada quando o zoom muda. */
async function renderizar(documento: PDFDocumentProxy, numero: number, escala: number, canvas: HTMLCanvasElement, registrar?: (cancelar: () => void) => void) {
  const pagina = await documento.getPage(numero);
  const base = pagina.getViewport({ scale: 1 });
  const viewport = pagina.getViewport({ scale: escalaSegura(base.width, base.height, escala) });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const tarefa = pagina.render({ canvas, viewport, background: "#ffffff" });
  registrar?.(() => tarefa.cancel());
  await tarefa.promise;
  return { largura: base.width, altura: base.height };
}

function Pagina({ documento, numero, zoom, onVisivel }: { documento: PDFDocumentProxy; numero: number; zoom: number; onVisivel: (numero: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [tamanho, setTamanho] = useState<{ largura: number; altura: number } | null>(null);
  const [visivel, setVisivel] = useState(numero <= 2);

  useEffect(() => {
    let vivo = true;
    void documento.getPage(numero).then((pagina) => { if (vivo) { const v = pagina.getViewport({ scale: 1 }); setTamanho({ largura: v.width, altura: v.height }); } });
    return () => { vivo = false; };
  }, [documento, numero]);

  useEffect(() => {
    const alvo = caixa.current;
    if (!alvo) return;
    const observador = new IntersectionObserver(([entrada]) => {
      if (entrada.isIntersecting) { setVisivel(true); onVisivel(numero); }
    }, { rootMargin: "400px 0px", threshold: 0.01 });
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [numero, onVisivel]);

  useEffect(() => {
    if (!visivel || !canvas.current) return;
    // Um canvas só aceita um desenho por vez: o zoom novo cancela o anterior.
    let cancelar: (() => void) | null = null;
    const escala = zoom * (window.devicePixelRatio || 1);
    const alvo = document.createElement("canvas");
    void renderizar(documento, numero, escala, alvo, (fn) => { cancelar = fn; }).then(() => {
      const destino = canvas.current;
      if (!destino) return;
      destino.width = alvo.width; destino.height = alvo.height;
      destino.getContext("2d")?.drawImage(alvo, 0, 0);
    }).catch((causa: unknown) => {
      // Cancelamento pelo zoom é esperado; qualquer outra falha fica registrada.
      if ((causa as { name?: string })?.name !== "RenderingCancelledException") console.error("Prancheta: falha ao desenhar a página", numero, causa);
    });
    return () => { cancelar?.(); };
  }, [documento, numero, zoom, visivel]);

  const largura = (tamanho?.largura ?? 595) * zoom, altura = (tamanho?.altura ?? 842) * zoom;
  return <div ref={caixa} className="mx-auto bg-white shadow-md" style={{ width: largura, height: altura }} aria-label={`Página ${numero}`}>
    <canvas ref={canvas} style={{ width: largura, height: altura }} />
  </div>;
}

export default function VisualizadorPdf({ blob, nome, onControle }: PropsVisualizador) {
  const [documento, setDocumento] = useState<PDFDocumentProxy | null>(null);
  const [erro, setErro] = useState("");
  const [zoom, setZoom] = useState(1);
  const [atual, setAtual] = useState(1);
  const atualRef = useRef(1);
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelado = false;
    let tarefa: Awaited<ReturnType<typeof abrirPdf>> | null = null;
    void abrirPdf(blob).then((aberta) => { tarefa = aberta; return aberta.promise; }).then((doc) => {
      if (cancelado) return;
      setDocumento(doc);
      // Página inteira na largura da área, sem passar de 150%.
      void doc.getPage(1).then((pagina) => {
        const largura = area.current?.clientWidth ?? 800;
        setZoom(Math.min(1.5, Math.max(0.25, (largura - 32) / pagina.getViewport({ scale: 1 }).width)));
      });
      onControle?.({
        disponiveis: ["pdf-png", "pdf-jpg"],
        converter: async (id, opcoes): Promise<SaidaConversao[]> => {
          const formato = id === "pdf-jpg" ? "image/jpeg" : "image/png";
          const extensao = id === "pdf-jpg" ? "jpg" : "png";
          const paginas = opcoes.paginas === "atual" ? [atualRef.current] : Array.from({ length: Math.min(doc.numPages, 60) }, (_, i) => i + 1);
          const saidas: SaidaConversao[] = [];
          for (const numero of paginas) {
            const canvas = document.createElement("canvas");
            await renderizar(doc, numero, 200 / 72, canvas);
            const imagem = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Não foi possível gerar a imagem.")), formato, 0.92));
            saidas.push({ blob: imagem, nome: `${nomeSemExtensao(nome)}${doc.numPages > 1 ? ` - página ${numero}` : ""}.${extensao}` });
          }
          return saidas;
        },
      });
    }).catch((causa) => {
      if (cancelado) return;
      const texto = causa instanceof Error ? causa.message : "";
      setErro(/password/i.test(texto) ? "Este PDF tem senha. Baixe o arquivo para abrir com a senha." : "O arquivo não é um PDF válido ou está corrompido.");
    });
    return () => { cancelado = true; onControle?.(null); void tarefa?.destroy(); };
  }, [blob, nome, onControle]);

  const mudarZoom = (fator: number) => setZoom((z) => Math.min(4, Math.max(0.25, Math.round(z * fator * 100) / 100)));
  const aoVer = useCallback((numero: number) => { atualRef.current = numero; setAtual(numero); }, []);

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-hoikos-200 bg-white p-2">
      <Button size="icon" variant="outline" onClick={() => mudarZoom(1 / 1.25)} aria-label="Diminuir zoom" disabled={!documento}><Minus /></Button>
      <span className="w-14 text-center text-sm tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <Button size="icon" variant="outline" onClick={() => mudarZoom(1.25)} aria-label="Aumentar zoom" disabled={!documento}><Plus /></Button>
      {documento ? <p className="text-sm text-hoikos-600">Página {atual} de {documento.numPages}</p> : null}
    </div>
    <div ref={area} className="min-h-[360px] flex-1 overflow-auto bg-hoikos-100 p-4">
      {erro ? <p className="p-6 text-center text-sm text-hoikos-700" role="alert">{erro}</p>
        : !documento ? <p className="flex items-center justify-center gap-2 p-6 text-sm text-hoikos-600" role="status"><LoaderCircle className="animate-spin" />Abrindo o PDF…</p>
          : <div className="flex flex-col gap-4">{Array.from({ length: documento.numPages }, (_, i) => <Pagina key={i + 1} documento={documento} numero={i + 1} zoom={zoom} onVisivel={aoVer} />)}</div>}
    </div>
  </div>;
}
