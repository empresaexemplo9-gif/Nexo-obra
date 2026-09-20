"use client";

import { useState, type FormEvent } from "react";
import { Building2, Link2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Conectar esta empresa à Drap sem sair da H.OIKOS.
//
// Dois caminhos, e a diferença é quem consente:
//
//   criar    — a empresa não existe na Drap. A plataforma cria e guarda a chave, cifrada.
//   vincular — a empresa JÁ existe lá. Só o administrador dela autoriza, gerando um código
//              dentro da Drap. Sem esse código, saber o CNPJ de alguém bastaria para
//              passar a operar o financeiro dele.
//
// A chave nunca chega a esta tela. Ela nasce na resposta da Drap, do lado do servidor, e
// vai direto para a cifra.

type Modo = "provisionar" | "vincular";

type Resposta = { webhook?: { registrado: boolean; motivo?: string } };

/** A mensagem de erro da Drap é acionável (documento já cadastrado, código vencido,
 *  módulo faltando); é ela que sobe, não um texto genérico. */
async function conectarNoServidor(corpo: unknown) {
  const resposta = await fetch("/api/integrations/drap/provisionar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    cache: "no-store",
  });
  const dados = await resposta.json().catch(() => ({})) as Resposta & { error?: string };
  if (!resposta.ok) throw new Error(dados.error ?? "Não foi possível conectar.");
  return dados;
}

export function DrapConectar({ onConectado }: { onConectado: () => void }) {
  const [modo, setModo] = useState<Modo>("provisionar");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function conectar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);
    setEnviando(true);
    setErro("");
    try {
      const corpo = modo === "provisionar"
        ? {
            modo,
            documentoTipo: String(dados.get("documento") ?? "").replace(/\D/g, "").length === 11 ? "cpf" : "cnpj",
            documentoNumero: String(dados.get("documento") ?? "").replace(/\D/g, ""),
          }
        : { modo, codigo: String(dados.get("codigo") ?? "").trim().toUpperCase() };

      const resposta = await conectarNoServidor(corpo);
      const conectada = modo === "provisionar" ? "Empresa criada na Drap e conectada" : "Empresa vinculada";

      // Conectar também liga os avisos automáticos. Quando essa parte falha, a conexão
      // vale — mas dizer só "conectada" faria a tela afirmar algo que não aconteceu, e o
      // usuário só descobriria ao estranhar que nada atualiza sozinho.
      if (resposta.webhook && !resposta.webhook.registrado) {
        toast.warning(`${conectada}, mas sem avisos automáticos`, {
          description: resposta.webhook.motivo ?? "Ligue os avisos em Conexão DRAP.",
        });
      } else {
        toast.success(conectada);
      }
      onConectado();
    } catch (causa) {
      // A mensagem vem da Drap e é acionável: documento já cadastrado, código vencido,
      // módulo faltando. Trocar por um texto genérico esconderia o que fazer.
      setErro(causa instanceof Error ? causa.message : "Não foi possível conectar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={conectar} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={modo === "provisionar" ? "default" : "outline"} size="sm" onClick={() => { setModo("provisionar"); setErro(""); }}>
          <Building2 />Criar empresa
        </Button>
        <Button type="button" variant={modo === "vincular" ? "default" : "outline"} size="sm" onClick={() => { setModo("vincular"); setErro(""); }}>
          <Link2 />Já uso a Drap
        </Button>
      </div>

      {modo === "provisionar" ? (
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">CNPJ ou CPF da empresa</span>
          <Input name="documento" inputMode="numeric" placeholder="00000000000000" required />
          <span className="mt-1.5 block text-xs text-hoikos-500">É o documento que impede empresa duplicada na Drap.</span>
        </label>
      ) : (
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Código de vínculo</span>
          <Input name="codigo" autoCapitalize="characters" placeholder="K7M2P9QR" required />
          <span className="mt-1.5 block text-xs text-hoikos-500">
            O administrador da empresa gera em Configurações → Integrações, na Drap. Vale uma vez, por 15 minutos.
          </span>
        </label>
      )}

      {erro ? <p role="alert" className="text-sm text-hoikos-700">{erro}</p> : null}

      <Button type="submit" disabled={enviando} className="w-full">
        {enviando ? <LoaderCircle className="animate-spin" /> : null}
        {modo === "provisionar" ? "Criar e conectar" : "Vincular empresa"}
      </Button>
    </form>
  );
}
