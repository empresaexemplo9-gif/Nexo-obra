"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ferramentasDoMenu, secoesDoMenu, todasAsFerramentas, type Ferramenta } from "@/lib/empresa-config";

type Estado = { ferramentas: Ferramenta[]; revision: number; updatedBy: string | null; updatedAt: number | null };

/**
 * Cada item do menu lateral, ligado ou desligado para a empresa. A empresa inteira —
 * contratante incluído — só enxerga e usa o que estiver ligado. Desligar não apaga dado
 * nenhum: religar devolve tudo como estava. O superadmin continua vendo tudo.
 */
export function ModulosEmpresaControl({ organizationId, name }: { organizationId: string; name: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [marcadas, setMarcadas] = useState<Set<Ferramenta>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const url = `/api/superadmin/organizations/${organizationId}/modulos`;

  const carregar = useCallback(async () => {
    setErro("");
    const resposta = await fetch(url, { cache: "no-store" });
    const corpo = await resposta.json().catch(() => ({})) as Estado & { error?: string };
    if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível ler as ferramentas da empresa.");
    setEstado(corpo); setMarcadas(new Set(corpo.ferramentas));
  }, [url]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void carregar().catch((causa: Error) => setErro(causa.message)); }, 0);
    return () => window.clearTimeout(timer);
  }, [carregar]);

  async function salvar() {
    if (!estado) return;
    setSalvando(true); setErro(""); setAviso("");
    try {
      const resposta = await fetch(url, {
        method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ferramentas: todasAsFerramentas.filter((id) => marcadas.has(id)), revision: estado.revision }),
      });
      const corpo = await resposta.json().catch(() => ({})) as { error?: string };
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível salvar as ferramentas.");
      await carregar();
      setAviso("Ferramentas salvas. A mudança vale na próxima tela que cada pessoa da empresa abrir.");
    } catch (causa) { setErro(causa instanceof Error ? causa.message : "Não foi possível salvar as ferramentas."); }
    finally { setSalvando(false); }
  }

  const alternar = (id: Ferramenta, ligar: boolean) => setMarcadas((atual) => {
    const proximo = new Set(atual); if (ligar) proximo.add(id); else proximo.delete(id); return proximo;
  });
  const alterado = estado ? todasAsFerramentas.some((id) => marcadas.has(id) !== estado.ferramentas.includes(id)) : false;

  return <Card>
    <CardHeader><CardTitle>Menu da empresa</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-drap-600">Marque o que {name} contratou. Cada item é uma ferramenta do menu lateral: desmarcado, ele some do menu de todos os acessos da empresa e o servidor recusa o uso. Os dados ficam guardados e voltam ao religar. Você, como superadmin, continua vendo tudo.</p>
      {!estado ? <div role="status" className="text-sm">{erro || <LoaderCircle className="size-5 animate-spin text-drap-600" aria-label="Carregando ferramentas" />}</div> : <>
        <div className="grid gap-4 lg:grid-cols-3">
          {secoesDoMenu.map((secao) => {
            const itens = ferramentasDoMenu.filter((item) => item.secao === secao);
            const todas = itens.every((item) => marcadas.has(item.id));
            return <fieldset key={secao} className="space-y-2 rounded-md border border-drap-200 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-drap-600">{secao}</legend>
              <label className="flex cursor-pointer items-center gap-2 border-b border-drap-100 pb-2 text-xs text-drap-600">
                <Checkbox checked={todas} onCheckedChange={(valor) => itens.forEach((item) => alternar(item.id, valor === true))} />Marcar toda a seção
              </label>
              {itens.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={marcadas.has(item.id)} onCheckedChange={(valor) => alternar(item.id, valor === true)} />{item.rotulo}
              </label>)}
            </fieldset>;
          })}
        </div>
        {marcadas.size === 0 ? <p className="rounded-md bg-drap-50 p-3 text-sm text-drap-800">Nenhuma ferramenta marcada: as pessoas da empresa entram e não encontram nada para usar.</p> : null}
        {erro ? <p role="alert" className="rounded-md bg-drap-50 p-3 text-sm text-drap-danger">{erro}</p> : null}
        {aviso ? <p role="status" className="rounded-md bg-drap-50 p-3 text-sm text-drap-800">{aviso}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!alterado || salvando} onClick={() => void salvar()}>{salvando ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar menu da empresa</Button>
          <Button variant="outline" disabled={salvando} onClick={() => setMarcadas(new Set(todasAsFerramentas))}>Marcar tudo</Button>
          <Button variant="outline" disabled={salvando} onClick={() => setMarcadas(new Set())}>Desmarcar tudo</Button>
          {estado.updatedAt ? <span className="text-xs text-drap-500">Última alteração em {new Date(estado.updatedAt).toLocaleString("pt-BR")} por {estado.updatedBy}</span> : <span className="text-xs text-drap-500">Ainda sem escolha: tudo liberado.</span>}
        </div>
      </>}
    </CardContent>
  </Card>;
}
