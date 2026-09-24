"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ComponentType } from "react";
import { FileQuestion, LoaderCircle } from "lucide-react";

import { downloadOrgFile, type OrgFileInfo } from "@/lib/org-files-client";
import { motivoSemVisualizacao, visualizadorPara } from "@/lib/prancheta-formatos";
import type { ControleVisualizador, PropsVisualizador } from "@/components/prancheta/tipos";

const carregando = () => <p className="flex items-center justify-center gap-2 p-6 text-sm" role="status"><LoaderCircle className="animate-spin" />Carregando o visualizador…</p>;
// Cada visualizador é carregado só quando um arquivo daquele tipo é aberto: o PDF.js, o
// three.js e o leitor IFC não pesam para quem só abriu uma imagem.
const Cad = dynamic(() => import("@/components/prancheta/visualizador-cad"), { ssr: false, loading: carregando });
const Pdf = dynamic(() => import("@/components/prancheta/visualizador-pdf"), { ssr: false, loading: carregando });
const Modelo3d = dynamic(() => import("@/components/prancheta/visualizador-3d"), { ssr: false, loading: carregando });
const Docx = dynamic(() => import("@/components/prancheta/visualizador-office").then((m) => m.VisualizadorDocx), { ssr: false, loading: carregando });
const Planilha = dynamic(() => import("@/components/prancheta/visualizador-office").then((m) => m.VisualizadorPlanilha), { ssr: false, loading: carregando });
const Imagem = dynamic(() => import("@/components/prancheta/visualizador-midia").then((m) => m.VisualizadorImagem), { ssr: false, loading: carregando });
const Video = dynamic(() => import("@/components/prancheta/visualizador-midia").then((m) => m.VisualizadorVideo), { ssr: false, loading: carregando });
const Audio = dynamic(() => import("@/components/prancheta/visualizador-midia").then((m) => m.VisualizadorAudio), { ssr: false, loading: carregando });
const Texto = dynamic(() => import("@/components/prancheta/visualizador-midia").then((m) => m.VisualizadorTexto), { ssr: false, loading: carregando });

const componentes: Record<string, ComponentType<PropsVisualizador>> = {
  cad: Cad, pdf: Pdf, modelo3d: Modelo3d, documento: Docx, planilha: Planilha, imagem: Imagem, video: Video, audio: Audio, texto: Texto,
};

async function converterDwg(file: OrgFileInfo): Promise<OrgFileInfo> {
  const response = await fetch(`/api/arquivos/${file.id}/converter`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ para: "dxf" }),
  });
  const body = await response.json().catch(() => ({})) as { file?: OrgFileInfo; error?: string };
  if (!response.ok || !body.file) throw new Error(body.error ?? "Não foi possível converter o DWG para exibir.");
  return body.file;
}

/**
 * Abre o arquivo no visualizador do formato. DWG passa pelo servidor uma vez: o DXF
 * gerado fica guardado como cópia de visualização e as próximas aberturas não convertem.
 */
export function VisualizadorArquivo({ file, onControle }: { file: OrgFileInfo; onControle?: (controle: ControleVisualizador | null) => void }) {
  const tipo = visualizadorPara(file.extension);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [etapa, setEtapa] = useState("Baixando…");
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (tipo === "nenhum") return;
    let vivo = true;
    const controle = new AbortController();
    (async () => {
      let alvo = file;
      if (file.extension === "dwg") {
        setEtapa("Convertendo o DWG no servidor…");
        alvo = await converterDwg(file);
      }
      const baixado = await downloadOrgFile(alvo, (fracao) => { if (vivo) setEtapa(`Baixando · ${Math.round(fracao * 100)}%`); }, controle.signal);
      if (vivo) setBlob(baixado);
    })().catch((causa) => { if (vivo) setErro(causa instanceof Error ? causa.message : "Não foi possível abrir o arquivo."); });
    return () => { vivo = false; controle.abort(); };
  }, [file, tipo]);

  if (tipo === "nenhum") {
    return <div className="grid min-h-72 flex-1 place-items-center p-6 text-center"><div>
      <FileQuestion className="mx-auto size-8 text-hoikos-500" />
      <p className="mt-3 font-medium text-hoikos-900">Sem pré-visualização para .{file.extension || "arquivo"}</p>
      <p className="mt-2 max-w-md text-sm text-hoikos-500">{motivoSemVisualizacao(file.extension)} O arquivo está guardado no formato original e pode ser baixado e enviado pela Comunicação.</p>
    </div></div>;
  }
  if (erro) return <div className="grid min-h-72 flex-1 place-items-center p-6 text-center" role="alert"><div><p className="font-medium text-hoikos-900">Não foi possível abrir</p><p className="mt-2 max-w-md text-sm text-hoikos-500">{erro}</p></div></div>;
  if (!blob) return <p className="flex min-h-72 flex-1 items-center justify-center gap-2 p-6 text-sm" role="status"><LoaderCircle className="animate-spin" />{etapa}</p>;
  const Componente = componentes[tipo];
  // O DWG é exibido pelo DXF convertido; o nome continua o do original.
  return <Componente blob={blob} nome={file.name} extensao={file.extension === "dwg" ? "dxf" : file.extension} onControle={onControle} />;
}
