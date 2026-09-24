"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Minus, Plus, WrapText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pdfDeImagem } from "@/lib/pdf-writer";
import { nomeSemExtensao, type PropsVisualizador } from "@/components/prancheta/tipos";

function useUrl(blob: Blob) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return url;
}

/** Pixels RGB da imagem sobre fundo branco (transparência de PNG vira branco, como no papel). */
async function rgbDaImagem(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const contexto = canvas.getContext("2d");
  if (!contexto) throw new Error("O navegador não permitiu ler a imagem.");
  contexto.fillStyle = "#fff"; contexto.fillRect(0, 0, canvas.width, canvas.height);
  contexto.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = contexto.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]; }
  return { rgb, largura: canvas.width, altura: canvas.height };
}

export function VisualizadorImagem({ blob, nome, extensao, onControle }: PropsVisualizador) {
  const url = useUrl(blob);
  const [zoom, setZoom] = useState<number | null>(null);
  const [tamanho, setTamanho] = useState<{ w: number; h: number } | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (extensao === "svg") return;
    onControle?.({
      disponiveis: ["imagem-pdf"],
      converter: async () => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const titulo = nomeSemExtensao(nome);
        let pdf: Uint8Array;
        try {
          pdf = ["jpg", "jpeg"].includes(extensao) ? await pdfDeImagem({ tipo: "jpeg", bytes }, titulo) : await pdfDeImagem({ tipo: "rgb", ...(await rgbDaImagem(blob)) }, titulo);
        } catch {
          // JPEG em CMYK: decodifica e grava sem perda a partir do que o navegador mostra.
          pdf = await pdfDeImagem({ tipo: "rgb", ...(await rgbDaImagem(blob)) }, titulo);
        }
        return [{ blob: new Blob([pdf.slice().buffer], { type: "application/pdf" }), nome: `${titulo}.pdf` }];
      },
    });
    return () => onControle?.(null);
  }, [blob, nome, extensao, onControle]);

  const mudar = (fator: number) => setZoom((z) => Math.min(8, Math.max(0.05, (z ?? 1) * fator)));
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-hoikos-200 bg-white p-2">
      <Button size="sm" variant={zoom === null ? "default" : "outline"} onClick={() => setZoom(null)}>Ajustar</Button>
      <Button size="sm" variant={zoom === 1 ? "default" : "outline"} onClick={() => setZoom(1)}>100%</Button>
      <Button size="icon" variant="outline" onClick={() => mudar(1 / 1.25)} aria-label="Diminuir zoom"><Minus /></Button>
      <Button size="icon" variant="outline" onClick={() => mudar(1.25)} aria-label="Aumentar zoom"><Plus /></Button>
      {tamanho ? <p className="text-sm text-hoikos-600">{tamanho.w} × {tamanho.h} px</p> : null}
    </div>
    <div className="grid min-h-[360px] flex-1 place-items-center overflow-auto bg-[repeating-conic-gradient(#f1efe8_0%_25%,#fff_0%_50%)] bg-[length:20px_20px] p-4">
      {erro ? <p className="text-sm text-hoikos-700" role="alert">O navegador não conseguiu exibir esta imagem. Baixe o arquivo para abrir.</p>
        // eslint-disable-next-line @next/next/no-img-element -- blob local, sem otimização de servidor possível
        : <img src={url} alt={nome} onError={() => setErro(true)} onLoad={(event) => setTamanho({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
          style={zoom === null ? { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" } : { width: (tamanho?.w ?? 0) * zoom, maxWidth: "none" }} />}
    </div>
  </div>;
}

export function VisualizadorVideo({ blob, nome }: PropsVisualizador) {
  const url = useUrl(blob);
  const [erro, setErro] = useState(false);
  return <div className="grid min-h-[360px] flex-1 place-items-center bg-black p-2">
    {erro ? <p className="text-sm text-white" role="alert">Este navegador não reproduz este vídeo. Baixe o arquivo para assistir.</p>
      : <video src={url} controls className="max-h-full max-w-full" aria-label={nome} onError={() => setErro(true)} />}
  </div>;
}

export function VisualizadorAudio({ blob, nome }: PropsVisualizador) {
  const url = useUrl(blob);
  return <div className="grid min-h-48 flex-1 place-items-center p-6"><audio src={url} controls aria-label={nome} className="w-full max-w-lg" /></div>;
}

const LIMITE_TEXTO = 2 * 1024 * 1024;

/** Texto em UTF-8; se vier cheio de "�", era Windows-1252 (IES, LDT e TXT antigos). */
export function decodificarTexto(bytes: Uint8Array) {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const invalidos = (utf8.match(/�/g) ?? []).length;
  return invalidos > 2 ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

export function VisualizadorTexto({ blob }: PropsVisualizador) {
  const [texto, setTexto] = useState<string | null>(null);
  const [quebrar, setQuebrar] = useState(true);
  useEffect(() => {
    let vivo = true;
    void blob.slice(0, LIMITE_TEXTO).arrayBuffer().then((buffer) => { if (vivo) setTexto(decodificarTexto(new Uint8Array(buffer))); });
    return () => { vivo = false; };
  }, [blob]);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-hoikos-200 bg-white p-2">
      <Button size="sm" variant={quebrar ? "default" : "outline"} onClick={() => setQuebrar((v) => !v)} aria-pressed={quebrar}><WrapText />Quebrar linhas</Button>
      {blob.size > LIMITE_TEXTO ? <p className="text-sm text-hoikos-600">Mostrando os primeiros 2 MB. Baixe para ver o arquivo inteiro.</p> : null}
    </div>
    {texto === null ? <p className="flex items-center gap-2 p-6 text-sm" role="status"><LoaderCircle className="animate-spin" />Lendo…</p>
      : <pre className={`min-h-[360px] flex-1 overflow-auto bg-white p-4 font-mono text-xs leading-5 text-hoikos-900 ${quebrar ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>{texto}</pre>}
  </div>;
}
