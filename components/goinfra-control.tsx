"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CircleAlert, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { REGIMES_GOINFRA, TABELAS_GOINFRA, rotuloRegimeGoinfra, rotuloTabelaGoinfra } from "@/lib/integrations/goinfra-planilha";

type Tabela = { id: string; referencia: string; label: string; arquivo: string; sha256: string; bytes: number; aba: string; totalItens: number; ignoradas: number; importadoPor: string; importadoEm: number };

// Referência GOINFRA para a plataforma inteira. A agência publica a tabela no site, sem
// API; o superadministrador baixa a planilha oficial e envia aqui. Compras usa os itens
// como catálogo de produtos e como preço de referência no comparativo.
export function GoinfraControl() {
  const [tabelas, setTabelas] = useState<Tabela[] | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mesPassado] = useState(() => new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 7));

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const resposta = await fetch("/api/superadmin/goinfra", { cache: "no-store" });
      const corpo = await resposta.json() as { tables?: Tabela[]; error?: string };
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível ler a referência GOINFRA.");
      setTabelas(corpo.tables ?? []);
    } catch (causa) { setErro(causa instanceof Error ? causa.message : "Não foi possível ler a referência GOINFRA."); }
  }, []);
  useEffect(() => { const t = window.setTimeout(() => { void carregar(); }, 0); return () => window.clearTimeout(t); }, [carregar]);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando) return;
    const formulario = event.currentTarget;
    setEnviando(true);
    try {
      const resposta = await fetch("/api/superadmin/goinfra", { method: "PUT", body: new FormData(formulario) });
      const corpo = await resposta.json() as { error?: string; details?: { formErrors?: string[] }; tables?: Tabela[]; repeated?: boolean; report?: { itens: number; ignoradas: number; aba: string; linhaDoCabecalho: number } };
      if (!resposta.ok) throw new Error(corpo.details?.formErrors?.join(" ") || corpo.error || "A importação falhou.");
      setTabelas(corpo.tables ?? []);
      toast.success(corpo.repeated ? "Este arquivo já é a referência ativa" : `${corpo.report?.itens.toLocaleString("pt-BR")} itens importados`, { description: corpo.report ? `Aba “${corpo.report.aba}”, cabeçalho na linha ${corpo.report.linhaDoCabecalho}, ${corpo.report.ignoradas} linhas de título ou total ignoradas.` : undefined });
      formulario.reset();
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "A importação falhou."); }
    finally { setEnviando(false); }
  }

  return <Card className="mt-6 workspace-card">
    <CardHeader className="border-b bg-white"><CardTitle className="flex items-center gap-2 text-lg"><FileSpreadsheet className="size-5 text-drap-600" />Referência GOINFRA</CardTitle><p className="text-sm text-drap-500">Tabela de preços da Agência Goiana de Infraestrutura e Transportes. Baixe a planilha oficial no site da GOINFRA e envie em XLSX ou CSV. As colunas são achadas pelo nome do cabeçalho (código, descrição, unidade e preço); uma tabela ativa por tipo e regime.</p></CardHeader>
    <CardContent className="grid gap-6 p-5 xl:grid-cols-2">
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">Tabela<NativeSelect name="tabela" className="mt-1 w-full">{TABELAS_GOINFRA.map((t) => <NativeSelectOption key={t} value={t}>{rotuloTabelaGoinfra[t]}</NativeSelectOption>)}</NativeSelect></label>
          <label className="text-sm font-medium">Regime<NativeSelect name="regime" className="mt-1 w-full">{REGIMES_GOINFRA.map((r) => <NativeSelectOption key={r} value={r}>{rotuloRegimeGoinfra[r]}</NativeSelectOption>)}</NativeSelect></label>
          <label className="text-sm font-medium">Referência<Input name="referencia" type="month" required defaultValue={mesPassado} className="mt-1" /></label>
        </div>
        <label className="block text-sm font-medium">Planilha oficial<Input name="arquivo" type="file" required accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="mt-1" /></label>
        <Button type="submit" disabled={enviando}>{enviando ? <LoaderCircle className="animate-spin" /> : <Upload />}Importar tabela</Button>
      </form>
      <div className="min-w-0">
        {erro ? <p role="alert" className="flex items-center gap-2 text-sm text-drap-700"><CircleAlert className="size-4" />{erro}</p>
          : tabelas === null ? <p className="text-sm text-drap-500"><LoaderCircle className="mr-2 inline size-4 animate-spin" />Carregando…</p>
          : !tabelas.length ? <p className="text-sm text-drap-600">Nenhuma tabela GOINFRA ativa. Enquanto não houver, a busca de Compras avisa que a referência não foi importada.</p>
          : <ul className="divide-y divide-drap-100 rounded-md border border-drap-200">{tabelas.map((t) => <li key={t.id} className="p-3 text-sm">
            <p className="font-medium text-drap-900">{t.label} · {t.referencia.slice(5)}/{t.referencia.slice(0, 4)}</p>
            <p className="mt-0.5 text-xs text-drap-500">{t.totalItens.toLocaleString("pt-BR")} itens · {t.ignoradas} linhas ignoradas · aba “{t.aba}” · {t.arquivo} ({Math.max(1, Math.round(t.bytes / 1024)).toLocaleString("pt-BR")} KB)</p>
            <p className="mt-0.5 break-all text-xs text-drap-500">SHA-256 {t.sha256.slice(0, 16)}… · por {t.importadoPor} em {new Date(t.importadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
          </li>)}</ul>}
      </div>
    </CardContent>
  </Card>;
}
