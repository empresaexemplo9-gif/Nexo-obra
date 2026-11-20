"use client";
/* eslint-disable @next/next/no-img-element -- prévia local (blob:) e logotipo privado servido pela API */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, ImageUp, LoaderCircle, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { normalizarCor, paletaCompleta, type MarcaDaEmpresa } from "@/lib/empresa-config";
import { aplicarCoresNaPagina, prepararLogotipo, sugerirCores, tiposAceitos, type LogotipoPreparado } from "@/lib/marca-cliente";

export type MarcaDaSessao = MarcaDaEmpresa & { revision: number };

// Cores originais da plataforma, mostradas quando a empresa ainda não tem as suas.
const PADRAO = { menuColor: "#0d151f", accentColor: "#27557b", bandColor: "#204362" };
type Cores = typeof PADRAO;
const campos: { chave: keyof Cores; rotulo: string; uso: string }[] = [
  { chave: "accentColor", rotulo: "Cor principal", uso: "Botões, links e destaques" },
  { chave: "menuColor", rotulo: "Cor do menu", uso: "Menu lateral e telas escuras" },
  { chave: "bandColor", rotulo: "Cor da faixa", uso: "Faixa de destaque e títulos pequenos" },
];
const tons: { variavel: string; rotulo: string }[] = [
  { variavel: "--drap-deep", rotulo: "Menu" }, { variavel: "--drap-band", rotulo: "Faixa" }, { variavel: "--drap-accent", rotulo: "Ação" },
  { variavel: "--drap-support", rotulo: "Texto secundário" }, { variavel: "--drap-graphite", rotulo: "Grafite" }, { variavel: "--drap-mist", rotulo: "Névoa" },
  { variavel: "--drap-fog", rotulo: "Neblina" }, { variavel: "--drap-stone", rotulo: "Fundo" }, { variavel: "--drap-paper", rotulo: "Cartões" },
  { variavel: "--drap-ink", rotulo: "Texto" },
];

function coresIniciais(marca: MarcaDaSessao | undefined): Cores {
  return {
    menuColor: marca?.menuColor ?? PADRAO.menuColor,
    accentColor: marca?.accentColor ?? PADRAO.accentColor,
    bandColor: marca?.bandColor ?? PADRAO.bandColor,
  };
}

/**
 * Identidade visual de uma empresa. Enviar o logotipo já basta: as cores dele viram a
 * paleta inteira da plataforma e ficam gravadas na hora. As três cores ficam abertas para
 * ajuste fino depois.
 *
 * `endpoint` e `logoBase` apontam para a empresa da sessão (tela da própria empresa) ou
 * para uma empresa escolhida no painel do superadmin. `previaNaPagina` pinta a página
 * enquanto se escolhe — no painel do superadmin fica desligado, a prévia é só no cartão.
 */
export function IdentidadeVisual({
  marca, empresa, onSaved,
  endpoint = "/api/organization/branding", logoBase = "/api/organization/branding/logo", previaNaPagina = true,
}: {
  marca: MarcaDaSessao | undefined; empresa: string; onSaved: () => Promise<void>;
  endpoint?: string; logoBase?: string; previaNaPagina?: boolean;
}) {
  const [cores, setCores] = useState<Cores>(() => coresIniciais(marca));
  const [logoNovo, setLogoNovo] = useState<LogotipoPreparado | null>(null);
  const [removerLogo, setRemoverLogo] = useState(false);
  const [paleta, setPaleta] = useState<string[]>([]);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const entrada = useRef<HTMLInputElement>(null);

  // Prévia ao vivo na própria página; ao sair sem salvar, volta ao que está gravado.
  useEffect(() => { if (previaNaPagina) aplicarCoresNaPagina(cores); }, [cores, previaNaPagina]);
  useEffect(() => () => { if (previaNaPagina) aplicarCoresNaPagina(marca); }, [marca, previaNaPagina]);
  useEffect(() => () => { if (logoNovo?.previewUrl) URL.revokeObjectURL(logoNovo.previewUrl); }, [logoNovo]);

  async function gravar(corpo: Record<string, unknown>, sucesso: string) {
    setSalvando(true); setErro("");
    try {
      const resposta = await fetch(endpoint, {
        method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...corpo, revision: marca?.revision ?? 0 }),
      });
      const retorno = await resposta.json().catch(() => ({})) as { error?: string; adjusted?: string[] };
      if (!resposta.ok) throw new Error(retorno.error ?? "Não foi possível salvar a identidade visual.");
      toast.success(sucesso, {
        description: retorno.adjusted?.length ? "Algumas cores foram escurecidas para o texto branco continuar legível." : "Toda a equipe da empresa passa a ver a nova aparência.",
      });
      await onSaved();
      return true;
    } catch (causa) {
      // Erro de rede não salva nada em silêncio: a prévia continua e o botão também.
      setErro(causa instanceof Error ? causa.message : "Não foi possível salvar a identidade visual.");
      return false;
    } finally { setSalvando(false); }
  }

  async function escolherArquivo(event: ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo) return;
    setLendo(true); setErro("");
    let preparado: LogotipoPreparado;
    try { preparado = await prepararLogotipo(arquivo); }
    catch (causa) { setErro(causa instanceof Error ? causa.message : "Não foi possível ler o arquivo."); setLendo(false); return; }
    setLendo(false);
    setLogoNovo(preparado); setRemoverLogo(false); setPaleta(preparado.paleta);
    // Automático: as cores da marca viram a paleta e tudo é gravado de uma vez.
    const sugestao = sugerirCores(preparado.paleta) ?? cores;
    setCores(sugestao);
    await gravar({ ...sugestao, logo: { mime: preparado.mime, base64: preparado.base64 } }, "Logotipo aplicado e paleta da marca implantada");
  }

  const logoAtual = removerLogo ? null : logoNovo?.previewUrl ?? (marca?.hasLogo ? `${logoBase}?v=${marca.logoVersion}` : null);
  const alterado = removerLogo || (Object.keys(cores) as (keyof Cores)[]).some((chave) => cores[chave] !== coresIniciais(marca)[chave]);
  const completa = paletaCompleta(cores);
  const tom = (variavel: string) => completa[variavel];

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
    <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-1">
      <Card>
        <CardHeader><CardTitle>Logotipo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-drap-500">Envie a marca em PNG, JPEG, WebP, SVG ou o PDF do manual da marca. As cores do logotipo viram a paleta inteira da plataforma, gravada na hora.</p>
          <div className="grid min-h-28 place-items-center rounded-md border border-dashed border-drap-200 bg-white p-4">
            {lendo ? <LoaderCircle className="size-6 animate-spin text-drap-600" aria-label="Lendo arquivo" />
              : logoAtual ? <img src={logoAtual} alt={`Logotipo de ${empresa}`} className="max-h-24 w-auto max-w-full object-contain" />
                : <p className="text-sm text-drap-500">Nenhum logotipo enviado. O menu mostra a marca da plataforma.</p>}
          </div>
          <input ref={entrada} type="file" accept={tiposAceitos} className="sr-only" aria-label="Arquivo do logotipo" onChange={(event) => void escolherArquivo(event)} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={lendo || salvando} onClick={() => entrada.current?.click()}>{lendo || salvando ? <LoaderCircle className="animate-spin" /> : <ImageUp />}{logoAtual ? "Trocar logotipo" : "Enviar logotipo"}</Button>
            {logoAtual ? <Button type="button" variant="outline" disabled={lendo || salvando} onClick={() => { setRemoverLogo(true); setLogoNovo(null); setPaleta([]); }}><Trash2 />Remover</Button> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ajuste fino das cores</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {paleta.length > 0 && <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-drap-700"><Wand2 className="size-4" />Cores encontradas no logotipo</p>
            <div className="flex flex-wrap gap-2">{paleta.map((cor) => <button key={cor} type="button" aria-label={`Usar ${cor} como cor principal`} title={`Usar ${cor} como cor principal`}
              onClick={() => setCores((atual) => ({ ...atual, accentColor: cor }))} className="size-9 rounded-md border border-drap-200 focus-visible:ring-2 focus-visible:ring-drap-500" style={{ background: cor }} />)}</div>
          </div>}
          <div className="grid gap-3 sm:grid-cols-3">{campos.map((campo) => <div key={campo.chave} className="space-y-1.5">
            <label htmlFor={`cor-${campo.chave}`} className="block text-sm font-medium text-drap-700">{campo.rotulo}</label>
            <div className="flex items-center gap-2">
              <input id={`cor-${campo.chave}`} type="color" value={cores[campo.chave]} onChange={(event) => setCores((atual) => ({ ...atual, [campo.chave]: event.target.value }))} className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-drap-200 bg-white p-1" />
              <Input aria-label={`${campo.rotulo} em hexadecimal`} defaultValue={cores[campo.chave]} key={cores[campo.chave]} maxLength={7}
                onBlur={(event) => { const cor = normalizarCor(event.target.value); if (cor) setCores((atual) => ({ ...atual, [campo.chave]: cor })); }} className="font-mono text-xs" />
            </div>
            <p className="text-xs text-drap-500">{campo.uso}</p>
          </div>)}</div>
          <p className="text-xs text-drap-500">Fundo, cartões, bordas, cinzas e texto saem destas três, na mesma família de tons. Cor clara demais é escurecida ao salvar, para o texto continuar legível.</p>
          {erro ? <p role="alert" className="rounded-md border border-drap-danger/40 bg-drap-paper p-3 text-sm text-drap-danger">{erro}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!alterado || salvando || lendo} onClick={() => void gravar({ ...cores, ...(removerLogo ? { logo: null } : {}) }, "Identidade visual salva").then((ok) => { if (ok) setRemoverLogo(false); })}>{salvando ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar ajustes</Button>
            <Button type="button" variant="outline" disabled={salvando} onClick={() => { setCores(coresIniciais(marca)); setRemoverLogo(false); setPaleta([]); setErro(""); }}><RotateCcw />Descartar</Button>
            <Button type="button" variant="ghost" disabled={salvando} onClick={() => setCores(PADRAO)}>Cores da plataforma</Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <Card className="h-fit">
      <CardHeader><CardTitle>Como a equipe vai ver</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[minmax(0,9rem)_1fr] overflow-hidden rounded-md border" style={{ borderColor: tom("--drap-mist") }} aria-hidden="true">
          <div className="space-y-2 p-3" style={{ background: tom("--drap-deep") }}>
            <div className="grid h-12 place-items-center rounded bg-white p-1.5">{logoAtual ? <img src={logoAtual} alt="" className="max-h-9 w-auto max-w-full object-contain" /> : <span className="text-[10px] font-semibold" style={{ color: tom("--drap-ink") }}>{empresa}</span>}</div>
            {["Visão geral", "Projetos", "Obras"].map((item, indice) => <div key={item} className="rounded px-2 py-1.5 text-xs text-white" style={indice === 1 ? { background: tom("--sidebar-accent") } : undefined}>{item}</div>)}
          </div>
          <div className="space-y-3 p-3" style={{ background: tom("--drap-stone") }}>
            <div className="rounded px-3 py-3 text-xs font-medium text-white" style={{ background: tom("--drap-band") }}>Cada projeto, um próximo passo.</div>
            <div className="rounded border p-3 text-xs" style={{ background: tom("--drap-paper"), borderColor: tom("--drap-mist"), color: tom("--drap-ink") }}>Casa Alfa<span className="block" style={{ color: tom("--drap-support") }}>ARQ-1 · 62%</span><div className="mt-2 h-1.5 rounded" style={{ background: tom("--drap-mist") }}><div className="h-1.5 w-3/5 rounded" style={{ background: tom("--drap-accent") }} /></div></div>
            <span className="inline-block rounded px-3 py-1.5 text-xs font-medium text-white" style={{ background: tom("--drap-accent") }}>Novo projeto</span>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-drap-700">Paleta implantada</p>
          <div className="grid grid-cols-5 gap-2">{tons.map((item) => <div key={item.variavel} className="space-y-1">
            <div className="h-8 rounded border border-drap-200" style={{ background: tom(item.variavel) }} />
            <p className="truncate text-[11px] text-drap-500" title={`${item.rotulo} ${tom(item.variavel)}`}>{item.rotulo}</p>
          </div>)}</div>
        </div>
      </CardContent>
    </Card>
  </div>;
}
