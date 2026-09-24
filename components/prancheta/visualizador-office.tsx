"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PropsVisualizador } from "@/components/prancheta/tipos";
import { decodificarTexto } from "@/components/prancheta/visualizador-midia";

/**
 * Tira do HTML gerado tudo que poderia agir: script, quadro embutido, atributo de evento e
 * endereço javascript:. O documento vem de fora da empresa com frequência — é o que um
 * cliente ou fornecedor manda.
 */
function limpar(raiz: HTMLElement) {
  raiz.querySelectorAll("script, iframe, object, embed, frame, frameset, meta, link, base, form").forEach((elemento) => elemento.remove());
  raiz.querySelectorAll("*").forEach((elemento) => {
    for (const atributo of [...elemento.attributes]) {
      const nome = atributo.name.toLowerCase();
      const valor = atributo.value.trim().toLowerCase();
      if (nome.startsWith("on")) elemento.removeAttribute(atributo.name);
      else if (["href", "src", "xlink:href", "action", "formaction"].includes(nome) && (valor.startsWith("javascript:") || valor.startsWith("vbscript:") || (valor.startsWith("data:") && !valor.startsWith("data:image/")))) elemento.removeAttribute(atributo.name);
    }
  });
}

export function VisualizadorDocx({ blob, nome }: PropsVisualizador) {
  const [html, setHtml] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { renderAsync } = await import("docx-preview");
      const corpo = document.createElement("div");
      await renderAsync(blob, corpo, corpo, {
        inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, renderHeaders: true, renderFooters: true,
        renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: true,
      });
      limpar(corpo);
      if (vivo) setHtml(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>body{margin:0;background:#eeece6}.docx-wrapper{background:#eeece6!important;padding:16px!important}</style></head><body>${corpo.innerHTML}</body></html>`);
    })().catch(() => { if (vivo) setErro("O documento não pôde ser lido. Pode estar corrompido ou protegido por senha."); });
    return () => { vivo = false; };
  }, [blob]);

  if (erro) return <p className="p-6 text-center text-sm text-hoikos-700" role="alert">{erro}</p>;
  if (html === null) return <p className="flex items-center justify-center gap-2 p-6 text-sm" role="status"><LoaderCircle className="animate-spin" />Abrindo o documento…</p>;
  // sandbox vazio: sem script, sem acesso à página, sem navegar para fora.
  return <iframe title={nome} sandbox="" srcDoc={html} className="min-h-[480px] w-full flex-1 border-0 bg-hoikos-100" />;
}

type Aba = { nome: string; linhas: string[][]; totalLinhas: number; totalColunas: number };
const MAX_LINHAS = 1000, MAX_COLUNAS = 60;

function csvParaLinhas(texto: string) {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const separador = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ";" : primeira.includes("\t") ? "\t" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i += 1; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === separador) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i += 1;
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

export function VisualizadorPlanilha({ blob, extensao }: PropsVisualizador) {
  const [abas, setAbas] = useState<Aba[] | null>(null);
  const [ativa, setAtiva] = useState(0);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (extensao === "csv") {
        const linhas = csvParaLinhas(decodificarTexto(new Uint8Array(await blob.arrayBuffer())));
        return [{ nome: "CSV", linhas: linhas.slice(0, MAX_LINHAS).map((l) => l.slice(0, MAX_COLUNAS)), totalLinhas: linhas.length, totalColunas: Math.max(0, ...linhas.map((l) => l.length)) }];
      }
      const ExcelJS = (await import("exceljs")).default;
      const livro = new ExcelJS.Workbook();
      await livro.xlsx.load(await blob.arrayBuffer());
      return livro.worksheets.map((folha) => {
        const linhas: string[][] = [];
        const colunas = Math.min(folha.columnCount, MAX_COLUNAS);
        for (let r = 1; r <= Math.min(folha.rowCount, MAX_LINHAS); r += 1) {
          const linha = folha.getRow(r);
          linhas.push(Array.from({ length: colunas }, (_, c) => { try { return linha.getCell(c + 1).text ?? ""; } catch { return ""; } }));
        }
        return { nome: folha.name, linhas, totalLinhas: folha.rowCount, totalColunas: folha.columnCount };
      });
    })().then((resultado) => { if (vivo) setAbas(resultado); })
      .catch(() => { if (vivo) setErro("A planilha não pôde ser lida. Pode estar corrompida, protegida por senha ou em formato antigo (.xls)."); });
    return () => { vivo = false; };
  }, [blob, extensao]);

  if (erro) return <p className="p-6 text-center text-sm text-hoikos-700" role="alert">{erro}</p>;
  if (!abas) return <p className="flex items-center justify-center gap-2 p-6 text-sm" role="status"><LoaderCircle className="animate-spin" />Abrindo a planilha…</p>;
  const aba = abas[ativa];
  if (!aba) return <p className="p-6 text-center text-sm">A planilha não tem abas.</p>;
  const letra = (n: number) => { let s = ""; n += 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  return <div className="flex h-full min-h-0 flex-col">
    {abas.length > 1 ? <div className="flex gap-1 overflow-x-auto border-b border-hoikos-200 bg-white p-2" role="tablist">{abas.map((item, indice) => <Button key={item.nome + indice} size="sm" role="tab" aria-selected={indice === ativa} variant={indice === ativa ? "default" : "outline"} onClick={() => setAtiva(indice)}>{item.nome}</Button>)}</div> : null}
    {aba.totalLinhas > MAX_LINHAS || aba.totalColunas > MAX_COLUNAS ? <p className="border-b bg-hoikos-50 px-3 py-2 text-xs text-hoikos-600">Mostrando até {MAX_LINHAS} linhas e {MAX_COLUNAS} colunas de {aba.totalLinhas} × {aba.totalColunas}. Baixe o arquivo para ver tudo, ou importe na aba Planilha.</p> : null}
    <div className="min-h-[360px] flex-1 overflow-auto bg-white">
      <table className="border-collapse text-xs">
        <thead className="sticky top-0 bg-hoikos-100"><tr><th className="border px-2 py-1" />{(aba.linhas[0] ?? []).map((_, c) => <th key={c} scope="col" className="border px-2 py-1 font-medium">{letra(c)}</th>)}</tr></thead>
        <tbody>{aba.linhas.map((linha, r) => <tr key={r}><th scope="row" className="border bg-hoikos-50 px-2 py-1 text-right font-medium">{r + 1}</th>{linha.map((valor, c) => <td key={c} className="max-w-[24rem] truncate border px-2 py-1" title={valor}>{valor}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </div>;
}
