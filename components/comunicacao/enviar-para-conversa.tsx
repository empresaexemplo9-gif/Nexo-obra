"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { abrirDireta, enviarMensagem, listarConversas, type ListaConversas } from "@/lib/chat-client";
import type { OrgFileInfo } from "@/lib/org-files-client";

/** Manda um arquivo da Prancheta para uma conversa, no formato original, sem copiar. */
export function EnviarParaConversa({ arquivo, onFechar }: { arquivo: OrgFileInfo | null; onFechar: () => void }) {
  const [enviando, setEnviando] = useState(false);
  return <Dialog open={arquivo !== null} onOpenChange={(open) => { if (!open && !enviando) onFechar(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Enviar numa conversa</DialogTitle><DialogDescription>“{arquivo?.name}” vai no formato original. Quem estiver na conversa poderá abrir e baixar.</DialogDescription></DialogHeader>
      {arquivo ? <Formulario key={arquivo.id} arquivo={arquivo} onFechar={onFechar} enviando={enviando} setEnviando={setEnviando} /> : null}
    </DialogContent>
  </Dialog>;
}

// Montado a cada arquivo: destino, texto e chave de envio começam do zero.
function Formulario({ arquivo, onFechar, enviando, setEnviando }: { arquivo: OrgFileInfo; onFechar: () => void; enviando: boolean; setEnviando: (valor: boolean) => void }) {
  const [lista, setLista] = useState<ListaConversas | null>(null);
  const [erro, setErro] = useState("");
  const [destino, setDestino] = useState("");
  const [texto, setTexto] = useState("");
  // A chave vale para este envio: se a rede cair e a pessoa repetir, não sai em dobro.
  const chave = useRef<string>("");

  useEffect(() => {
    let vivo = true;
    chave.current = crypto.randomUUID();
    listarConversas().then((resposta) => { if (vivo) { setLista(resposta); setDestino(resposta.conversations[0] ? `c:${resposta.conversations[0].id}` : ""); } })
      .catch((causa) => { if (vivo) setErro(causa instanceof Error ? causa.message : "Não foi possível carregar as conversas."); });
    return () => { vivo = false; };
  }, []);

  async function enviar() {
    if (!destino || enviando) return;
    setEnviando(true);
    try {
      const channelId = destino.startsWith("p:") ? (await abrirDireta(destino.slice(2))).channelId : destino.slice(2);
      await enviarMensagem(channelId, { clientKey: chave.current, body: texto.trim(), fileIds: [arquivo.id] });
      toast.success("Arquivo enviado na conversa");
      onFechar();
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível enviar."); }
    finally { setEnviando(false); }
  }

  const diretasAbertas = new Set(lista?.conversations.filter((c) => c.kind === "direta").map((c) => c.otherMemberId));
  return <>
    {erro ? <p className="text-sm text-red-700" role="alert">{erro}</p> : !lista ? <p className="flex items-center gap-2 text-sm" role="status"><LoaderCircle className="animate-spin" />Carregando conversas…</p> : <div className="space-y-4">
      <div><Label htmlFor="destino-conversa">Para</Label>
        <NativeSelect id="destino-conversa" value={destino} onChange={(event) => setDestino(event.target.value)} className="mt-1.5 w-full">
          <optgroup label="Canais">{lista.conversations.filter((c) => c.kind === "canal").map((c) => <option key={c.id} value={`c:${c.id}`}># {c.name}</option>)}</optgroup>
          {lista.conversations.some((c) => c.kind === "direta") ? <optgroup label="Conversas diretas">{lista.conversations.filter((c) => c.kind === "direta").map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup> : null}
          {lista.members.some((m) => !diretasAbertas.has(m.id)) ? <optgroup label="Nova conversa com">{lista.members.filter((m) => !diretasAbertas.has(m.id)).map((m) => <option key={m.id} value={`p:${m.id}`}>{m.name}</option>)}</optgroup> : null}
        </NativeSelect></div>
      <div><Label htmlFor="texto-envio">Mensagem (opcional)</Label><Textarea id="texto-envio" value={texto} onChange={(event) => setTexto(event.target.value)} maxLength={4000} rows={3} className="mt-1.5" placeholder="Ex.: revisão 3 com as tomadas da cozinha" /></div>
    </div>}
    <DialogFooter><Button variant="outline" onClick={onFechar} disabled={enviando}>Cancelar</Button><Button onClick={() => void enviar()} disabled={!destino || enviando}>{enviando ? <LoaderCircle className="animate-spin" /> : <Send />}Enviar</Button></DialogFooter>
  </>;
}
