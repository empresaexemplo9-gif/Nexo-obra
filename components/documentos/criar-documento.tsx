"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bold, FilePlus2, Heading2, Italic, List, LoaderCircle, Table2, FileDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { blobDe, mensagemDe, nomeBase, PainelResultado, SeletorArquivos, type Entrada, type Projeto, type Saida } from "@/components/documentos/comum";
import { markdownParaPdf } from "@/lib/documentos-pdf";
import { lerMarkdown, tituloDoMarkdown, type Bloco, type Trecho } from "@/lib/markdown-doc";

// Modelos com lacunas entre colchetes: estrutura pronta, nenhum dado inventado.
const MODELOS: { id: string; rotulo: string; texto: string }[] = [
  { id: "memorial", rotulo: "Memorial descritivo", texto: "# Memorial descritivo — [nome do projeto]\n\nCliente: [nome do cliente]\nEndereço da obra: [endereço]\n\n## Objeto\n\n[Descreva o escopo do projeto ou da obra.]\n\n## Especificações\n\n| Ambiente | Piso | Parede | Teto |\n| --- | --- | --- | --- |\n| [ambiente] | [material] | [material] | [material] |\n\n## Observações\n\n- [observação]\n" },
  { id: "ata", rotulo: "Ata de reunião", texto: "# Ata de reunião — [data]\n\nPresentes: [nomes]\nLocal: [local ou chamada]\n\n## Pauta\n\n1. [assunto]\n\n## Decisões\n\n- [decisão] — responsável: [nome], prazo: [data]\n\n## Próximos passos\n\n- [ação]\n" },
  { id: "escopo", rotulo: "Escopo de serviço", texto: "# Escopo de serviço — [nome do serviço]\n\n## Incluído\n\n- [entrega]\n\n## Não incluído\n\n- [item fora do escopo]\n\n## Prazos\n\n| Etapa | Prazo |\n| --- | --- |\n| [etapa] | [dias úteis] |\n\n> Valores e condições de pagamento constam na proposta comercial.\n" },
];

const RASCUNHO = "drap:documentos:rascunho";

function TrechosVisiveis({ trechos }: { trechos: Trecho[] }) {
  return <>{trechos.map((t, i) => {
    if (t.texto === "\n") return <br key={i} />;
    let no: ReactNode = t.texto;
    if (t.codigo) no = <code className="rounded bg-drap-100 px-1 font-mono text-[0.9em]">{no}</code>;
    if (t.italico) no = <em>{no}</em>;
    if (t.negrito) no = <strong>{no}</strong>;
    return <span key={i}>{no}</span>;
  })}</>;
}

/** Prévia a partir dos mesmos blocos que geram o PDF. Sem HTML vindo do texto. */
export function PreviaMarkdown({ blocos }: { blocos: Bloco[] }) {
  if (!blocos.length) return <p className="text-sm text-drap-500">A prévia aparece aqui enquanto você escreve.</p>;
  return <div className="space-y-3 text-sm leading-6 text-drap-950">{blocos.map((bloco, i) => {
    if (bloco.tipo === "titulo") { const Tag = (`h${bloco.nivel + 1}`) as "h2" | "h3" | "h4"; return <Tag key={i} className={bloco.nivel === 1 ? "text-xl font-semibold" : bloco.nivel === 2 ? "pt-1 text-lg font-semibold" : "font-semibold"}><TrechosVisiveis trechos={bloco.trechos} /></Tag>; }
    if (bloco.tipo === "paragrafo") return <p key={i}><TrechosVisiveis trechos={bloco.trechos} /></p>;
    if (bloco.tipo === "lista") { const Tag = bloco.ordenada ? "ol" : "ul"; return <Tag key={i} start={bloco.ordenada ? bloco.inicio : undefined} className={`space-y-1 pl-5 ${bloco.ordenada ? "list-decimal" : "list-disc"}`}>{bloco.itens.map((item, j) => <li key={j}><TrechosVisiveis trechos={item} /></li>)}</Tag>; }
    if (bloco.tipo === "citacao") return <blockquote key={i} className="border-l-2 border-drap-300 pl-3 italic text-drap-600"><TrechosVisiveis trechos={bloco.trechos} /></blockquote>;
    if (bloco.tipo === "codigo") return <pre key={i} className="overflow-x-auto rounded bg-drap-50 p-2 font-mono text-xs">{bloco.linhas.join("\n")}</pre>;
    if (bloco.tipo === "tabela") return <div key={i} className="overflow-x-auto"><table className="w-full border-collapse text-xs"><thead><tr>{bloco.cabecalho.map((c, j) => <th key={j} className="border bg-drap-50 p-1.5 text-left font-semibold"><TrechosVisiveis trechos={c} /></th>)}</tr></thead><tbody>{bloco.linhas.map((linha, j) => <tr key={j}>{bloco.cabecalho.map((_, k) => <td key={k} className="border p-1.5"><TrechosVisiveis trechos={linha[k] ?? []} /></td>)}</tr>)}</tbody></table></div>;
    return <hr key={i} className="border-drap-200" />;
  })}</div>;
}

export function CriarDocumento({ canEdit, projects, textoInicial }: { canEdit: boolean; projects: Projeto[]; textoInicial: { texto: string; nome: string; versao: number } | null }) {
  const [texto, setTexto] = useState("");
  const [nome, setNome] = useState("");
  const [origem, setOrigem] = useState<Entrada | null>(null);
  const [numerar, setNumerar] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<{ chave: string; saidas: Saida[]; conversao: "md-pdf" | null } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);

  // Rascunho local: fechar a aba sem querer não apaga o texto. Não substitui guardar.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { const salvo = window.localStorage.getItem(RASCUNHO); if (salvo) { const dados = JSON.parse(salvo) as { texto?: string; nome?: string }; setTexto(dados.texto ?? ""); setNome(dados.nome ?? ""); } } catch { /* armazenamento indisponível */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { try { window.localStorage.setItem(RASCUNHO, JSON.stringify({ texto, nome })); } catch { /* armazenamento indisponível */ } }, 400);
    return () => window.clearTimeout(timer);
  }, [texto, nome]);
  // Texto vindo de outra ferramenta (PDF → texto) abre aqui para editar.
  useEffect(() => {
    if (!textoInicial) return;
    const timer = window.setTimeout(() => { setTexto(textoInicial.texto); setNome(textoInicial.nome); setOrigem(null); setResultado(null); }, 0);
    return () => window.clearTimeout(timer);
  }, [textoInicial]);

  const blocos = useMemo(() => lerMarkdown(texto), [texto]);
  const nomeFinal = (nome.trim() || tituloDoMarkdown(texto) || "Documento").replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);

  function inserir(antes: string, depois = "", exemplo = "") {
    const campo = editor.current;
    if (!campo) return;
    const { selectionStart: inicio, selectionEnd: fim } = campo;
    const selecionado = texto.slice(inicio, fim) || exemplo;
    const novo = `${texto.slice(0, inicio)}${antes}${selecionado}${depois}${texto.slice(fim)}`;
    setTexto(novo);
    window.requestAnimationFrame(() => { campo.focus(); campo.setSelectionRange(inicio + antes.length, inicio + antes.length + selecionado.length); });
  }

  function abrir(entradas: Entrada[]) {
    const [entrada] = entradas;
    if (!entrada) return;
    if (texto.trim() && !window.confirm("Substituir o texto atual pelo arquivo aberto?")) return;
    setTexto(new TextDecoder().decode(entrada.bytes));
    setNome(nomeBase(entrada.nome));
    setOrigem(entrada);
    setResultado(null);
  }

  function usarModelo(modelo: string) {
    const escolhido = MODELOS.find((m) => m.id === modelo);
    if (!escolhido) return;
    if (texto.trim() && !window.confirm("Substituir o texto atual pelo modelo?")) return;
    setTexto(escolhido.texto); setNome(""); setOrigem(null); setResultado(null);
  }

  async function gerarPdf() {
    if (gerando) return;
    setGerando(true); setErro("");
    try {
      const bytes = await markdownParaPdf(texto, { titulo: tituloDoMarkdown(texto) || nomeFinal, numerarPaginas: numerar });
      setResultado({ chave: crypto.randomUUID(), saidas: [{ nome: `${nomeFinal}.pdf`, blob: blobDe(bytes, "application/pdf") }], conversao: "md-pdf" });
    } catch (causa) { setErro(mensagemDe(causa, "Não foi possível gerar o PDF.")); }
    finally { setGerando(false); }
  }

  function prepararTexto() {
    if (!texto.trim()) { setErro("Escreva o conteúdo antes de guardar o texto."); return; }
    setErro("");
    setResultado({ chave: crypto.randomUUID(), saidas: [{ nome: `${nomeFinal}.md`, blob: new Blob([texto], { type: "text/markdown" }) }], conversao: null });
  }

  return <div className="space-y-4">
    <Card><CardContent className="grid items-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="doc-nome" className="mb-1.5 block">Nome do arquivo</Label><Input id="doc-nome" value={nome} placeholder={tituloDoMarkdown(texto) || "Documento"} onChange={(evento) => setNome(evento.target.value)} maxLength={120} /></div>
        <div><Label htmlFor="doc-modelo" className="mb-1.5 block">Começar de um modelo</Label>
          <NativeSelect id="doc-modelo" value="" onChange={(evento) => usarModelo(evento.target.value)} className="w-full"><NativeSelectOption value="">Escolha…</NativeSelectOption>{MODELOS.map((m) => <NativeSelectOption key={m.id} value={m.id}>{m.rotulo}</NativeSelectOption>)}</NativeSelect></div>
      </div>
      <SeletorArquivos extensoes={["md", "txt"]} rotulo="Editar um texto existente" onAdicionar={abrir} />
    </CardContent></Card>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="overflow-hidden"><div className="flex flex-wrap gap-1 border-b bg-drap-50 p-2" role="toolbar" aria-label="Formatação">
        <Button size="sm" variant="ghost" onClick={() => inserir("## ", "", "Título")} aria-label="Inserir título"><Heading2 /></Button>
        <Button size="sm" variant="ghost" onClick={() => inserir("**", "**", "negrito")} aria-label="Negrito"><Bold /></Button>
        <Button size="sm" variant="ghost" onClick={() => inserir("*", "*", "itálico")} aria-label="Itálico"><Italic /></Button>
        <Button size="sm" variant="ghost" onClick={() => inserir("\n- ", "", "item")} aria-label="Inserir lista"><List /></Button>
        <Button size="sm" variant="ghost" onClick={() => inserir("\n| Coluna | Coluna |\n| --- | --- |\n| ", " | |\n", "valor")} aria-label="Inserir tabela"><Table2 /></Button>
      </div>
        <Label htmlFor="doc-texto" className="sr-only">Conteúdo do documento</Label>
        <Textarea id="doc-texto" ref={editor} value={texto} onChange={(evento) => setTexto(evento.target.value)} spellCheck lang="pt-BR"
          placeholder={"# Título do documento\n\nEscreva aqui. Use **negrito**, *itálico*, listas com - e tabelas com |."}
          className="min-h-[420px] resize-y rounded-none border-0 font-mono text-sm shadow-none focus-visible:ring-0" />
      </Card>
      <Card><CardContent className="max-h-[520px] overflow-y-auto p-5"><p className="mb-3 text-xs font-medium uppercase tracking-wider text-drap-500">Prévia</p><PreviaMarkdown blocos={blocos} /></CardContent></Card>
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void gerarPdf()} disabled={gerando || !texto.trim()}>{gerando ? <LoaderCircle className="animate-spin" /> : <FileDown />}Gerar PDF</Button>
      <Button variant="outline" onClick={prepararTexto} disabled={!texto.trim()}><FilePlus2 />Salvar texto editável (.md)</Button>
      <span className="flex items-center gap-2"><Checkbox id="doc-numerar" checked={numerar} onCheckedChange={(valor) => setNumerar(valor === true)} /><Label htmlFor="doc-numerar">Numerar páginas</Label></span>
      {origem ? <span className="text-xs text-drap-500">Aberto de “{origem.nome}”. Guardar cria uma cópia nova.</span> : null}
    </div>
    {erro ? <p className="text-sm text-red-700" role="alert">{erro}</p> : null}
    {resultado ? <PainelResultado key={resultado.chave} saidas={resultado.saidas} origem={origem} conversao={resultado.conversao} canEdit={canEdit} projects={projects} aviso="Fonte padrão do PDF; emojis e símbolos raros saem como ?" /> : null}
  </div>;
}
