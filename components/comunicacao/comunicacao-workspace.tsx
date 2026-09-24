"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft, BellPlus, CalendarClock, Check, Download, Eye, FolderOpen, Hash, LoaderCircle, MessageCircle, Paperclip,
  Pencil, Plus, RotateCcw, Send, Trash2, UserRound, X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { VisualizadorArquivo } from "@/components/prancheta/visualizador-arquivo";
import {
  abrirDireta, criarCanal, enviarMensagem, hojeLocal, horaDaMensagem, listarConversas, pedir,
  type Conversa, type ListaConversas, type Mensagem, type PaginaMensagens,
} from "@/lib/chat-client";
import { sizeLabel } from "@/lib/org-files";
import { checkBeforeUpload, downloadAndSave, uploadOrgFile, type OrgFileInfo } from "@/lib/org-files-client";
import { visualizadorPara } from "@/lib/prancheta-formatos";

type Anexo = { chave: string; nome: string; progresso: number; arquivo?: OrgFileInfo; erro?: string };

const INTERVALO_MENSAGENS = 4000;
const INTERVALO_LISTA = 15000;

function mesclar(atuais: Mensagem[], novas: Mensagem[]) {
  const porId = new Map(atuais.map((mensagem) => [mensagem.id, mensagem]));
  for (const mensagem of novas) porId.set(mensagem.id, mensagem);
  return [...porId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

const dataCurta = (dia: string) => new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR");

export function ComunicacaoWorkspace({ canUseLibrary, onUnread }: { canUseLibrary: boolean; onUnread?: (total: number) => void }) {
  const [lista, setLista] = useState<ListaConversas | null>(null);
  const [erroLista, setErroLista] = useState("");
  const [ativa, setAtiva] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [temMais, setTemMais] = useState(false);
  const [carregandoMensagens, setCarregandoMensagens] = useState(false);
  const [erroMensagens, setErroMensagens] = useState("");
  const cursor = useRef<string | null>(null);
  const [texto, setTexto] = useState("");
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [lembrete, setLembrete] = useState<{ dia: string; para: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [novoCanal, setNovoCanal] = useState<string | null>(null);
  const [visualizando, setVisualizando] = useState<OrgFileInfo | null>(null);
  const [escolherDaPrancheta, setEscolherDaPrancheta] = useState(false);
  const rolagem = useRef<HTMLDivElement>(null);
  const entradaArquivo = useRef<HTMLInputElement>(null);
  const noFim = useRef(true);

  const conversa = lista?.conversations.find((item) => item.id === ativa) ?? null;

  const recarregarLista = useCallback(async () => {
    try {
      const resposta = await listarConversas();
      setLista(resposta); setErroLista(""); onUnread?.(resposta.unreadTotal);
      return resposta;
    } catch (causa) { setErroLista(causa instanceof Error ? causa.message : "Não foi possível carregar as conversas."); return null; }
  }, [onUnread]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void recarregarLista().then((resposta) => {
      // Na tela larga a primeira conversa já abre; no celular a lista vem primeiro.
      if (resposta && window.matchMedia("(min-width: 768px)").matches) setAtiva((atual) => atual ?? resposta.conversations[0]?.id ?? null);
    }); }, 0);
    const intervalo = window.setInterval(() => { if (document.visibilityState === "visible") void recarregarLista(); }, INTERVALO_LISTA);
    return () => { window.clearTimeout(timer); window.clearInterval(intervalo); };
  }, [recarregarLista]);

  // Abre a conversa: página mais recente, depois só o que mudou desde o cursor.
  useEffect(() => {
    if (!ativa) return;
    let vivo = true;
    setMensagens([]); setTemMais(false); setErroMensagens(""); setCarregandoMensagens(true); setEditando(null);
    cursor.current = null; noFim.current = true;
    pedir<PaginaMensagens>(`/api/conversas/${ativa}/mensagens`).then((pagina) => {
      if (!vivo) return;
      setMensagens(pagina.messages); setTemMais(pagina.hasMore); cursor.current = pagina.cursor;
      void recarregarLista();
    }).catch((causa) => { if (vivo) setErroMensagens(causa instanceof Error ? causa.message : "Não foi possível abrir a conversa."); })
      .finally(() => { if (vivo) setCarregandoMensagens(false); });
    const intervalo = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !cursor.current) return;
      pedir<PaginaMensagens>(`/api/conversas/${ativa}/mensagens?since=${encodeURIComponent(cursor.current)}`).then((pagina) => {
        if (!vivo) return;
        cursor.current = pagina.cursor;
        if (pagina.messages.length) setMensagens((atuais) => mesclar(atuais, pagina.messages));
      }).catch(() => undefined);
    }, INTERVALO_MENSAGENS);
    return () => { vivo = false; window.clearInterval(intervalo); };
  }, [ativa, recarregarLista]);

  useEffect(() => {
    const caixa = rolagem.current;
    if (caixa && noFim.current) caixa.scrollTop = caixa.scrollHeight;
  }, [mensagens]);

  async function carregarAnteriores() {
    if (!ativa || !mensagens.length) return;
    const caixa = rolagem.current;
    const altura = caixa?.scrollHeight ?? 0;
    try {
      const pagina = await pedir<PaginaMensagens>(`/api/conversas/${ativa}/mensagens?before=${encodeURIComponent(mensagens[0].createdAt)}`);
      noFim.current = false;
      setMensagens((atuais) => mesclar(atuais, pagina.messages)); setTemMais(pagina.hasMore);
      requestAnimationFrame(() => { if (caixa) caixa.scrollTop = caixa.scrollHeight - altura; });
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível carregar."); }
  }

  async function anexar(arquivos: FileList | File[]) {
    for (const arquivo of [...arquivos]) {
      const chaveAnexo = crypto.randomUUID();
      const problema = checkBeforeUpload(arquivo);
      setAnexos((atuais) => [...atuais, { chave: chaveAnexo, nome: arquivo.name, progresso: 0, erro: problema ?? undefined }]);
      if (problema) continue;
      try {
        const enviado = await uploadOrgFile(arquivo, arquivo.name, { area: "conversa", onProgress: (fracao) => setAnexos((atuais) => atuais.map((item) => item.chave === chaveAnexo ? { ...item, progresso: fracao } : item)) });
        setAnexos((atuais) => atuais.map((item) => item.chave === chaveAnexo ? { ...item, progresso: 1, arquivo: enviado } : item));
      } catch (causa) {
        setAnexos((atuais) => atuais.map((item) => item.chave === chaveAnexo ? { ...item, erro: causa instanceof Error ? causa.message : "Falha no envio." } : item));
      }
    }
  }

  function removerAnexo(anexo: Anexo) {
    setAnexos((atuais) => atuais.filter((item) => item.chave !== anexo.chave));
    // Arquivo que subiu e não foi enviado não fica ocupando o armazenamento.
    if (anexo.arquivo && !anexo.arquivo.inLibrary) void fetch(`/api/arquivos/${anexo.arquivo.id}`, { method: "DELETE" });
  }

  const subindo = anexos.some((item) => !item.arquivo && !item.erro);
  const prontos = anexos.filter((item) => item.arquivo).map((item) => item.arquivo!.id);

  async function enviar() {
    if (!ativa || enviando || subindo) return;
    const corpo = texto.trim();
    if (!corpo && !prontos.length) return;
    if (lembrete && !corpo) { toast.error("Escreva o que deve ser lembrado."); return; }
    setEnviando(true);
    try {
      const { message } = await enviarMensagem(ativa, {
        clientKey: chave, body: lembrete ? "" : corpo, fileIds: prontos,
        reminder: lembrete ? { text: corpo.slice(0, 300), dueDay: lembrete.dia, targetMemberId: lembrete.para || null } : undefined,
      });
      noFim.current = true;
      setMensagens((atuais) => mesclar(atuais, [message]));
      setTexto(""); setAnexos([]); setLembrete(null); setChave(crypto.randomUUID());
      void recarregarLista();
    } catch (causa) {
      // A mensagem continua no campo e a chave é a mesma: tentar de novo não duplica.
      toast.error(causa instanceof Error ? causa.message : "Não foi possível enviar. Tente de novo.");
    } finally { setEnviando(false); }
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) { evento.preventDefault(); void enviar(); }
  }

  async function salvarEdicao() {
    if (!editando) return;
    try {
      await pedir(`/api/conversas/mensagens/${editando.id}`, { method: "PATCH", body: JSON.stringify({ body: editando.texto }) });
      setMensagens((atuais) => atuais.map((m) => m.id === editando.id ? { ...m, body: editando.texto.trim(), editedAt: new Date().toISOString() } : m));
      setEditando(null);
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível salvar."); }
  }

  async function apagar(mensagem: Mensagem) {
    if (!window.confirm(mensagem.files.length ? "Apagar a mensagem e os anexos dela?" : "Apagar a mensagem?")) return;
    try {
      await pedir(`/api/conversas/mensagens/${mensagem.id}`, { method: "DELETE" });
      setMensagens((atuais) => atuais.map((m) => m.id === mensagem.id ? { ...m, deleted: true, body: "", files: [], reminder: null } : m));
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível apagar."); }
  }

  async function marcarLembrete(mensagem: Mensagem, feito: boolean) {
    if (!mensagem.reminder) return;
    try {
      await pedir(`/api/conversas/lembretes/${mensagem.reminder.id}`, { method: "PATCH", body: JSON.stringify({ done: feito }) });
      setMensagens((atuais) => atuais.map((m) => m.id === mensagem.id && m.reminder ? { ...m, reminder: { ...m.reminder, doneAt: feito ? new Date().toISOString() : null, doneByName: feito ? "você" : null } } : m));
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível atualizar o lembrete."); }
  }

  async function criarNovoCanal() {
    if (!novoCanal?.trim()) return;
    try {
      const { channelId } = await criarCanal(novoCanal.trim());
      setNovoCanal(null); await recarregarLista(); setAtiva(channelId);
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível criar o canal."); }
  }

  async function conversarCom(memberId: string) {
    if (!memberId) return;
    try {
      const { channelId } = await abrirDireta(memberId);
      await recarregarLista(); setAtiva(channelId);
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível abrir a conversa."); }
  }

  async function excluirCanal(item: Conversa) {
    if (!window.confirm(`Excluir o canal ${item.name} com todas as mensagens e anexos?`)) return;
    try {
      await pedir(`/api/conversas/${item.id}`, { method: "DELETE" });
      setAtiva(null); await recarregarLista();
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível excluir o canal."); }
  }

  const pessoasDaConversa = useMemo(() => {
    if (!lista || !conversa) return [];
    return conversa.kind === "direta"
      ? lista.members.filter((m) => m.id === conversa.otherMemberId).concat([{ id: lista.me, name: "Eu" }])
      : [{ id: lista.me, name: "Eu" }, ...lista.members];
  }, [lista, conversa]);

  const canais = lista?.conversations.filter((c) => c.kind === "canal") ?? [];
  const diretas = lista?.conversations.filter((c) => c.kind === "direta") ?? [];
  const semDireta = lista?.members.filter((m) => !diretas.some((d) => d.otherMemberId === m.id)) ?? [];

  const itemDaLista = (item: Conversa) => <li key={item.id}><button type="button" onClick={() => setAtiva(item.id)} aria-current={item.id === ativa ? "true" : undefined}
    className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-hoikos-50 focus-visible:outline-2 ${item.id === ativa ? "bg-hoikos-100" : ""}`}>
    {item.kind === "canal" ? <Hash className="mt-0.5 size-4 shrink-0 text-hoikos-500" /> : <UserRound className="mt-0.5 size-4 shrink-0 text-hoikos-500" />}
    <span className="min-w-0 flex-1"><span className={`block truncate text-sm ${item.unread ? "font-semibold text-hoikos-950" : "text-hoikos-800"}`}>{item.name}</span>
      {item.lastPreview ? <span className="block truncate text-xs text-hoikos-500">{item.lastPreview}</span> : null}</span>
    {item.unread ? <Badge className="shrink-0" aria-label={`${item.unread} não lidas`}>{item.unread > 99 ? "99+" : item.unread}</Badge> : null}
  </button></li>;

  return <div className="space-y-4">
    {/* No celular, com a conversa aberta, o cabeçalho sai para a caixa de mensagem caber na tela. */}
    <div className={`hoikos-module-heading ${ativa ? "hidden md:block" : ""}`}><p className="eyebrow text-hoikos-600">Equipe</p><h1 className="display-heading mt-2 text-3xl text-hoikos-950 sm:text-4xl">Comunicação</h1>
      <p className="mt-2 max-w-2xl text-sm text-hoikos-500">Mensagens, arquivos no formato original e lembretes com data, só entre as pessoas desta empresa.</p></div>
    <Card className="overflow-hidden p-0">
      <div className="grid h-[calc(100svh-8rem)] min-h-[440px] md:h-[calc(100svh-13rem)] md:min-h-[520px] md:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className={`${ativa ? "hidden md:flex" : "flex"} min-h-0 flex-col border-r border-hoikos-200`} aria-label="Conversas">
          {erroLista ? <div className="p-4 text-sm" role="alert">{erroLista}<Button size="sm" variant="outline" className="mt-2" onClick={() => void recarregarLista()}>Tentar novamente</Button></div>
            : !lista ? <p className="flex items-center gap-2 p-4 text-sm" role="status"><LoaderCircle className="animate-spin" />Carregando…</p>
              : <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
                <section><div className="flex items-center justify-between px-2"><h2 className="text-xs font-semibold uppercase tracking-wider text-hoikos-500">Canais</h2>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => setNovoCanal(novoCanal === null ? "" : null)} aria-label="Novo canal" aria-expanded={novoCanal !== null}><Plus /></Button></div>
                  {novoCanal !== null ? <form className="flex gap-1 p-2" onSubmit={(event) => { event.preventDefault(); void criarNovoCanal(); }}>
                    <Input autoFocus value={novoCanal} onChange={(event) => setNovoCanal(event.target.value)} maxLength={60} placeholder="Ex.: Obra Casa Alfa" aria-label="Nome do canal" className="h-8" />
                    <Button size="sm" type="submit" disabled={novoCanal.trim().length < 2}>Criar</Button></form> : null}
                  <ul>{canais.map(itemDaLista)}</ul></section>
                <section><h2 className="px-2 text-xs font-semibold uppercase tracking-wider text-hoikos-500">Conversas diretas</h2>
                  <ul>{diretas.map(itemDaLista)}</ul>
                  {semDireta.length ? <NativeSelect aria-label="Conversar com" value="" onChange={(event) => void conversarCom(event.target.value)} className="mx-2 mt-2 w-[calc(100%-1rem)]">
                    <option value="">Conversar com…</option>{semDireta.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</NativeSelect>
                    : !lista.members.length ? <p className="px-2 pt-1 text-xs text-hoikos-500">Convide pessoas em Equipe para conversar.</p> : null}
                </section>
              </div>}
        </aside>

        <section className={`${ativa ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-col`} aria-label="Mensagens">
          {!conversa ? <div className="grid flex-1 place-items-center p-6 text-center text-sm text-hoikos-500"><div><MessageCircle className="mx-auto mb-2 size-8" />Escolha uma conversa.</div></div> : <>
            <header className="flex items-center gap-2 border-b border-hoikos-200 p-2">
              <Button size="icon" variant="ghost" className="md:hidden" onClick={() => setAtiva(null)} aria-label="Voltar às conversas"><ArrowLeft /></Button>
              {conversa.kind === "canal" ? <Hash className="size-4 text-hoikos-500" /> : <UserRound className="size-4 text-hoikos-500" />}
              <h2 className="min-w-0 flex-1 truncate font-semibold">{conversa.name}</h2>
              {conversa.canDelete ? <Button size="sm" variant="ghost" onClick={() => void excluirCanal(conversa)}><Trash2 />Excluir canal</Button> : null}
            </header>
            <div ref={rolagem} className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-hoikos-50/40 p-3" aria-live="polite"
              onScroll={(event) => { const el = event.currentTarget; noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
              {temMais ? <div className="text-center"><Button size="sm" variant="outline" onClick={() => void carregarAnteriores()}>Mensagens anteriores</Button></div> : null}
              {carregandoMensagens ? <p className="flex items-center justify-center gap-2 p-6 text-sm" role="status"><LoaderCircle className="animate-spin" />Abrindo…</p>
                : erroMensagens ? <p className="p-6 text-center text-sm" role="alert">{erroMensagens}</p>
                  : !mensagens.length ? <p className="p-6 text-center text-sm text-hoikos-500">Nenhuma mensagem ainda. Escreva a primeira.</p>
                    : mensagens.map((mensagem) => <article key={mensagem.id} className={`group rounded-lg px-3 py-2 ${mensagem.mine ? "ml-auto bg-hoikos-100" : "bg-white"} max-w-[min(42rem,92%)] shadow-sm`}>
                      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-hoikos-500"><span className="font-semibold text-hoikos-900">{mensagem.mine ? "Você" : mensagem.authorName}</span><time dateTime={mensagem.createdAt}>{horaDaMensagem(mensagem.createdAt)}</time>{mensagem.editedAt && !mensagem.deleted ? <span>(editada)</span> : null}</p>
                      {mensagem.deleted ? <p className="mt-1 text-sm italic text-hoikos-500">Mensagem apagada.</p>
                        : editando?.id === mensagem.id ? <div className="mt-1 space-y-2"><Textarea value={editando.texto} onChange={(event) => setEditando({ id: mensagem.id, texto: event.target.value })} maxLength={4000} rows={3} aria-label="Editar mensagem" autoFocus />
                          <div className="flex gap-2"><Button size="sm" onClick={() => void salvarEdicao()} disabled={!editando.texto.trim()}>Salvar</Button><Button size="sm" variant="outline" onClick={() => setEditando(null)}>Cancelar</Button></div></div>
                          : mensagem.reminder ? <div className={`mt-1 rounded-md border p-2 ${mensagem.reminder.doneAt ? "border-hoikos-200 bg-white/60" : "border-amber-300 bg-amber-50"}`}>
                            <p className="flex items-center gap-1.5 text-xs font-semibold text-hoikos-700"><CalendarClock className="size-3.5" />Lembrete para {mensagem.reminder.targetName ?? "todos da conversa"} · {dataCurta(mensagem.reminder.dueDay)}</p>
                            <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${mensagem.reminder.doneAt ? "text-hoikos-500 line-through" : "text-hoikos-950"}`}>{mensagem.reminder.text}</p>
                            {mensagem.reminder.doneAt ? <p className="mt-1 text-xs text-hoikos-600">Feito por {mensagem.reminder.doneByName}.</p> : null}
                            {mensagem.reminder.canComplete ? <Button size="sm" variant="outline" className="mt-2" onClick={() => void marcarLembrete(mensagem, !mensagem.reminder!.doneAt)}>{mensagem.reminder.doneAt ? <><RotateCcw />Reabrir</> : <><Check />Marcar como feito</>}</Button> : null}
                          </div>
                            : mensagem.body ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-hoikos-950">{mensagem.body}</p> : null}
                      {mensagem.files.length ? <ul className="mt-2 space-y-1.5">{mensagem.files.map((arquivo) => <li key={arquivo.id} className="flex flex-wrap items-center gap-2 rounded-md border border-hoikos-200 bg-white p-2">
                        <Paperclip className="size-4 shrink-0 text-hoikos-500" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{arquivo.name}</span><span className="text-xs text-hoikos-500">{arquivo.extension.toUpperCase()} · {sizeLabel(arquivo.sizeBytes)}</span></span>
                        {visualizadorPara(arquivo.extension) !== "nenhum" ? <Button size="sm" variant="outline" onClick={() => setVisualizando(arquivo)}><Eye />Abrir</Button> : null}
                        <Button size="sm" variant="outline" onClick={() => void downloadAndSave(arquivo).catch((causa) => toast.error(causa instanceof Error ? causa.message : "Não foi possível baixar."))}><Download />Baixar</Button>
                      </li>)}</ul> : null}
                      {!mensagem.deleted && editando?.id !== mensagem.id && (mensagem.canEdit || mensagem.canDelete) ? <div className="mt-1 flex gap-1 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100">
                        {mensagem.canEdit ? <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditando({ id: mensagem.id, texto: mensagem.body })}><Pencil />Editar</Button> : null}
                        {mensagem.canDelete ? <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void apagar(mensagem)}><Trash2 />Apagar</Button> : null}
                      </div> : null}
                    </article>)}
            </div>

            <form className="space-y-2 border-t border-hoikos-200 bg-white p-2" onSubmit={(event) => { event.preventDefault(); void enviar(); }}>
              {anexos.length ? <ul className="flex flex-wrap gap-2" aria-label="Anexos">{anexos.map((anexo) => <li key={anexo.chave} className="flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs">
                <Paperclip className="size-3.5 shrink-0" /><span className="max-w-[12rem] truncate">{anexo.nome}</span>
                {anexo.erro ? <span className="text-red-700" role="alert">{anexo.erro}</span> : !anexo.arquivo ? <Progress value={anexo.progresso * 100} className="h-1.5 w-16" aria-label={`Envio de ${anexo.nome}`} /> : <Check className="size-3.5 text-green-700" aria-label="Pronto" />}
                <button type="button" onClick={() => removerAnexo(anexo)} aria-label={`Remover ${anexo.nome}`} className="rounded p-0.5 hover:bg-hoikos-100"><X className="size-3.5" /></button>
              </li>)}</ul> : null}
              {lembrete ? <div className="flex flex-wrap items-end gap-2 rounded-md bg-amber-50 p-2">
                <div><Label htmlFor="lembrete-dia" className="text-xs">Lembrar em</Label><Input id="lembrete-dia" type="date" value={lembrete.dia} min={hojeLocal()} onChange={(event) => setLembrete({ ...lembrete, dia: event.target.value })} className="mt-1 h-8" /></div>
                <div><Label htmlFor="lembrete-para" className="text-xs">Para</Label><NativeSelect id="lembrete-para" value={lembrete.para} onChange={(event) => setLembrete({ ...lembrete, para: event.target.value })} className="mt-1 h-8">
                  <option value="">Todos da conversa</option>{pessoasDaConversa.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></div>
                <p className="flex-1 text-xs text-hoikos-600">Aparece em Lembretes do dia até alguém marcar como feito.</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setLembrete(null)}>Cancelar lembrete</Button>
              </div> : null}
              <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
                <div className="order-2 flex shrink-0 gap-1 sm:order-1">
                  <Button type="button" size="icon" variant="outline" onClick={() => entradaArquivo.current?.click()} aria-label="Anexar arquivo"><Paperclip /></Button>
                  {canUseLibrary ? <Button type="button" size="icon" variant="outline" onClick={() => setEscolherDaPrancheta(true)} aria-label="Anexar da Prancheta"><FolderOpen /></Button> : null}
                  <Button type="button" size="icon" variant={lembrete ? "default" : "outline"} onClick={() => setLembrete(lembrete ? null : { dia: hojeLocal(), para: "" })} aria-label="Criar lembrete" aria-pressed={Boolean(lembrete)}><BellPlus /></Button>
                  <input ref={entradaArquivo} type="file" multiple className="sr-only" aria-hidden tabIndex={-1} onChange={(event) => { if (event.target.files?.length) void anexar(event.target.files); event.target.value = ""; }} />
                </div>
                <Textarea value={texto} onChange={(event) => setTexto(event.target.value)} onKeyDown={aoTeclar} rows={1} maxLength={lembrete ? 300 : 4000}
                  placeholder={lembrete ? "O que deve ser lembrado?" : "Mensagem (Enter envia, Shift+Enter quebra a linha)"} aria-label={lembrete ? "Texto do lembrete" : "Mensagem"} className="order-1 max-h-40 min-h-10 basis-full resize-none sm:order-2 sm:basis-0 sm:flex-1" />
                <Button type="submit" size="icon" className="order-3 ml-auto sm:ml-0" disabled={enviando || subindo || (!texto.trim() && !prontos.length)} aria-label="Enviar">{enviando ? <LoaderCircle className="animate-spin" /> : <Send />}</Button>
              </div>
            </form>
          </>}
        </section>
      </div>
    </Card>

    <Dialog open={visualizando !== null} onOpenChange={(open) => { if (!open) setVisualizando(null); }}>
      <DialogContent className="flex h-[88svh] w-[min(72rem,calc(100vw-1rem))] max-w-none flex-col gap-2 p-3 sm:max-w-none">
        <DialogHeader><DialogTitle className="truncate pr-8">{visualizando?.name}</DialogTitle><DialogDescription className="sr-only">Visualização do anexo</DialogDescription></DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">{visualizando ? <VisualizadorArquivo key={visualizando.id} file={visualizando} /> : null}</div>
      </DialogContent>
    </Dialog>
    {canUseLibrary ? <EscolherDaPrancheta aberto={escolherDaPrancheta} onFechar={() => setEscolherDaPrancheta(false)}
      onEscolher={(arquivo) => { setAnexos((atuais) => atuais.some((a) => a.arquivo?.id === arquivo.id) ? atuais : [...atuais, { chave: crypto.randomUUID(), nome: arquivo.name, progresso: 1, arquivo }]); setEscolherDaPrancheta(false); }} /> : null}
  </div>;
}

function EscolherDaPrancheta({ aberto, onFechar, onEscolher }: { aberto: boolean; onFechar: () => void; onEscolher: (arquivo: OrgFileInfo) => void }) {
  return <Dialog open={aberto} onOpenChange={(open) => { if (!open) onFechar(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Anexar da Prancheta</DialogTitle><DialogDescription>O arquivo vai no formato original, sem cópia.</DialogDescription></DialogHeader>
      {aberto ? <ListaDaPrancheta onEscolher={onEscolher} /> : null}
    </DialogContent>
  </Dialog>;
}

// Montada a cada abertura do diálogo: a lista e a busca começam sempre do zero.
function ListaDaPrancheta({ onEscolher }: { onEscolher: (arquivo: OrgFileInfo) => void }) {
  const [arquivos, setArquivos] = useState<OrgFileInfo[] | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  useEffect(() => {
    let vivo = true;
    pedir<{ files: OrgFileInfo[] }>("/api/arquivos").then((r) => { if (vivo) setArquivos(r.files); }).catch((causa) => { if (vivo) setErro(causa instanceof Error ? causa.message : "Não foi possível carregar a Prancheta."); });
    return () => { vivo = false; };
  }, []);
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtrados = (arquivos ?? []).filter((a) => !termo || a.name.toLocaleLowerCase("pt-BR").includes(termo)).slice(0, 100);
  return <>
    <Input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar pelo nome" aria-label="Buscar arquivo" />
    <div className="max-h-80 overflow-y-auto">
      {erro ? <p className="p-3 text-sm" role="alert">{erro}</p> : !arquivos ? <p className="flex items-center gap-2 p-3 text-sm" role="status"><LoaderCircle className="animate-spin" />Carregando…</p>
        : !filtrados.length ? <p className="p-3 text-sm text-hoikos-500">Nenhum arquivo encontrado.</p>
          : <ul className="divide-y">{filtrados.map((a) => <li key={a.id}><button type="button" onClick={() => onEscolher(a)} className="flex w-full items-center gap-2 p-2 text-left text-sm hover:bg-hoikos-50 focus-visible:outline-2">
            <Paperclip className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{a.name}</span><span className="shrink-0 text-xs text-hoikos-500">{sizeLabel(a.sizeBytes)}</span></button></li>)}</ul>}
    </div>
  </>;
}
