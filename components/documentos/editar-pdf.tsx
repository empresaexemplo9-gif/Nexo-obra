"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LoaderCircle, RotateCcw, RotateCw, Trash2, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { blobDe, mensagemDe, nomeBase, PainelResultado, SeletorArquivos, type Entrada, type Projeto, type Saida } from "@/components/documentos/comum";
import { carimbarPdf, contarPaginas, dividirPdf, juntarPdfs, lerIntervalos, organizarPdf, type OpcoesCarimbo } from "@/lib/documentos-pdf";
import { sizeLabel, type DocumentConversion } from "@/lib/org-files";
import { abrirPdfJs, paginaEmImagem } from "@/lib/pdfjs-client";

type Operacao = "juntar" | "organizar" | "dividir" | "carimbar";
type Resultado = { chave: string; saidas: Saida[]; origem: Entrada | null; conversao: DocumentConversion | null };

const OPERACOES: { id: Operacao; rotulo: string; ajuda: string }[] = [
  { id: "juntar", rotulo: "Juntar", ajuda: "Una vários PDFs num só, na ordem que escolher." },
  { id: "organizar", rotulo: "Organizar páginas", ajuda: "Reordene, gire ou exclua páginas de um PDF." },
  { id: "dividir", rotulo: "Dividir", ajuda: "Separe trechos de páginas em arquivos próprios." },
  { id: "carimbar", rotulo: "Numerar e marca d'água", ajuda: "Numere as páginas e aplique um texto de marca d'água." },
];

const MAX_PAGINAS_ORGANIZAR = 300;

function mover<T>(lista: T[], de: number, para: number) {
  if (para < 0 || para >= lista.length) return lista;
  const copia = [...lista];
  const [item] = copia.splice(de, 1);
  copia.splice(para, 0, item);
  return copia;
}

export function EditarPdf({ canEdit, projects }: { canEdit: boolean; projects: Projeto[] }) {
  const [operacao, setOperacao] = useState<Operacao>("juntar");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const ajuda = OPERACOES.find((o) => o.id === operacao)!.ajuda;
  return <div className="space-y-4">
    <ToggleGroup type="single" variant="outline" value={operacao} onValueChange={(valor) => { if (valor) { setOperacao(valor as Operacao); setResultado(null); } }} aria-label="Operação" className="flex w-full flex-wrap">
      {OPERACOES.map((o) => <ToggleGroupItem key={o.id} value={o.id} className="flex-1 whitespace-nowrap px-3">{o.rotulo}</ToggleGroupItem>)}
    </ToggleGroup>
    <p className="text-sm text-drap-600">{ajuda}</p>
    {operacao === "juntar" ? <Juntar onResultado={setResultado} />
      : operacao === "organizar" ? <Organizar onResultado={setResultado} />
        : operacao === "dividir" ? <Dividir onResultado={setResultado} />
          : <Carimbar onResultado={setResultado} />}
    {resultado ? <PainelResultado key={resultado.chave} saidas={resultado.saidas} origem={resultado.origem} conversao={resultado.conversao} canEdit={canEdit} projects={projects} /> : null}
  </div>;
}

type PropsOperacao = { onResultado: (resultado: Resultado | null) => void };

function useExecucao(onResultado: PropsOperacao["onResultado"]) {
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState("");
  async function executar(tarefa: () => Promise<Omit<Resultado, "chave">>) {
    if (executando) return;
    setExecutando(true); setErro(""); onResultado(null);
    try { onResultado({ chave: crypto.randomUUID(), ...(await tarefa()) }); }
    catch (causa) { setErro(mensagemDe(causa, "Não foi possível processar o PDF.")); }
    finally { setExecutando(false); }
  }
  return { executando, erro, executar };
}

const pdf = (bytes: Uint8Array, nome: string): Saida => ({ nome, blob: blobDe(bytes, "application/pdf") });

function ArquivoEscolhido({ entrada, detalhe, onTrocar }: { entrada: Entrada; detalhe?: string; onTrocar: () => void }) {
  return <div className="flex items-center gap-3 rounded-lg border bg-white p-3">
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{entrada.nome}</p><p className="text-xs text-drap-500">{sizeLabel(entrada.bytes.byteLength)}{detalhe ? ` · ${detalhe}` : ""}</p></div>
    <Button size="sm" variant="outline" onClick={onTrocar}>Trocar arquivo</Button>
  </div>;
}

function Juntar({ onResultado }: PropsOperacao) {
  const [lista, setLista] = useState<Entrada[]>([]);
  const { executando, erro, executar } = useExecucao(onResultado);
  return <Card><CardContent className="space-y-4 p-4">
    <SeletorArquivos extensoes={["pdf"]} multiplo rotulo="Adicione os PDFs" desabilitado={executando} onAdicionar={(novos) => { setLista((atual) => [...atual, ...novos]); onResultado(null); }} />
    {lista.length ? <ol className="divide-y rounded-md border" aria-label="Ordem dos arquivos">{lista.map((item, indice) => <li key={item.chave} className="flex items-center gap-2 p-2.5 text-sm">
      <span className="w-6 text-center text-xs text-drap-500">{indice + 1}</span>
      <span className="min-w-0 flex-1 truncate">{item.nome}</span><span className="hidden text-xs text-drap-500 sm:inline">{sizeLabel(item.bytes.byteLength)}</span>
      <Button size="icon" variant="ghost" aria-label={`Subir ${item.nome}`} disabled={indice === 0} onClick={() => setLista((atual) => mover(atual, indice, indice - 1))}><ArrowUp /></Button>
      <Button size="icon" variant="ghost" aria-label={`Descer ${item.nome}`} disabled={indice === lista.length - 1} onClick={() => setLista((atual) => mover(atual, indice, indice + 1))}><ArrowDown /></Button>
      <Button size="icon" variant="ghost" aria-label={`Remover ${item.nome}`} onClick={() => setLista((atual) => atual.filter((e) => e.chave !== item.chave))}><X /></Button>
    </li>)}</ol> : null}
    <Button disabled={executando || lista.length < 2} onClick={() => void executar(async () => ({
      saidas: [pdf(await juntarPdfs(lista.map((e) => ({ nome: e.nome, bytes: e.bytes }))), `${nomeBase(lista[0].nome)} (juntado).pdf`)], origem: null, conversao: null,
    }))}>{executando ? <LoaderCircle className="animate-spin" /> : null}{lista.length < 2 ? "Adicione pelo menos dois PDFs" : `Juntar ${lista.length} PDFs`}</Button>
    {erro ? <p className="text-sm text-red-700" role="alert">{erro}</p> : null}
  </CardContent></Card>;
}

type PaginaEstado = { indice: number; giro: 0 | 90 | 180 | 270; excluida: boolean; miniatura: string | null };

function Organizar({ onResultado }: PropsOperacao) {
  const [entrada, setEntrada] = useState<Entrada | null>(null);
  const [paginas, setPaginas] = useState<PaginaEstado[]>([]);
  const [abrindo, setAbrindo] = useState(false);
  const [erroAbrir, setErroAbrir] = useState("");
  const { executando, erro, executar } = useExecucao(onResultado);

  useEffect(() => {
    if (!entrada) return;
    let cancelado = false;
    const urls: string[] = [];
    let fechar = () => {};
    const timer = window.setTimeout(() => {
      setAbrindo(true); setErroAbrir(""); setPaginas([]);
      void (async () => {
        try {
          const aberto = await abrirPdfJs(entrada.bytes);
          fechar = aberto.fechar;
          if (cancelado) { fechar(); return; }
          const documento = aberto.documento;
          if (documento.numPages > MAX_PAGINAS_ORGANIZAR) throw new Error(`Este PDF tem ${documento.numPages} páginas; o organizador abre até ${MAX_PAGINAS_ORGANIZAR}. Divida o arquivo antes.`);
          setPaginas(Array.from({ length: documento.numPages }, (_, indice) => ({ indice, giro: 0, excluida: false, miniatura: null })));
          setAbrindo(false);
          // Miniaturas em 24 dpi, uma de cada vez: a lista aparece já e vai ganhando imagem.
          for (let numero = 1; numero <= documento.numPages && !cancelado; numero += 1) {
            const { blob } = await paginaEmImagem(documento, numero, 24, "image/jpeg", 0.7);
            const url = URL.createObjectURL(blob);
            urls.push(url);
            if (!cancelado) setPaginas((atual) => atual.map((p) => p.indice === numero - 1 ? { ...p, miniatura: url } : p));
          }
        } catch (causa) { if (!cancelado) { setErroAbrir(mensagemDe(causa, "Não foi possível abrir o PDF.")); setAbrindo(false); } }
      })();
    }, 0);
    return () => { cancelado = true; window.clearTimeout(timer); fechar(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [entrada]);

  const girar = (posicao: number, delta: 90 | 270) => setPaginas((atual) => atual.map((p, i) => i === posicao ? { ...p, giro: ((p.giro + delta) % 360) as PaginaEstado["giro"] } : p));
  const mantidas = paginas.filter((p) => !p.excluida);

  if (!entrada) return <SeletorArquivos extensoes={["pdf"]} rotulo="Escolha o PDF" onAdicionar={([e]) => { setEntrada(e); onResultado(null); }} />;
  return <Card><CardContent className="space-y-4 p-4">
    <ArquivoEscolhido entrada={entrada} detalhe={paginas.length ? `${paginas.length} página(s) · ${mantidas.length} mantida(s)` : undefined} onTrocar={() => { setEntrada(null); onResultado(null); }} />
    {abrindo ? <p className="flex items-center gap-2 text-sm text-drap-600" role="status"><LoaderCircle className="animate-spin" />Abrindo o PDF…</p> : null}
    {erroAbrir ? <p className="text-sm text-red-700" role="alert">{erroAbrir}</p> : null}
    {paginas.length ? <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Páginas">{paginas.map((pagina, posicao) => <li key={pagina.indice} className={`rounded-lg border bg-white p-2 ${pagina.excluida ? "opacity-45" : ""}`}>
      <div className="grid aspect-[3/4] place-items-center overflow-hidden rounded bg-drap-50">
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura em blob local */}
        {pagina.miniatura ? <img src={pagina.miniatura} alt={`Miniatura da página ${pagina.indice + 1}`} className="max-h-full max-w-full shadow-sm transition-transform" style={{ transform: `rotate(${pagina.giro}deg) scale(${pagina.giro % 180 ? 0.72 : 1})` }} /> : <LoaderCircle className="size-4 animate-spin text-drap-400" aria-hidden="true" />}
      </div>
      <p className="mt-1.5 text-center text-xs">Página {pagina.indice + 1}{pagina.giro ? ` · ${pagina.giro}°` : ""}{pagina.excluida ? " · excluída" : ""}</p>
      <div className="mt-1 flex flex-wrap justify-center gap-0.5">
        <Button size="icon" variant="ghost" className="size-7" aria-label={`Mover página ${pagina.indice + 1} para antes`} disabled={posicao === 0} onClick={() => setPaginas((atual) => mover(atual, posicao, posicao - 1))}><ArrowLeft /></Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label={`Girar página ${pagina.indice + 1} para a esquerda`} onClick={() => girar(posicao, 270)}><RotateCcw /></Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label={`Girar página ${pagina.indice + 1} para a direita`} onClick={() => girar(posicao, 90)}><RotateCw /></Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label={pagina.excluida ? `Manter página ${pagina.indice + 1}` : `Excluir página ${pagina.indice + 1}`} onClick={() => setPaginas((atual) => atual.map((p, i) => i === posicao ? { ...p, excluida: !p.excluida } : p))}>{pagina.excluida ? <Undo2 /> : <Trash2 />}</Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label={`Mover página ${pagina.indice + 1} para depois`} disabled={posicao === paginas.length - 1} onClick={() => setPaginas((atual) => mover(atual, posicao, posicao + 1))}><ArrowRight /></Button>
      </div>
    </li>)}</ol> : null}
    <Button disabled={executando || !mantidas.length} onClick={() => void executar(async () => ({
      saidas: [pdf(await organizarPdf(entrada.bytes, mantidas.map((p) => ({ indice: p.indice, giro: p.giro })), entrada.nome), `${nomeBase(entrada.nome)} (organizado).pdf`)], origem: entrada, conversao: "pdf-organizar",
    }))}>{executando ? <LoaderCircle className="animate-spin" /> : null}Gerar PDF organizado</Button>
    {erro ? <p className="text-sm text-red-700" role="alert">{erro}</p> : null}
  </CardContent></Card>;
}

function useTotalDePaginas(entrada: Entrada | null) {
  const [total, setTotal] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let cancelado = false;
    const timer = window.setTimeout(() => {
      setTotal(null); setErro("");
      if (entrada) void contarPaginas(entrada.bytes, entrada.nome).then((n) => { if (!cancelado) setTotal(n); }).catch((causa) => { if (!cancelado) setErro(mensagemDe(causa, "Não foi possível abrir o PDF.")); });
    }, 0);
    return () => { cancelado = true; window.clearTimeout(timer); };
  }, [entrada]);
  return { total, erro };
}

function Dividir({ onResultado }: PropsOperacao) {
  const [entrada, setEntrada] = useState<Entrada | null>(null);
  const [modo, setModo] = useState<"intervalos" | "cada">("intervalos");
  const [intervalos, setIntervalos] = useState("");
  const { total, erro: erroAbrir } = useTotalDePaginas(entrada);
  const { executando, erro, executar } = useExecucao(onResultado);

  if (!entrada) return <SeletorArquivos extensoes={["pdf"]} rotulo="Escolha o PDF" onAdicionar={([e]) => { setEntrada(e); onResultado(null); }} />;
  return <Card><CardContent className="space-y-4 p-4">
    <ArquivoEscolhido entrada={entrada} detalhe={total ? `${total} página(s)` : undefined} onTrocar={() => { setEntrada(null); onResultado(null); }} />
    {erroAbrir ? <p className="text-sm text-red-700" role="alert">{erroAbrir}</p> : null}
    <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Como dividir</legend>
      <RadioGroup value={modo} onValueChange={(valor) => setModo(valor as typeof modo)}>
        <span className="flex items-center gap-2"><RadioGroupItem id="dividir-intervalos" value="intervalos" /><Label htmlFor="dividir-intervalos">Por trechos de páginas</Label></span>
        <span className="flex items-center gap-2"><RadioGroupItem id="dividir-cada" value="cada" /><Label htmlFor="dividir-cada">Um arquivo por página</Label></span>
      </RadioGroup>
    </fieldset>
    {modo === "intervalos" ? <div className="max-w-sm"><Label htmlFor="intervalos" className="mb-1.5 block">Trechos</Label><Input id="intervalos" value={intervalos} onChange={(evento) => setIntervalos(evento.target.value)} placeholder="1-3, 5, 8-" aria-describedby="intervalos-ajuda" /><p id="intervalos-ajuda" className="mt-1 text-xs text-drap-500">Cada trecho separado por vírgula vira um arquivo. “8-” vai até a última página.</p></div> : null}
    <Button disabled={executando || !total} onClick={() => void executar(async () => {
      const grupos = modo === "cada" ? Array.from({ length: total! }, (_, i) => [i]) : lerIntervalos(intervalos, total!);
      const partes = await dividirPdf(entrada.bytes, grupos, entrada.nome);
      const rotulo = (grupo: number[]) => grupo.length === 1 ? `página ${grupo[0] + 1}` : `páginas ${grupo[0] + 1}-${grupo.at(-1)! + 1}`;
      return { saidas: partes.map((bytes, i) => pdf(bytes, `${nomeBase(entrada.nome)} - ${rotulo(grupos[i])}.pdf`)), origem: entrada, conversao: "pdf-dividir" };
    })}>{executando ? <LoaderCircle className="animate-spin" /> : null}Dividir PDF</Button>
    {erro ? <p className="text-sm text-red-700" role="alert">{erro}</p> : null}
  </CardContent></Card>;
}

function Carimbar({ onResultado }: PropsOperacao) {
  const [entrada, setEntrada] = useState<Entrada | null>(null);
  const [numerar, setNumerar] = useState(true);
  const [posicao, setPosicao] = useState<NonNullable<OpcoesCarimbo["numeros"]>["posicao"]>("rodape-centro");
  const [formato, setFormato] = useState<"n" | "n-de-total">("n-de-total");
  const [primeiro, setPrimeiro] = useState("1");
  const [marcar, setMarcar] = useState(false);
  const [marca, setMarca] = useState("CÓPIA PARA REVISÃO");
  const [opacidade, setOpacidade] = useState(20);
  const { executando, erro, executar } = useExecucao(onResultado);

  if (!entrada) return <SeletorArquivos extensoes={["pdf"]} rotulo="Escolha o PDF" onAdicionar={([e]) => { setEntrada(e); onResultado(null); }} />;
  const numeroInicial = Number(primeiro);
  const invalido = (numerar && (!Number.isInteger(numeroInicial) || numeroInicial < 0 || numeroInicial > 99999)) || (marcar && !marca.trim()) || (!numerar && !marcar);
  return <Card><CardContent className="space-y-4 p-4">
    <ArquivoEscolhido entrada={entrada} onTrocar={() => { setEntrada(null); onResultado(null); }} />
    <div className="grid gap-4 md:grid-cols-2">
      <fieldset className="space-y-3 rounded-lg border p-3"><legend className="px-1 text-sm font-medium"><span className="flex items-center gap-2"><Checkbox id="carimbo-numerar" checked={numerar} onCheckedChange={(v) => setNumerar(v === true)} /><Label htmlFor="carimbo-numerar">Numerar páginas</Label></span></legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label htmlFor="num-posicao" className="mb-1.5 block text-xs">Posição</Label><NativeSelect id="num-posicao" disabled={!numerar} value={posicao} onChange={(e) => setPosicao(e.target.value as typeof posicao)} className="w-full"><NativeSelectOption value="rodape-centro">Rodapé, centro</NativeSelectOption><NativeSelectOption value="rodape-direita">Rodapé, direita</NativeSelectOption><NativeSelectOption value="topo-direita">Topo, direita</NativeSelectOption></NativeSelect></div>
          <div><Label htmlFor="num-formato" className="mb-1.5 block text-xs">Formato</Label><NativeSelect id="num-formato" disabled={!numerar} value={formato} onChange={(e) => setFormato(e.target.value as typeof formato)} className="w-full"><NativeSelectOption value="n-de-total">1 de 10</NativeSelectOption><NativeSelectOption value="n">1</NativeSelectOption></NativeSelect></div>
          <div><Label htmlFor="num-primeiro" className="mb-1.5 block text-xs">Primeiro número</Label><Input id="num-primeiro" inputMode="numeric" disabled={!numerar} value={primeiro} onChange={(e) => setPrimeiro(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border p-3"><legend className="px-1 text-sm font-medium"><span className="flex items-center gap-2"><Checkbox id="carimbo-marcar" checked={marcar} onCheckedChange={(v) => setMarcar(v === true)} /><Label htmlFor="carimbo-marcar">Marca d&apos;água</Label></span></legend>
        <div><Label htmlFor="marca-texto" className="mb-1.5 block text-xs">Texto</Label><Input id="marca-texto" disabled={!marcar} value={marca} maxLength={60} onChange={(e) => setMarca(e.target.value)} /></div>
        <div><Label htmlFor="marca-opacidade" className="mb-1.5 block text-xs">Intensidade: {opacidade}%</Label><Slider id="marca-opacidade" aria-label="Intensidade da marca d'água" min={5} max={60} step={5} disabled={!marcar} value={[opacidade]} onValueChange={([valor]) => setOpacidade(valor)} /></div>
      </fieldset>
    </div>
    <Button disabled={executando || invalido} onClick={() => void executar(async () => ({
      saidas: [pdf(await carimbarPdf(entrada.bytes, {
        numeros: numerar ? { posicao, formato, primeiro: numeroInicial } : undefined,
        marca: marcar ? { texto: marca, opacidade: opacidade / 100, tamanho: 64 } : undefined,
      }, entrada.nome), `${nomeBase(entrada.nome)} (${numerar && marcar ? "numerado com marca" : numerar ? "numerado" : "com marca d'água"}).pdf`)], origem: entrada, conversao: "pdf-carimbo",
    }))}>{executando ? <LoaderCircle className="animate-spin" /> : null}Aplicar ao PDF</Button>
    {erro ? <p className="text-sm text-red-700" role="alert">{erro}</p> : null}
  </CardContent></Card>;
}
