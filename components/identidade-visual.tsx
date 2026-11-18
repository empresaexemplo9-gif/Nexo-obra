"use client";
/* eslint-disable @next/next/no-img-element -- prévia local (blob:) e logotipo privado servido pela API */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, ImageUp, LoaderCircle, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { normalizarCor, type MarcaDaEmpresa } from "@/lib/empresa-config";
import { aplicarCoresNaPagina, prepararLogotipo, sugerirCores, tiposAceitos, type LogotipoPreparado } from "@/lib/marca-cliente";

export type MarcaDaSessao = MarcaDaEmpresa & { revision: number };

// Cores originais da plataforma, mostradas quando a empresa ainda não escolheu as suas.
const PADRAO = { menuColor: "#0d151f", accentColor: "#27557b", bandColor: "#204362" };
type Cores = typeof PADRAO;
const campos: { chave: keyof Cores; rotulo: string; uso: string }[] = [
  { chave: "accentColor", rotulo: "Cor principal", uso: "Botões, links e destaques" },
  { chave: "menuColor", rotulo: "Cor do menu", uso: "Menu lateral e telas de entrada" },
  { chave: "bandColor", rotulo: "Cor da faixa", uso: "Faixa de destaque e títulos pequenos" },
];

function coresIniciais(marca: MarcaDaSessao | undefined): Cores {
  return {
    menuColor: marca?.menuColor ?? PADRAO.menuColor,
    accentColor: marca?.accentColor ?? PADRAO.accentColor,
    bandColor: marca?.bandColor ?? PADRAO.bandColor,
  };
}

export function IdentidadeVisual({ marca, empresa, onSaved }: { marca: MarcaDaSessao | undefined; empresa: string; onSaved: () => Promise<void> }) {
  const [cores, setCores] = useState<Cores>(() => coresIniciais(marca));
  // undefined: manter o atual; null: remover; objeto: novo logotipo.
  const [logo, setLogo] = useState<LogotipoPreparado | null | undefined>(undefined);
  const [paleta, setPaleta] = useState<string[]>([]);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const entrada = useRef<HTMLInputElement>(null);

  // Prévia ao vivo: a própria página muda enquanto a pessoa escolhe. Ao sair sem salvar,
  // volta ao que está gravado.
  useEffect(() => { aplicarCoresNaPagina(cores); }, [cores]);
  useEffect(() => () => aplicarCoresNaPagina(marca), [marca]);
  useEffect(() => () => { if (logo?.previewUrl) URL.revokeObjectURL(logo.previewUrl); }, [logo]);

  async function escolherArquivo(event: ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo) return;
    setLendo(true); setErro("");
    try {
      const preparado = await prepararLogotipo(arquivo);
      setLogo(preparado);
      setPaleta(preparado.paleta);
      const sugestao = sugerirCores(preparado.paleta);
      if (sugestao) { setCores(sugestao); toast.success("Cores sugeridas a partir do logotipo", { description: "Ajuste à vontade antes de salvar." }); }
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : "Não foi possível ler o arquivo.");
    } finally { setLendo(false); }
  }

  async function salvar() {
    setSalvando(true); setErro("");
    try {
      const resposta = await fetch("/api/organization/branding", {
        method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cores,
          ...(logo === undefined ? {} : { logo: logo ? { mime: logo.mime, base64: logo.base64 } : null }),
          revision: marca?.revision ?? 0,
        }),
      });
      const corpo = await resposta.json().catch(() => ({})) as { error?: string; adjusted?: string[] };
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível salvar a identidade visual.");
      toast.success("Identidade visual salva", {
        description: corpo.adjusted?.length ? "Algumas cores foram escurecidas para o texto branco continuar legível." : "Toda a equipe passa a ver a nova aparência.",
      });
      setLogo(undefined);
      await onSaved();
    } catch (causa) {
      // Erro de rede não salva nada em silêncio: a prévia continua e o botão também.
      setErro(causa instanceof Error ? causa.message : "Não foi possível salvar a identidade visual.");
    } finally { setSalvando(false); }
  }

  const logoAtual = logo === null ? null : logo?.previewUrl ?? (marca?.hasLogo ? `/api/organization/branding/logo?v=${marca.logoVersion}` : null);
  const alterado = logo !== undefined || (Object.keys(cores) as (keyof Cores)[]).some((chave) => cores[chave] !== coresIniciais(marca)[chave]);

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
    <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-1">
      <Card>
        <CardHeader><CardTitle>Logotipo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-drap-500">Envie a marca em PNG, JPEG, WebP, SVG ou o PDF do manual da marca. A primeira página do PDF vira imagem e as margens brancas são cortadas.</p>
          <div className="grid min-h-28 place-items-center rounded-md border border-dashed border-drap-200 bg-white p-4">
            {lendo ? <LoaderCircle className="size-6 animate-spin text-drap-600" aria-label="Lendo arquivo" />
              : logoAtual ? <img src={logoAtual} alt={`Logotipo de ${empresa}`} className="max-h-24 w-auto max-w-full object-contain" />
                : <p className="text-sm text-drap-500">Nenhum logotipo enviado. O menu mostra a marca da plataforma.</p>}
          </div>
          <input ref={entrada} id="logotipo-arquivo" type="file" accept={tiposAceitos} className="sr-only" onChange={(event) => void escolherArquivo(event)} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={lendo || salvando} onClick={() => entrada.current?.click()}><ImageUp />{logoAtual ? "Trocar logotipo" : "Enviar logotipo"}</Button>
            {logoAtual ? <Button type="button" variant="outline" disabled={lendo || salvando} onClick={() => { setLogo(null); setPaleta([]); }}><Trash2 />Remover</Button> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cores</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {paleta.length > 0 && <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-drap-700"><Wand2 className="size-4" />Cores encontradas no logotipo</p>
            <div className="flex flex-wrap gap-2">{paleta.map((cor) => <button key={cor} type="button" aria-label={`Usar ${cor} como cor principal`} title={`Usar ${cor} como cor principal`}
              onClick={() => setCores((atual) => ({ ...atual, accentColor: cor }))} className="size-9 rounded-md border border-drap-200 focus-visible:ring-2 focus-visible:ring-drap-500" style={{ background: cor }} />)}</div>
          </div>}
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-3">{campos.map((campo) => <div key={campo.chave} className="space-y-1.5">
            <label htmlFor={`cor-${campo.chave}`} className="block text-sm font-medium text-drap-700">{campo.rotulo}</label>
            <div className="flex items-center gap-2">
              <input id={`cor-${campo.chave}`} type="color" value={cores[campo.chave]} onChange={(event) => setCores((atual) => ({ ...atual, [campo.chave]: event.target.value }))} className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-drap-200 bg-white p-1" />
              <Input aria-label={`${campo.rotulo} em hexadecimal`} value={cores[campo.chave]} maxLength={7}
                onChange={(event) => { const cor = normalizarCor(event.target.value); if (cor) setCores((atual) => ({ ...atual, [campo.chave]: cor })); }} className="font-mono text-xs" />
            </div>
            <p className="text-xs text-drap-500">{campo.uso}</p>
          </div>)}</div>
          <p className="text-xs text-drap-500">O texto sobre estas cores é branco. Cor clara demais é escurecida no mesmo tom ao salvar, para continuar legível.</p>
        </CardContent>
      </Card>
    </div>

    <Card className="h-fit">
      <CardHeader><CardTitle>Como a equipe vai ver</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[minmax(0,9rem)_1fr] overflow-hidden rounded-md border border-drap-200" aria-hidden="true">
          <div className="space-y-2 p-3" style={{ background: cores.menuColor }}>
            <div className="grid h-12 place-items-center rounded bg-white p-1.5">{logoAtual ? <img src={logoAtual} alt="" className="max-h-9 w-auto max-w-full object-contain" /> : <span className="text-[10px] font-semibold text-drap-900">{empresa}</span>}</div>
            {["Visão geral", "Projetos", "Obras"].map((item, indice) => <div key={item} className="rounded px-2 py-1.5 text-xs text-white" style={indice === 1 ? { background: `color-mix(in srgb, #ffffff 14%, ${cores.menuColor})` } : undefined}>{item}</div>)}
          </div>
          <div className="space-y-3 bg-drap-stone p-3">
            <div className="rounded px-3 py-3 text-xs font-medium text-white" style={{ background: cores.bandColor }}>Cada projeto, um próximo passo.</div>
            <div className="rounded bg-drap-paper p-3 text-xs text-drap-700">Casa Alfa · 62%<div className="mt-2 h-1.5 rounded bg-drap-200"><div className="h-1.5 w-3/5 rounded" style={{ background: cores.accentColor }} /></div></div>
            <span className="inline-block rounded px-3 py-1.5 text-xs font-medium text-white" style={{ background: cores.accentColor }}>Novo projeto</span>
          </div>
        </div>
        {erro ? <p role="alert" className="rounded-md border border-drap-danger/40 bg-drap-paper p-3 text-sm text-drap-danger">{erro}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!alterado || salvando || lendo} onClick={() => void salvar()}>{salvando ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar identidade visual</Button>
          <Button type="button" variant="outline" disabled={salvando} onClick={() => { setCores(coresIniciais(marca)); setLogo(undefined); setPaleta([]); setErro(""); }}><RotateCcw />Descartar mudanças</Button>
          <Button type="button" variant="ghost" disabled={salvando} onClick={() => setCores(PADRAO)}>Voltar às cores da plataforma</Button>
        </div>
      </CardContent>
    </Card>
  </div>;
}
