"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Cadastro fiscal da empresa: o que a prefeitura exige para aceitar uma nota dela.
 *
 * ─── POR QUE EM PARTES ───
 *
 * São vinte e poucos campos, e não dá para cortar: quem corta é a prefeitura, e ela
 * recusa a nota inteira por causa de um. Mas vinte campos numa tela só é a definição do
 * formulário que ninguém termina.
 *
 * As quatro partes seguem a ordem em que a pessoa TEM a informação: o cartão CNPJ na
 * mão, depois o endereço, depois o que o contador respondeu, e por último o certificado
 * que ela foi buscar no e-mail. Cada uma abre sozinha; a primeira já vem aberta.
 *
 * ─── O CERTIFICADO ───
 *
 * O arquivo A1 é a chave privada de assinatura fiscal da empresa. Ele vive nesta tela o
 * tempo de um clique: vira base64 em memória, vai no corpo da requisição e é descartado
 * assim que o servidor responde. A plataforma não guarda o arquivo, não guarda a senha e
 * não guarda nem o nome do arquivo.
 */

type Cadastro = Record<string, unknown> | null;

type Props = {
  /** Fecha o diálogo e recarrega quando o cadastro é aceito. */
  onSalvo: () => void;
};

const ENQUADRAMENTOS = [
  { valor: "me_epp", rotulo: "Simples Nacional (ME/EPP)" },
  { valor: "mei", rotulo: "MEI" },
  { valor: "nao_optante", rotulo: "Fora do Simples" },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const corpo = await resposta.json().catch(() => ({})) as T & { error?: string };
  if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível concluir a operação.");
  return corpo;
}

/** Lê o .pfx como base64. O `result` do FileReader vem com o prefixo `data:...;base64,`
 *  e o serviço fiscal espera só o conteúdo. */
function lerCertificado(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo do certificado."));
    leitor.onload = () => {
      const texto = String(leitor.result ?? "");
      const virgula = texto.indexOf(",");
      resolve(virgula >= 0 ? texto.slice(virgula + 1) : texto);
    };
    leitor.readAsDataURL(arquivo);
  });
}

function so(valor: FormDataEntryValue | null, digitos = false) {
  const texto = String(valor ?? "").trim();
  return digitos ? texto.replace(/\D/g, "") : texto;
}

export function NfseDadosFiscais({ onSalvo }: Props) {
  const [cadastro, setCadastro] = useState<Cadastro>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [producao, setProducao] = useState(false);
  const [aceite, setAceite] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro("");
    try {
      const resposta = await api<{ config: Cadastro }>("/api/integrations/drap/nfse/config");
      setCadastro(resposta.config);
      setProducao((resposta.config as { ambiente?: string } | null)?.ambiente === "producao");
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : "Não foi possível carregar o cadastro fiscal.");
    } finally { setCarregando(false); }
  }, []);

  useEffect(() => { const t = window.setTimeout(() => void carregar(), 0); return () => window.clearTimeout(t); }, [carregar]);

  const atual = (campo: string) => {
    const valor = (cadastro as Record<string, unknown> | null)?.[campo];
    return valor === null || valor === undefined ? "" : String(valor);
  };
  const jaCadastrado = Boolean(cadastro);

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setSalvando(true); setErro("");
    const dados = new FormData(evento.currentTarget);

    try {
      const arquivo = dados.get("certificado");
      const temArquivo = arquivo instanceof File && arquivo.size > 0;
      // O base64 nasce aqui e morre no fim desta função: não vai para estado, não vai
      // para log, não volta do servidor.
      const certificado = temArquivo ? await lerCertificado(arquivo) : null;

      const aliquota = so(dados.get("aliquota_iss")).replace(",", ".");
      const corpo = {
        tipo_prestador: "pj" as const,
        cnpj: so(dados.get("cnpj"), true),
        razao_social: so(dados.get("razao_social")),
        nome_fantasia: so(dados.get("nome_fantasia")) || null,
        inscricao_municipal: so(dados.get("inscricao_municipal")),
        codigo_municipio: so(dados.get("codigo_municipio"), true),
        municipio: so(dados.get("municipio")),
        uf: so(dados.get("uf")).toUpperCase(),
        cep: so(dados.get("cep"), true),
        logradouro: so(dados.get("logradouro")),
        numero: so(dados.get("numero")),
        complemento: so(dados.get("complemento")) || null,
        bairro: so(dados.get("bairro")),
        email: so(dados.get("email")),
        telefone: so(dados.get("telefone")) || null,
        enquadramento_fiscal: (so(dados.get("enquadramento_fiscal")) || "me_epp") as "nao_optante" | "mei" | "me_epp",
        aliquota_iss: aliquota ? Number(aliquota) : null,
        item_lista_servico: so(dados.get("item_lista_servico")) || null,
        codigo_tributario_municipio: so(dados.get("codigo_tributario_municipio")) || null,
        codigo_cnae: so(dados.get("codigo_cnae"), true) || null,
        discriminacao_padrao: so(dados.get("discriminacao_padrao")) || null,
        ...(certificado ? { certificado_base64: certificado, certificado_senha: String(dados.get("certificado_senha") ?? "") } : {}),
        ambiente: (producao ? "producao" : "homologacao") as "homologacao" | "producao",
        ...(producao && aceite ? { aceite_producao: true, aceite_producao_responsavel: so(dados.get("aceite_responsavel")) } : {}),
      };

      await api("/api/integrations/drap/nfse/config", { method: "PUT", body: JSON.stringify(corpo) });
      toast.success(jaCadastrado ? "Cadastro fiscal atualizado" : "Cadastro fiscal concluído");
      onSalvo();
    } catch (causa) {
      // O motivo vem do serviço fiscal e costuma ser acionável — município que exige
      // CNAE, certificado vencido. Trocar por "erro ao salvar" mandaria a pessoa abrir
      // chamado para descobrir o que ela corrigiria em trinta segundos.
      setErro(causa instanceof Error ? causa.message : "Não foi possível salvar o cadastro fiscal.");
    } finally { setSalvando(false); }
  }

  if (carregando) return <div className="grid min-h-32 place-items-center"><LoaderCircle className="size-5 animate-spin text-hoikos-600" /></div>;

  return <form onSubmit={salvar} className="space-y-4">
    <Accordion type="single" collapsible defaultValue="identificacao" className="w-full">
      <AccordionItem value="identificacao">
        <AccordionTrigger>Identificação</AccordionTrigger>
        <AccordionContent className="space-y-3">
          <Campo name="cnpj" label="CNPJ" defaultValue={atual("cnpj")} inputMode="numeric" required />
          <Campo name="razao_social" label="Razão social" defaultValue={atual("razao_social")} required />
          <Campo name="nome_fantasia" label="Nome fantasia" defaultValue={atual("nome_fantasia")} />
          <Campo
            name="inscricao_municipal" label="Inscrição municipal" defaultValue={atual("inscricao_municipal")} required
            ajuda="Sai do cadastro da empresa na prefeitura. Não é a inscrição estadual."
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="endereco">
        <AccordionTrigger>Endereço</AccordionTrigger>
        <AccordionContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Campo name="cep" label="CEP" defaultValue={atual("cep")} inputMode="numeric" required />
            <Campo name="numero" label="Número" defaultValue={atual("numero")} required />
          </div>
          <Campo name="logradouro" label="Logradouro" defaultValue={atual("logradouro")} required />
          <div className="grid grid-cols-2 gap-3">
            <Campo name="bairro" label="Bairro" defaultValue={atual("bairro")} required />
            <Campo name="complemento" label="Complemento" defaultValue={atual("complemento")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo name="municipio" label="Município" defaultValue={atual("municipio")} required />
            <Campo name="uf" label="UF" defaultValue={atual("uf")} maxLength={2} required />
          </div>
          <Campo
            name="codigo_municipio" label="Código IBGE do município" defaultValue={atual("codigo_municipio")}
            inputMode="numeric" required
            ajuda="Sete dígitos. É por ele que a nota chega na prefeitura certa."
          />
          <div className="grid grid-cols-2 gap-3">
            <Campo name="email" label="E-mail" type="email" defaultValue={atual("email")} required />
            <Campo name="telefone" label="Telefone" defaultValue={atual("telefone")} />
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="tributacao">
        <AccordionTrigger>Tributação</AccordionTrigger>
        <AccordionContent className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Enquadramento</span>
            <NativeSelect name="enquadramento_fiscal" defaultValue={atual("enquadramento_fiscal") || "me_epp"}>
              {ENQUADRAMENTOS.map((item) => <option key={item.valor} value={item.valor}>{item.rotulo}</option>)}
            </NativeSelect>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Campo name="aliquota_iss" label="Alíquota de ISS (%)" defaultValue={atual("aliquota_iss")} inputMode="decimal" />
            <Campo name="item_lista_servico" label="Item da lista de serviço" defaultValue={atual("item_lista_servico")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo name="codigo_cnae" label="CNAE" defaultValue={atual("codigo_cnae")} inputMode="numeric" />
            <Campo name="codigo_tributario_municipio" label="Código tributário" defaultValue={atual("codigo_tributario_municipio")} />
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Descrição padrão do serviço</span>
            <Textarea name="discriminacao_padrao" rows={3} defaultValue={atual("discriminacao_padrao")} />
            <span className="mt-1.5 block text-xs text-hoikos-500">Entra na nota quando você não escrever outra.</span>
          </label>
          <p className="text-xs text-hoikos-500">
            Estes quatro campos variam por município e por atividade. Se não souber, pergunte ao
            contador — errar aqui faz a prefeitura recusar a nota.
          </p>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="certificado">
        <AccordionTrigger>Certificado digital</AccordionTrigger>
        <AccordionContent className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Certificado A1 (.pfx ou .p12)</span>
            <Input name="certificado" type="file" accept=".pfx,.p12,application/x-pkcs12" required={!jaCadastrado} />
            <span className="mt-1.5 block text-xs text-hoikos-500">
              {jaCadastrado
                ? "Só envie de novo se o certificado foi renovado."
                : "É a assinatura da sua empresa. Ele não fica guardado aqui: segue direto para o serviço fiscal."}
            </span>
          </label>
          <Campo name="certificado_senha" label="Senha do certificado" type="password" required={!jaCadastrado} />

          <div className="rounded-md border border-hoikos-200 bg-hoikos-50 p-3">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={producao} onCheckedChange={(v) => { setProducao(v === true); if (v !== true) setAceite(false); }} />
              <span>
                <span className="font-medium">Emitir notas com valor fiscal real</span>
                <span className="mt-1 block text-xs text-hoikos-500">
                  Desligado, as notas são de teste e não valem nada perante a prefeitura — é assim
                  que se confere o cadastro antes de valer.
                </span>
              </span>
            </label>

            {producao ? <div className="mt-3 space-y-3 border-t border-hoikos-200 pt-3">
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={aceite} onCheckedChange={(v) => setAceite(v === true)} />
                <span className="text-xs text-hoikos-700">
                  Declaro que li os termos e que as notas emitidas a partir daqui têm valor fiscal,
                  entram na apuração do ISS do município e só se desfazem por cancelamento, com prazo.
                </span>
              </label>
              {/* Quem aceitou fica registrado com nome: é ato jurídico de uma pessoa, e um
                  registro sem pessoa atrás não prova nada. */}
              {aceite ? <Campo name="aceite_responsavel" label="Quem está aceitando (nome e cargo)" required /> : null}
            </div> : null}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>

    {erro ? <p role="alert" className="rounded-md border border-hoikos-200 bg-hoikos-50 px-3 py-2 text-sm text-hoikos-800">{erro}</p> : null}

    <Button type="submit" disabled={salvando || (producao && !aceite)} className="w-full">
      {salvando ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
      {jaCadastrado ? "Salvar cadastro fiscal" : "Concluir cadastro fiscal"}
    </Button>
  </form>;
}

function Campo({ name, label, ajuda, ...resto }: {
  name: string; label: string; ajuda?: string;
} & React.ComponentProps<typeof Input>) {
  return <label className="block text-sm">
    <span className="mb-1.5 block font-medium">{label}</span>
    <Input name={name} {...resto} />
    {ajuda ? <span className="mt-1.5 block text-xs text-hoikos-500">{ajuda}</span> : null}
  </label>;
}
