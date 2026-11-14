"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CircleAlert, FileSpreadsheet, LoaderCircle, RefreshCw, Upload } from "lucide-react";
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
type Busca = {
  configurada: boolean; agendada: boolean; ultimaVerificacao: number | null; erro: string | null;
  resultado: { paginas: number; arquivosEncontrados: number; xlsIgnorados: number; tabelas: { tabela: string; regime: string; referencia: string; arquivo: string; situacao: "importada" | "atual" | "falhou"; itens?: number; abas?: number; erro?: string }[] } | null;
};
const situacaoTexto = { importada: "importada agora", atual: "já é a ativa", falhou: "falhou" };

export function GoinfraControl() {
  const [tabelas, setTabelas] = useState<Tabela[] | null>(null);
  const [busca, setBusca] = useState<Busca | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mesPassado] = useState(() => new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 7));

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const resposta = await fetch("/api/superadmin/goinfra", { cache: "no-store" });
      const corpo = await resposta.json() as { tables?: Tabela[]; sync?: Busca; error?: string };
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível ler a referência GOINFRA.");
      setTabelas(corpo.tables ?? []);
      setBusca(corpo.sync ?? null);
    } catch (causa) { setErro(causa instanceof Error ? causa.message : "Não foi possível ler a referência GOINFRA."); }
  }, []);
  useEffect(() => { const t = window.setTimeout(() => { void carregar(); }, 0); return () => window.clearTimeout(t); }, [carregar]);

  async function buscarAgora() {
    if (buscando) return;
    setBuscando(true);
    try {
      const resposta = await fetch("/api/superadmin/goinfra", { method: "POST" });
      const corpo = await resposta.json() as { error?: string; tables?: Tabela[]; sync?: Busca };
      if (corpo.tables) setTabelas(corpo.tables);
      if (corpo.sync) setBusca(corpo.sync);
      if (!resposta.ok) throw new Error(corpo.error ?? "A busca falhou.");
      const r = corpo.sync?.resultado;
      const importadas = r?.tabelas.filter((t) => t.situacao === "importada").length ?? 0;
      if (corpo.sync?.erro) toast.error(corpo.sync.erro);
      else toast.success(importadas ? `${importadas} tabela(s) atualizada(s)` : "Todas as tabelas já estão na referência mais nova");
    } catch (causa) {
      toast.error(causa instanceof Error ? causa.message : "A busca falhou.");
      void carregar();
    } finally { setBuscando(false); }
  }

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
      toast.success(corpo.repeated ? "Este arquivo já é a referência ativa" : `${corpo.report?.itens.toLocaleString("pt-BR")} itens importados`, { description: corpo.report ? `Abas lidas: ${corpo.report.aba}. ${corpo.report.ignoradas} linhas de título, total ou repetidas ignoradas.` : undefined });
      formulario.reset();
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "A importação falhou."); }
    finally { setEnviando(false); }
  }

  return <Card className="mt-6 workspace-card">
    <CardHeader className="border-b bg-white"><CardTitle className="flex items-center gap-2 text-lg"><FileSpreadsheet className="size-5 text-drap-600" />Referência GOINFRA</CardTitle><p className="text-sm text-drap-500">Tabela de preços da Agência Goiana de Infraestrutura e Transportes. A busca automática confere o portal da GOINFRA todo dia e importa a referência mais nova de cada tabela; o envio manual continua disponível. Todas as abas da planilha são lidas e as colunas são achadas pelo nome do cabeçalho; uma tabela ativa por tipo e regime.</p></CardHeader>
    <CardContent className="grid gap-6 p-5 xl:grid-cols-3">
      <section aria-labelledby="goinfra-busca" className="space-y-3">
        <h3 id="goinfra-busca" className="text-sm font-semibold text-drap-900">Busca automática</h3>
        {busca === null ? <p className="text-sm text-drap-500">Carregando…</p> : <>
          <p className="text-sm text-drap-600">
            {!busca.configurada ? "Desligada: falta GOINFRA_INDICE_URL com a página de tabelas do portal."
              : !busca.agendada ? "Sem agendamento: falta CRON_SECRET. Use “Buscar agora”."
              : "Ligada: todo dia às 7h43 (Brasília)."}
          </p>
          <p className="text-xs text-drap-500">Última verificação: {busca.ultimaVerificacao ? new Date(busca.ultimaVerificacao).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca"}
            {busca.resultado ? ` · ${busca.resultado.paginas} página(s), ${busca.resultado.arquivosEncontrados} planilha(s) reconhecida(s)` : ""}</p>
          {busca.erro ? <p role="alert" className="flex items-start gap-2 text-sm text-drap-700"><CircleAlert className="mt-0.5 size-4 shrink-0" />{busca.erro}</p> : null}
          {busca.resultado?.tabelas.length ? <ul className="space-y-1 text-xs text-drap-600">{busca.resultado.tabelas.map((t) => <li key={`${t.tabela}-${t.regime}`}>
            <span className="font-medium text-drap-800">{rotuloTabelaGoinfra[t.tabela as keyof typeof rotuloTabelaGoinfra] ?? t.tabela} · {rotuloRegimeGoinfra[t.regime as keyof typeof rotuloRegimeGoinfra] ?? t.regime}</span> {t.referencia.slice(5)}/{t.referencia.slice(0, 4)}: {situacaoTexto[t.situacao]}{t.itens ? ` (${t.itens.toLocaleString("pt-BR")} itens em ${t.abas} aba(s))` : ""}{t.erro ? ` — ${t.erro}` : ""}
          </li>)}</ul> : null}
          <Button type="button" variant="outline" disabled={buscando || !busca.configurada} onClick={() => void buscarAgora()}>{buscando ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Buscar agora</Button>
        </>}
      </section>
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
            <p className="mt-0.5 text-xs text-drap-500">{t.totalItens.toLocaleString("pt-BR")} itens · {t.ignoradas} linhas ignoradas · abas: {t.aba} · {t.arquivo} ({Math.max(1, Math.round(t.bytes / 1024)).toLocaleString("pt-BR")} KB)</p>
            <p className="mt-0.5 break-all text-xs text-drap-500">SHA-256 {t.sha256.slice(0, 16)}… · por {t.importadoPor} em {new Date(t.importadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
          </li>)}</ul>}
      </div>
    </CardContent>
  </Card>;
}
