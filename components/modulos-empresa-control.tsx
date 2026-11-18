"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ferramentasDoModulo, modulosContrataveis, modulosEssenciais } from "@/lib/empresa-config";
import { permissionModuleLabels, type PermissionModule } from "@/lib/permissions";

type Estado = { enabled: PermissionModule[]; revision: number; updatedBy: string | null; updatedAt: number | null };

/**
 * Módulos que a empresa contratou. O superadministrador liga e desliga; a empresa inteira
 * — contratante incluído — só enxerga e usa o que estiver ligado. Desligar não apaga dado
 * nenhum: religar devolve tudo como estava.
 */
export function ModulosEmpresaControl({ organizationId, name }: { organizationId: string; name: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [marcados, setMarcados] = useState<Set<PermissionModule>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const url = `/api/superadmin/organizations/${organizationId}/modulos`;

  const carregar = useCallback(async () => {
    setErro("");
    const resposta = await fetch(url, { cache: "no-store" });
    const corpo = await resposta.json().catch(() => ({})) as Estado & { error?: string };
    if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível ler os módulos da empresa.");
    setEstado(corpo); setMarcados(new Set(corpo.enabled));
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
        body: JSON.stringify({ enabled: [...marcados], revision: estado.revision }),
      });
      const corpo = await resposta.json().catch(() => ({})) as { error?: string };
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível salvar os módulos.");
      await carregar();
      setAviso("Módulos salvos. A mudança vale na próxima tela que cada pessoa abrir.");
    } catch (causa) { setErro(causa instanceof Error ? causa.message : "Não foi possível salvar os módulos."); }
    finally { setSalvando(false); }
  }

  const alterado = estado ? modulosContrataveis.some((modulo) => marcados.has(modulo) !== estado.enabled.includes(modulo)) : false;

  return <Card>
    <CardHeader><CardTitle>Módulos contratados</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-drap-600">{name} e toda a equipe dela só veem e usam os módulos ligados aqui. Desligar esconde o módulo e bloqueia a API; os dados ficam guardados e voltam ao religar.</p>
      {!estado ? <p role="status" className="text-sm">{erro || <LoaderCircle className="size-5 animate-spin text-drap-600" aria-label="Carregando módulos" />}</p> : <>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {modulosEssenciais.map((modulo) => <div key={modulo} className="flex items-start gap-3 rounded-md border border-drap-200 bg-drap-50 p-3 text-sm">
            <Checkbox checked disabled aria-label={`${permissionModuleLabels[modulo]} (sempre ligado)`} className="mt-0.5" />
            <span><span className="font-medium">{permissionModuleLabels[modulo]}</span><span className="block text-xs text-drap-500">Sempre ligado · {ferramentasDoModulo[modulo]}</span></span>
          </div>)}
          {modulosContrataveis.map((modulo) => <label key={modulo} className="flex cursor-pointer items-start gap-3 rounded-md border border-drap-200 p-3 text-sm">
            <Checkbox className="mt-0.5" checked={marcados.has(modulo)} onCheckedChange={(valor) => setMarcados((atual) => {
              const proximo = new Set(atual); if (valor === true) proximo.add(modulo); else proximo.delete(modulo); return proximo;
            })} />
            <span><span className="font-medium">{permissionModuleLabels[modulo]}</span><span className="block text-xs text-drap-500">{ferramentasDoModulo[modulo]}</span></span>
          </label>)}
        </div>
        {erro ? <p role="alert" className="rounded-md bg-drap-50 p-3 text-sm text-drap-danger">{erro}</p> : null}
        {aviso ? <p role="status" className="rounded-md bg-drap-50 p-3 text-sm text-drap-800">{aviso}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!alterado || salvando} onClick={() => void salvar()}>{salvando ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar módulos</Button>
          <Button variant="outline" disabled={salvando} onClick={() => setMarcados(new Set(modulosContrataveis))}>Ligar todos</Button>
          {estado.updatedAt ? <span className="text-xs text-drap-500">Última alteração em {new Date(estado.updatedAt).toLocaleString("pt-BR")} por {estado.updatedBy}</span> : <span className="text-xs text-drap-500">Ainda sem escolha: todos os módulos estão ligados.</span>}
        </div>
      </>}
    </CardContent>
  </Card>;
}
