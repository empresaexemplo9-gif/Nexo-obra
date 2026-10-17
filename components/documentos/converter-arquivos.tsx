"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, LoaderCircle, PencilLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Progress } from "@/components/ui/progress";
import { blobDe, mensagemDe, nomeBase, PainelResultado, SeletorArquivos, type Entrada, type Projeto, type Saida } from "@/components/documentos/comum";
import { imagensParaPdf, pdfDePaginasRenderizadas, type ImagemParaPdf, type OpcoesImagens } from "@/lib/documentos-pdf";
import { paginasParaMarkdown } from "@/lib/markdown-doc";
import { extensionOf, sizeLabel, type DocumentConversion } from "@/lib/org-files";
import { abrirPdfJs, paginaEmImagem, textoDasPaginas } from "@/lib/pdfjs-client";

type Operacao = "imagens-pdf" | "pdf-imagens" | "pdf-texto" | "reduzir";
type Resultado = { chave: string; saidas: Saida[]; origem: Entrada | null; conversao: DocumentConversion | null; aviso?: string; texto?: string };

const OPERACOES: { id: Operacao; rotulo: string; ajuda: string }[] = [
  { id: "imagens-pdf", rotulo: "Imagens → PDF", ajuda: "Fotos e imagens viram um PDF, uma por página, sem perder qualidade." },
  { id: "pdf-imagens", rotulo: "PDF → imagens", ajuda: "Cada página vira uma imagem JPG ou PNG." },
  { id: "pdf-texto", rotulo: "PDF → texto", ajuda: "Extrai o texto para editar e gerar um documento novo. PDF escaneado não tem texto para extrair." },
  { id: "reduzir", rotulo: "Reduzir tamanho", ajuda: "Regrava as páginas como imagem para o arquivo ficar mais leve, por exemplo para enviar por e-mail." },
];

const MAX_PAGINAS_RENDER = 200;
const IMAGENS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"];

export function ConverterArquivos({ canEdit, projects, onEditarTexto }: { canEdit: boolean; projects: Projeto[]; onEditarTexto: (texto: string, nome: string) => void }) {
  const [operacao, setOperacao] = useState<Operacao>("imagens-pdf");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [executando, setExecutando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState("");

  async function executar(tarefa: () => Promise<Omit<Resultado, "chave">>) {
    if (executando) return;
    setExecutando(true); setErro(""); setResultado(null); setProgresso(0);
    try { setResultado({ chave: crypto.randomUUID(), ...(await tarefa()) }); }
    catch (causa) { setErro(mensagemDe(causa, "Não foi possível converter.")); }
    finally { setExecutando(false); }
  }

  const ajuda = OPERACOES.find((o) => o.id === operacao)!.ajuda;
  const props = { executando, executar, setProgresso, limpar: () => setResultado(null) };
  return <div className="space-y-4">
    <ToggleGroup type="single" variant="outline" value={operacao} onValueChange={(valor) => { if (valor && !executando) { setOperacao(valor as Operacao); setResultado(null); setErro(""); } }} aria-label="Conversão" className="flex w-full flex-wrap">
      {OPERACOES.map((o) => <ToggleGroupItem key={o.id} value={o.id} className="flex-1 whitespace-nowrap px-3">{o.rotulo}</ToggleGroupItem>)}
    </ToggleGroup>
    <p className="text-sm text-drap-600">{ajuda}</p>
    {operacao === "imagens-pdf" ? <ImagensParaPdf {...props} /> : <DePdf key={operacao} operacao={operacao} {...props} />}
    {executando && progresso > 0 ? <div className="max-w-md space-y-1" role="status"><Progress value={progresso * 100} /><p className="text-xs text-drap-500">Processando… {Math.round(progresso * 100)}%</p></div> : null}
    {erro ? <p className="text-sm text-red-700" role="alert">{erro}</p> : null}
    {resultado?.texto !== undefined ? <Card><CardContent className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Texto extraído</p><Button size="sm" onClick={() => onEditarTexto(resultado.texto!, nomeBase(resultado.saidas[0].nome))}><PencilLine />Abrir no editor de documento</Button></div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-drap-50 p-3 text-xs">{resultado.texto.slice(0, 20000)}</pre>
    </CardContent></Card> : null}
    {resultado ? <PainelResultado key={resultado.chave} saidas={resultado.saidas} origem={resultado.origem} conversao={resultado.conversao} canEdit={canEdit} projects={projects} aviso={resultado.aviso} /> : null}
  </div>;
}

type PropsOperacao = {
  executando: boolean;
  executar: (tarefa: () => Promise<Omit<Resultado, "chave">>) => Promise<void>;
  setProgresso: (valor: number) => void;
  limpar: () => void;
};

/** JPEG e PNG entram como estão; os demais formatos são redesenhados em PNG pelo navegador. */
async function imagemParaPdf(entrada: Entrada): Promise<ImagemParaPdf> {
  const extensao = extensionOf(entrada.nome);
  const assinaturaJpeg = entrada.bytes[0] === 0xff && entrada.bytes[1] === 0xd8;
  const assinaturaPng = entrada.bytes[0] === 0x89 && entrada.bytes[1] === 0x50 && entrada.bytes[2] === 0x4e && entrada.bytes[3] === 0x47;
  if (assinaturaJpeg && ["jpg", "jpeg"].includes(extensao)) return { bytes: entrada.bytes, tipo: "jpg" };
  if (assinaturaPng) return { bytes: entrada.bytes, tipo: "png" };
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([entrada.bytes.slice().buffer])); }
  catch { throw new Error(`“${entrada.nome}” não é uma imagem que o navegador consiga ler.`); }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Não foi possível ler a imagem.")), "image/png"));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), tipo: "png" };
}

function ImagensParaPdf({ executando, executar, setProgresso, limpar }: PropsOperacao) {
  const [lista, setLista] = useState<Entrada[]>([]);
  const [opcoes, setOpcoes] = useState<OpcoesImagens>({ pagina: "a4", orientacao: "auto", margem: 20 });
  const mover = (de: number, para: number) => setLista((atual) => { if (para < 0 || para >= atual.length) return atual; const c = [...atual]; const [i] = c.splice(de, 1); c.splice(para, 0, i); return c; });
  return <Card><CardContent className="space-y-4 p-4">
    <SeletorArquivos extensoes={IMAGENS} multiplo rotulo="Adicione as imagens" desabilitado={executando} onAdicionar={(novas) => { setLista((atual) => [...atual, ...novas]); limpar(); }} />
    {lista.length ? <ol className="divide-y rounded-md border" aria-label="Ordem das páginas">{lista.map((item, indice) => <li key={item.chave} className="flex items-center gap-2 p-2.5 text-sm">
      <span className="w-6 text-center text-xs text-drap-500">{indice + 1}</span><span className="min-w-0 flex-1 truncate">{item.nome}</span><span className="hidden text-xs text-drap-500 sm:inline">{sizeLabel(item.bytes.byteLength)}</span>
      <Button size="icon" variant="ghost" aria-label={`Subir ${item.nome}`} disabled={indice === 0} onClick={() => mover(indice, indice - 1)}><ArrowUp /></Button>
      <Button size="icon" variant="ghost" aria-label={`Descer ${item.nome}`} disabled={indice === lista.length - 1} onClick={() => mover(indice, indice + 1)}><ArrowDown /></Button>
      <Button size="icon" variant="ghost" aria-label={`Remover ${item.nome}`} onClick={() => setLista((atual) => atual.filter((e) => e.chave !== item.chave))}><X /></Button>
    </li>)}</ol> : null}
    <div className="grid gap-3 sm:grid-cols-3">
      <div><Label htmlFor="img-pagina" className="mb-1.5 block text-xs">Página</Label><NativeSelect id="img-pagina" value={opcoes.pagina} onChange={(e) => setOpcoes({ ...opcoes, pagina: e.target.value as OpcoesImagens["pagina"] })} className="w-full"><NativeSelectOption value="a4">A4</NativeSelectOption><NativeSelectOption value="imagem">Tamanho da imagem</NativeSelectOption></NativeSelect></div>
      <div><Label htmlFor="img-orientacao" className="mb-1.5 block text-xs">Orientação</Label><NativeSelect id="img-orientacao" disabled={opcoes.pagina !== "a4"} value={opcoes.orientacao} onChange={(e) => setOpcoes({ ...opcoes, orientacao: e.target.value as OpcoesImagens["orientacao"] })} className="w-full"><NativeSelectOption value="auto">Conforme a imagem</NativeSelectOption><NativeSelectOption value="retrato">Retrato</NativeSelectOption><NativeSelectOption value="paisagem">Paisagem</NativeSelectOption></NativeSelect></div>
      <div><Label htmlFor="img-margem" className="mb-1.5 block text-xs">Margem</Label><NativeSelect id="img-margem" value={String(opcoes.margem)} onChange={(e) => setOpcoes({ ...opcoes, margem: Number(e.target.value) })} className="w-full"><NativeSelectOption value="0">Sem margem</NativeSelectOption><NativeSelectOption value="20">Pequena</NativeSelectOption><NativeSelectOption value="45">Grande</NativeSelectOption></NativeSelect></div>
    </div>
    <Button disabled={executando || !lista.length} onClick={() => void executar(async () => {
      const imagens: ImagemParaPdf[] = [];
      for (const [indice, entrada] of lista.entries()) { imagens.push(await imagemParaPdf(entrada)); setProgresso((indice + 1) / (lista.length + 1)); }
      const bytes = await imagensParaPdf(imagens, opcoes, nomeBase(lista[0].nome));
      setProgresso(1);
      const unica = lista.length === 1 ? lista[0] : null;
      return { saidas: [{ nome: `${nomeBase(lista[0].nome)}${lista.length > 1 ? " e outras" : ""}.pdf`, blob: blobDe(bytes, "application/pdf") }], origem: unica, conversao: null };
    })}>{executando ? <LoaderCircle className="animate-spin" /> : null}{lista.length ? `Gerar PDF com ${lista.length} imagem(ns)` : "Adicione imagens"}</Button>
  </CardContent></Card>;
}

function DePdf({ operacao, executando, executar, setProgresso, limpar }: PropsOperacao & { operacao: Exclude<Operacao, "imagens-pdf"> }) {
  const [entrada, setEntrada] = useState<Entrada | null>(null);
  const [formato, setFormato] = useState<"jpg" | "png">("jpg");
  const [dpi, setDpi] = useState(150);
  const [qualidade, setQualidade] = useState<"equilibrada" | "forte">("equilibrada");

  if (!entrada) return <SeletorArquivos extensoes={["pdf"]} rotulo="Escolha o PDF" onAdicionar={([e]) => { setEntrada(e); limpar(); }} />;

  async function converter(arquivo: Entrada) {
    const { documento, fechar } = await abrirPdfJs(arquivo.bytes);
    try {
      if (operacao === "pdf-texto") {
        const texto = paginasParaMarkdown(await textoDasPaginas(documento));
        if (!texto.trim()) throw new Error("Este PDF não tem texto selecionável (provavelmente é escaneado). Nada foi extraído.");
        return { saidas: [{ nome: `${nomeBase(arquivo.nome)}.md`, blob: new Blob([texto], { type: "text/markdown" }) }], origem: arquivo, conversao: "pdf-md" as const, texto, aviso: "Confira títulos e tabelas: o PDF guarda a posição das letras, não a estrutura." };
      }
      if (documento.numPages > MAX_PAGINAS_RENDER) throw new Error(`Este PDF tem ${documento.numPages} páginas; esta conversão aceita até ${MAX_PAGINAS_RENDER}. Divida o arquivo antes.`);
      if (operacao === "pdf-imagens") {
        const saidas: Saida[] = [];
        for (let numero = 1; numero <= documento.numPages; numero += 1) {
          const { blob } = await paginaEmImagem(documento, numero, dpi, formato === "jpg" ? "image/jpeg" : "image/png", 0.9);
          saidas.push({ nome: `${nomeBase(arquivo.nome)}${documento.numPages > 1 ? ` - página ${numero}` : ""}.${formato}`, blob });
          setProgresso(numero / documento.numPages);
        }
        return { saidas, origem: arquivo, conversao: null };
      }
      const [resolucao, compressao] = qualidade === "forte" ? [72, 0.55] : [110, 0.72];
      const paginas: { jpeg: Uint8Array; largura: number; altura: number }[] = [];
      for (let numero = 1; numero <= documento.numPages; numero += 1) {
        const { blob, largura, altura } = await paginaEmImagem(documento, numero, resolucao, "image/jpeg", compressao);
        paginas.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), largura, altura });
        setProgresso(numero / (documento.numPages + 1));
      }
      const bytes = await pdfDePaginasRenderizadas(paginas, nomeBase(arquivo.nome));
      setProgresso(1);
      // Sem ganho real, o original é melhor: texto selecionável e vetores intactos.
      if (bytes.byteLength >= arquivo.bytes.byteLength * 0.9) throw new Error(`Não houve redução que compense: o resultado teria ${sizeLabel(bytes.byteLength)} contra ${sizeLabel(arquivo.bytes.byteLength)} do original. Mantenha o arquivo original.`);
      const reducao = Math.round((1 - bytes.byteLength / arquivo.bytes.byteLength) * 100);
      return { saidas: [{ nome: `${nomeBase(arquivo.nome)} (reduzido).pdf`, blob: blobDe(bytes, "application/pdf") }], origem: arquivo, conversao: "pdf-reduzir" as const, aviso: `${reducao}% menor. O texto deixa de ser selecionável.` };
    } finally { fechar(); }
  }

  return <Card><CardContent className="space-y-4 p-4">
    <div className="flex items-center gap-3 rounded-lg border bg-white p-3">
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{entrada.nome}</p><p className="text-xs text-drap-500">{sizeLabel(entrada.bytes.byteLength)}</p></div>
      <Button size="sm" variant="outline" disabled={executando} onClick={() => { setEntrada(null); limpar(); }}>Trocar arquivo</Button>
    </div>
    {operacao === "pdf-imagens" ? <div className="grid max-w-md gap-3 sm:grid-cols-2">
      <div><Label htmlFor="pdf-formato" className="mb-1.5 block text-xs">Formato</Label><NativeSelect id="pdf-formato" value={formato} onChange={(e) => setFormato(e.target.value as typeof formato)} className="w-full"><NativeSelectOption value="jpg">JPG (mais leve)</NativeSelectOption><NativeSelectOption value="png">PNG (sem perda)</NativeSelectOption></NativeSelect></div>
      <div><Label htmlFor="pdf-dpi" className="mb-1.5 block text-xs">Resolução</Label><NativeSelect id="pdf-dpi" value={String(dpi)} onChange={(e) => setDpi(Number(e.target.value))} className="w-full"><NativeSelectOption value="100">100 dpi · tela</NativeSelectOption><NativeSelectOption value="150">150 dpi · padrão</NativeSelectOption><NativeSelectOption value="200">200 dpi · impressão</NativeSelectOption></NativeSelect></div>
    </div> : operacao === "reduzir" ? <div className="max-w-xs"><Label htmlFor="pdf-reducao" className="mb-1.5 block text-xs">Redução</Label><NativeSelect id="pdf-reducao" value={qualidade} onChange={(e) => setQualidade(e.target.value as typeof qualidade)} className="w-full"><NativeSelectOption value="equilibrada">Equilibrada · boa leitura</NativeSelectOption><NativeSelectOption value="forte">Forte · menor arquivo</NativeSelectOption></NativeSelect></div> : null}
    <Button disabled={executando} onClick={() => void executar(() => converter(entrada))}>{executando ? <LoaderCircle className="animate-spin" /> : null}{operacao === "pdf-texto" ? "Extrair texto" : operacao === "pdf-imagens" ? "Converter em imagens" : "Reduzir PDF"}</Button>
  </CardContent></Card>;
}
