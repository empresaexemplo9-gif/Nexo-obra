"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Blinds, Circle, DoorOpen, Download, Eye, EyeOff, Grid2x2, Lamp, LoaderCircle,
  Lock, LockOpen, Minus, MousePointer2, PencilLine, Plug, Redo2, Ruler, Save, Sofa,
  Square, Trash2, Type, Undo2, ZoomIn, ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Camada, Documento, Elemento, FAMILIAS_SIMBOLO, areaM2, camadaBloqueada,
  comprimentoM, disciplinaLabels, elementosVisiveis, encaixar, exportarSvg, glifoDoSimbolo,
  limitesDoElemento, moverElemento, quantitativo, simboloLabels,
} from "@/lib/prancheta";

type Ferramenta =
  | "selecionar" | "parede" | "comodo" | "porta" | "janela" | "passagem"
  | "simbolo" | "mobilia" | "imagem" | "texto" | "cota" | "traco";

type ItemBiblioteca = {
  id: string; nome: string; categoria: string; larguraMm: number | null;
  alturaMm: number | null; desenhavel: boolean; url: string;
};

export type Prancha = {
  id: string; nome: string; especie: string; revisao: number;
  projectId: string | null; projectName: string | null;
  documento: Documento; atualizadoEm: string; autor: string | null;
};

const ferramentas: { id: Ferramenta; rotulo: string; icone: typeof MousePointer2; atalho: string }[] = [
  { id: "selecionar", rotulo: "Selecionar e mover", icone: MousePointer2, atalho: "V" },
  { id: "parede", rotulo: "Parede", icone: Minus, atalho: "P" },
  { id: "comodo", rotulo: "Cômodo", icone: Square, atalho: "C" },
  { id: "porta", rotulo: "Porta", icone: DoorOpen, atalho: "D" },
  { id: "janela", rotulo: "Janela", icone: Blinds, atalho: "J" },
  { id: "passagem", rotulo: "Passagem", icone: Circle, atalho: "G" },
  { id: "simbolo", rotulo: "Ponto elétrico ou luminária", icone: Plug, atalho: "E" },
  { id: "mobilia", rotulo: "Mobília", icone: Sofa, atalho: "M" },
  { id: "imagem", rotulo: "Imagem da biblioteca", icone: Lamp, atalho: "I" },
  { id: "texto", rotulo: "Texto", icone: Type, atalho: "T" },
  { id: "cota", rotulo: "Cota", icone: Ruler, atalho: "K" },
  { id: "traco", rotulo: "Traço livre", icone: PencilLine, atalho: "L" },
];

// A ferramenta decide em que camada o desenho cai. Obrigar a escolher a camada antes de
// cada traço seria burocracia: quem coloca uma tomada está no elétrico por definição.
const camadaDaFerramenta: Record<Ferramenta, string> = {
  selecionar: "layout", parede: "layout", comodo: "layout", porta: "layout",
  janela: "layout", passagem: "layout", simbolo: "eletrico", mobilia: "mobiliario",
  imagem: "mobiliario", texto: "anotacao", cota: "anotacao", traco: "anotacao",
};

const MALHAS = [10, 25, 50, 100, 250, 500];
const ESCALAS = [20, 25, 50, 75, 100, 200];
const LIMITE_HISTORICO = 60;

const metros = (valor: number) => `${valor.toFixed(2).replace(".", ",")} m`;
const metrosQuadrados = (valor: number) => `${valor.toFixed(2).replace(".", ",")} m²`;

function novoId() {
  return globalThis.crypto?.randomUUID?.() ?? `el-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Acerto de clique: o elemento mais acima na ordem de desenho que contém o ponto. Mais
 *  acima primeiro porque é o que a pessoa enxerga — selecionar o que está por baixo de
 *  algo visível é a origem de metade da frustração em editor de desenho. */
function elementoNoPonto(documento: Documento, x: number, y: number): Elemento | null {
  const visiveis = elementosVisiveis(documento);
  for (let i = visiveis.length - 1; i >= 0; i -= 1) {
    const elemento = visiveis[i];
    if (camadaBloqueada(documento, elemento.camada)) continue;
    const caixa = limitesDoElemento(elemento);
    if (x >= caixa.x1 && x <= caixa.x2 && y >= caixa.y1 && y <= caixa.y2) return elemento;
  }
  return null;
}

function Glifo({ familia }: { familia: string }) {
  const glifo = glifoDoSimbolo(familia);
  return <svg viewBox="-450 -450 900 900" className="size-5" aria-hidden="true">
    <path d={glifo.d} fill={glifo.preenchido ? "currentColor" : "none"} stroke="currentColor" strokeWidth={60} />
  </svg>;
}

function DesenhoElemento({ elemento, selecionado }: { elemento: Elemento; selecionado: boolean }) {
  const realce = selecionado ? { stroke: "#846100", strokeWidth: 60, strokeOpacity: 0.35 } : null;
  const giro = "rotacaoGraus" in elemento && elemento.rotacaoGraus
    ? `rotate(${elemento.rotacaoGraus} ${elemento.posicao.x} ${elemento.posicao.y})` : undefined;

  if (elemento.tipo === "parede") {
    return <g>
      {realce && <line x1={elemento.a.x} y1={elemento.a.y} x2={elemento.b.x} y2={elemento.b.y} {...realce} strokeWidth={elemento.espessuraMm + 140} />}
      <line x1={elemento.a.x} y1={elemento.a.y} x2={elemento.b.x} y2={elemento.b.y} stroke="#1C190F" strokeWidth={elemento.espessuraMm} strokeLinecap="square" />
    </g>;
  }
  if (elemento.tipo === "comodo") {
    const pontos = elemento.pontos.map((ponto) => `${ponto.x},${ponto.y}`).join(" ");
    const centro = elemento.pontos.reduce((soma, ponto) => ({
      x: soma.x + ponto.x / elemento.pontos.length, y: soma.y + ponto.y / elemento.pontos.length,
    }), { x: 0, y: 0 });
    return <g>
      <polygon points={pontos} fill="#B5B19E" fillOpacity={selecionado ? 0.34 : 0.18} stroke="#846100" strokeWidth={selecionado ? 50 : 20} />
      {elemento.nome && <>
        <text x={centro.x} y={centro.y} fontSize={220} textAnchor="middle" fill="#38301B">{elemento.nome}</text>
        <text x={centro.x} y={centro.y + 260} fontSize={170} textAnchor="middle" fill="#846100">{metrosQuadrados(areaM2(elemento.pontos))}</text>
      </>}
    </g>;
  }
  if (elemento.tipo === "abertura") {
    const meia = elemento.larguraMm / 2;
    return <g transform={giro} stroke={selecionado ? "#846100" : "#38301B"}>
      {elemento.especie === "porta"
        ? <path d={`M ${elemento.posicao.x - meia} ${elemento.posicao.y} l ${elemento.larguraMm} 0 m ${-elemento.larguraMm} 0 a ${elemento.larguraMm} ${elemento.larguraMm} 0 0 1 ${elemento.larguraMm} ${elemento.larguraMm}`} fill="none" strokeWidth={40} />
        : <line x1={elemento.posicao.x - meia} y1={elemento.posicao.y} x2={elemento.posicao.x + meia} y2={elemento.posicao.y}
            strokeWidth={elemento.especie === "janela" ? 60 : 40} strokeDasharray={elemento.especie === "passagem" ? "180 120" : undefined} />}
    </g>;
  }
  if (elemento.tipo === "simbolo") {
    const glifo = glifoDoSimbolo(elemento.familia);
    return <g transform={giro}>
      <g transform={`translate(${elemento.posicao.x} ${elemento.posicao.y})`}>
        {selecionado && <circle r={420} fill="#846100" fillOpacity={0.14} />}
        <path d={glifo.d} fill={glifo.preenchido ? "#846100" : "none"} stroke="#846100" strokeWidth={35} />
      </g>
    </g>;
  }
  if (elemento.tipo === "mobilia") {
    return <g transform={giro}>
      <rect x={elemento.posicao.x - elemento.larguraMm / 2} y={elemento.posicao.y - elemento.alturaMm / 2}
        width={elemento.larguraMm} height={elemento.alturaMm} rx={40}
        fill="#F4F2E9" stroke={selecionado ? "#846100" : "#38301B"} strokeWidth={selecionado ? 60 : 25} />
      <text x={elemento.posicao.x} y={elemento.posicao.y + 60} fontSize={150} textAnchor="middle" fill="#38301B">{elemento.rotulo}</text>
    </g>;
  }
  if (elemento.tipo === "imagem") {
    return <g transform={giro}>
      <image href={elemento.chave} x={elemento.posicao.x - elemento.larguraMm / 2} y={elemento.posicao.y - elemento.alturaMm / 2}
        width={elemento.larguraMm} height={elemento.alturaMm} preserveAspectRatio="xMidYMid slice" />
      {selecionado && <rect x={elemento.posicao.x - elemento.larguraMm / 2} y={elemento.posicao.y - elemento.alturaMm / 2}
        width={elemento.larguraMm} height={elemento.alturaMm} fill="none" stroke="#846100" strokeWidth={60} />}
    </g>;
  }
  if (elemento.tipo === "texto") {
    return <g transform={giro}>
      <text x={elemento.posicao.x} y={elemento.posicao.y} fontSize={elemento.alturaMm} fill={selecionado ? "#846100" : "#1C190F"}>{elemento.texto}</text>
    </g>;
  }
  if (elemento.tipo === "cota") {
    const meio = { x: (elemento.a.x + elemento.b.x) / 2, y: (elemento.a.y + elemento.b.y) / 2 + elemento.deslocamentoMm };
    return <g stroke="#846100" strokeWidth={selecionado ? 40 : 18} fill="none">
      <line x1={elemento.a.x} y1={elemento.a.y + elemento.deslocamentoMm} x2={elemento.b.x} y2={elemento.b.y + elemento.deslocamentoMm} />
      <line x1={elemento.a.x} y1={elemento.a.y} x2={elemento.a.x} y2={elemento.a.y + elemento.deslocamentoMm} />
      <line x1={elemento.b.x} y1={elemento.b.y} x2={elemento.b.x} y2={elemento.b.y + elemento.deslocamentoMm} />
      <text x={meio.x} y={meio.y - 80} fontSize={180} textAnchor="middle" fill="#846100" stroke="none">{metros(comprimentoM(elemento.a, elemento.b))}</text>
    </g>;
  }
  return <polyline points={elemento.pontos.map((ponto) => `${ponto.x},${ponto.y}`).join(" ")} fill="none"
    stroke={selecionado ? "#846100" : "#1C190F"} strokeWidth={elemento.espessuraMm} strokeLinecap="round" strokeLinejoin="round" />;
}

export function PranchetaEditor({ prancha, canEdit, onVoltar, onSalvo }: {
  prancha: Prancha; canEdit: boolean; onVoltar: () => void;
  onSalvo: (atualizada: Prancha) => void;
}) {
  const [documento, definirDocumento] = useState<Documento>(prancha.documento);
  const [revisao, definirRevisao] = useState(prancha.revisao);
  const [nome, definirNome] = useState(prancha.nome);
  const [ferramenta, definirFerramenta] = useState<Ferramenta>("selecionar");
  const [familia, definirFamilia] = useState<string>("tomada-media");
  const [itemImagem, definirItemImagem] = useState<ItemBiblioteca | null>(null);
  const [biblioteca, definirBiblioteca] = useState<ItemBiblioteca[]>([]);
  const [selecao, definirSelecao] = useState<string | null>(null);
  const [pendentes, definirPendentes] = useState<{ x: number; y: number }[]>([]);
  const [cursor, definirCursor] = useState<{ x: number; y: number } | null>(null);
  const [vista, definirVista] = useState({ x: -2000, y: -2000, largura: 24000 });
  const [historico, definirHistorico] = useState<Documento[]>([]);
  const [refeitos, definirRefeitos] = useState<Documento[]>([]);
  const [sujo, definirSujo] = useState(false);
  const [salvando, definirSalvando] = useState(false);
  const [conflito, definirConflito] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const arrastando = useRef<{ id: string; de: { x: number; y: number } } | null>(null);
  const panorama = useRef<{ x: number; y: number; vista: { x: number; y: number } } | null>(null);

  const camadaAtiva = camadaDaFerramenta[ferramenta];
  const bloqueada = camadaBloqueada(documento, camadaAtiva);
  const podeDesenhar = canEdit && !bloqueada;
  const selecionado = useMemo(() => documento.elementos.find((elemento) => elemento.id === selecao) ?? null, [documento, selecao]);
  const resumo = useMemo(() => quantitativo(documento), [documento]);
  const visiveis = useMemo(() => elementosVisiveis(documento), [documento]);

  const aplicar = useCallback((proximo: Documento) => {
    definirHistorico((anterior) => [...anterior, documento].slice(-LIMITE_HISTORICO));
    definirRefeitos([]);
    definirDocumento(proximo);
    definirSujo(true);
  }, [documento]);

  const acrescentar = useCallback((elemento: Elemento) => {
    aplicar({ ...documento, elementos: [...documento.elementos, elemento] });
  }, [aplicar, documento]);

  const trocar = useCallback((id: string, mudanca: Partial<Elemento>) => {
    aplicar({
      ...documento,
      elementos: documento.elementos.map((elemento) => elemento.id === id ? { ...elemento, ...mudanca } as Elemento : elemento),
    });
  }, [aplicar, documento]);

  const apagar = useCallback((id: string) => {
    aplicar({ ...documento, elementos: documento.elementos.filter((elemento) => elemento.id !== id) });
    definirSelecao(null);
  }, [aplicar, documento]);

  const desfazer = useCallback(() => {
    definirHistorico((anterior) => {
      if (!anterior.length) return anterior;
      const ultimo = anterior[anterior.length - 1];
      definirRefeitos((refazer) => [...refazer, documento].slice(-LIMITE_HISTORICO));
      definirDocumento(ultimo);
      definirSujo(true);
      definirSelecao(null);
      return anterior.slice(0, -1);
    });
  }, [documento]);

  const refazer = useCallback(() => {
    definirRefeitos((anterior) => {
      if (!anterior.length) return anterior;
      const proximo = anterior[anterior.length - 1];
      definirHistorico((historia) => [...historia, documento].slice(-LIMITE_HISTORICO));
      definirDocumento(proximo);
      definirSujo(true);
      return anterior.slice(0, -1);
    });
  }, [documento]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const resposta = await fetch("/api/studio/assets", { cache: "no-store" }).catch(() => null);
      if (!vivo || !resposta?.ok) return;
      const corpo = await resposta.json().catch(() => ({ itens: [] })) as { itens: ItemBiblioteca[] };
      definirBiblioteca(corpo.itens.filter((item) => item.desenhavel));
    })();
    return () => { vivo = false; };
  }, []);

  // Sair com desenho não gravado é perda de trabalho, não de rascunho. O aviso do
  // navegador é o único que funciona quando a pessoa fecha a aba.
  useEffect(() => {
    if (!sujo) return;
    const aviso = (evento: BeforeUnloadEvent) => { evento.preventDefault(); };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  const paraMilimetros = useCallback((evento: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const matriz = svg.getScreenCTM();
    if (!matriz) return null;
    const ponto = new DOMPoint(evento.clientX, evento.clientY).matrixTransform(matriz.inverse());
    return { x: Math.round(ponto.x), y: Math.round(ponto.y) };
  }, []);

  const encaixado = useCallback((ponto: { x: number; y: number }) => ({
    x: encaixar(ponto.x, documento.malhaMm), y: encaixar(ponto.y, documento.malhaMm),
  }), [documento.malhaMm]);

  function colocar(ponto: { x: number; y: number }) {
    const base = { id: novoId(), camada: camadaAtiva };
    if (ferramenta === "porta" || ferramenta === "janela" || ferramenta === "passagem") {
      acrescentar({ ...base, tipo: "abertura", especie: ferramenta, posicao: ponto,
        larguraMm: ferramenta === "janela" ? 1200 : 800, rotacaoGraus: 0 });
      return;
    }
    if (ferramenta === "simbolo") {
      acrescentar({ ...base, camada: FAMILIAS_SIMBOLO.eletrico.includes(familia as never) ? "eletrico" : "luminotecnico",
        tipo: "simbolo", familia, posicao: ponto, rotacaoGraus: 0 });
      return;
    }
    if (ferramenta === "mobilia") {
      acrescentar({ ...base, tipo: "mobilia", posicao: ponto, larguraMm: 1800, alturaMm: 900, rotacaoGraus: 0, rotulo: "Móvel" });
      return;
    }
    if (ferramenta === "imagem") {
      if (!itemImagem) { toast.error("Escolha uma imagem da biblioteca antes de colocá-la na prancha."); return; }
      acrescentar({ ...base, tipo: "imagem", posicao: ponto,
        larguraMm: itemImagem.larguraMm ?? 2000, alturaMm: itemImagem.alturaMm ?? 1500,
        rotacaoGraus: 0, chave: itemImagem.url, rotulo: itemImagem.nome.slice(0, 60) });
      return;
    }
    if (ferramenta === "texto") {
      acrescentar({ ...base, tipo: "texto", posicao: ponto, texto: "Anotação", alturaMm: 250, rotacaoGraus: 0 });
    }
  }

  function aoApontar(evento: React.PointerEvent<SVGSVGElement>) {
    if (evento.button === 1 || evento.button === 2 || evento.shiftKey) {
      panorama.current = { x: evento.clientX, y: evento.clientY, vista: { x: vista.x, y: vista.y } };
      (evento.target as Element).setPointerCapture?.(evento.pointerId);
      return;
    }
    const bruto = paraMilimetros(evento);
    if (!bruto) return;
    const ponto = encaixado(bruto);

    if (ferramenta === "selecionar") {
      const alvo = elementoNoPonto(documento, bruto.x, bruto.y);
      definirSelecao(alvo?.id ?? null);
      if (alvo && canEdit) {
        arrastando.current = { id: alvo.id, de: ponto };
        (evento.target as Element).setPointerCapture?.(evento.pointerId);
      }
      return;
    }
    if (!podeDesenhar) {
      toast.error(bloqueada ? "A camada desta ferramenta está travada. Destrave-a no painel de camadas." : "Você não tem permissão para editar esta prancha.");
      return;
    }
    if (ferramenta === "parede" || ferramenta === "cota") {
      if (!pendentes.length) { definirPendentes([ponto]); return; }
      const inicio = pendentes[0];
      if (inicio.x === ponto.x && inicio.y === ponto.y) { definirPendentes([]); return; }
      if (ferramenta === "parede") {
        acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "parede", a: inicio, b: ponto, espessuraMm: 150 });
        // Encadear: a próxima parede começa onde esta terminou, que é como se desenha
        // um cômodo sem reclicar em cada canto.
        definirPendentes([ponto]);
      } else {
        acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "cota", a: inicio, b: ponto, deslocamentoMm: 400 });
        definirPendentes([]);
      }
      return;
    }
    if (ferramenta === "comodo") {
      definirPendentes((anterior) => [...anterior, ponto]);
      return;
    }
    if (ferramenta === "traco") {
      definirPendentes([ponto]);
      (evento.target as Element).setPointerCapture?.(evento.pointerId);
      return;
    }
    colocar(ponto);
  }

  function aoMover(evento: React.PointerEvent<SVGSVGElement>) {
    if (panorama.current) {
      const svg = svgRef.current;
      const escala = svg ? vista.largura / svg.getBoundingClientRect().width : 1;
      definirVista((anterior) => ({
        ...anterior,
        x: panorama.current!.vista.x - (evento.clientX - panorama.current!.x) * escala,
        y: panorama.current!.vista.y - (evento.clientY - panorama.current!.y) * escala,
      }));
      return;
    }
    const bruto = paraMilimetros(evento);
    if (!bruto) return;
    const ponto = encaixado(bruto);
    definirCursor(ponto);

    if (arrastando.current) {
      const { id, de } = arrastando.current;
      if (de.x === ponto.x && de.y === ponto.y) return;
      const elemento = documento.elementos.find((item) => item.id === id);
      if (!elemento) return;
      // O arrasto altera sem empilhar histórico a cada pixel: o ponto de desfazer é o
      // começo do arrasto, não cada quadro dele.
      definirDocumento((anterior) => ({
        ...anterior,
        elementos: anterior.elementos.map((item) => item.id === id
          ? moverElemento(item, ponto.x - de.x, ponto.y - de.y, anterior.malhaMm) : item),
      }));
      definirSujo(true);
      arrastando.current = { id, de: ponto };
      return;
    }
    if (ferramenta === "traco" && pendentes.length && evento.buttons === 1) {
      definirPendentes((anterior) => anterior.length < 2000 ? [...anterior, ponto] : anterior);
    }
  }

  function aoSoltar() {
    if (panorama.current) { panorama.current = null; return; }
    if (arrastando.current) {
      arrastando.current = null;
      definirHistorico((anterior) => anterior.slice(-LIMITE_HISTORICO));
      return;
    }
    if (ferramenta === "traco" && pendentes.length > 1) {
      acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "traco", pontos: pendentes, espessuraMm: 30 });
      definirPendentes([]);
    }
  }

  function fecharComodo() {
    if (pendentes.length < 3) { toast.error("Um cômodo precisa de pelo menos três cantos."); return; }
    acrescentar({ id: novoId(), camada: "layout", tipo: "comodo", pontos: pendentes, nome: "Cômodo" });
    definirPendentes([]);
  }

  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      const alvo = evento.target as HTMLElement | null;
      if (alvo && ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName)) return;
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "z") {
        evento.preventDefault();
        if (evento.shiftKey) refazer(); else desfazer();
        return;
      }
      if (evento.key === "Escape") { definirPendentes([]); definirSelecao(null); return; }
      if (evento.key === "Enter" && ferramenta === "comodo") { evento.preventDefault(); fecharComodo(); return; }
      if ((evento.key === "Delete" || evento.key === "Backspace") && selecao && canEdit) {
        evento.preventDefault(); apagar(selecao); return;
      }
      const escolhida = ferramentas.find((item) => item.atalho.toLowerCase() === evento.key.toLowerCase());
      if (escolhida) { definirFerramenta(escolhida.id); definirPendentes([]); }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  function ampliar(fator: number) {
    definirVista((anterior) => {
      const largura = Math.min(400000, Math.max(800, Math.round(anterior.largura * fator)));
      const centro = { x: anterior.x + anterior.largura / 2, y: anterior.y + anterior.largura / 2 };
      return { x: Math.round(centro.x - largura / 2), y: Math.round(centro.y - largura / 2), largura };
    });
  }

  function trocarCamada(id: string, mudanca: Partial<Camada>) {
    definirDocumento((anterior) => ({
      ...anterior,
      camadas: anterior.camadas.map((camada) => camada.id === id ? { ...camada, ...mudanca } : camada),
    }));
    definirSujo(true);
  }

  async function salvar() {
    if (!canEdit) return;
    definirSalvando(true); definirConflito(false);
    try {
      const resposta = await fetch(`/api/studio/${prancha.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento, revisao, nome }),
      });
      const corpo = await resposta.json().catch(() => ({})) as { prancha?: Prancha; error?: string; code?: string };
      if (!resposta.ok) {
        if (corpo.code === "revision_conflict") definirConflito(true);
        throw new Error(corpo.error ?? "Não foi possível gravar a prancha.");
      }
      definirRevisao(corpo.prancha!.revisao);
      definirSujo(false);
      definirHistorico([]); definirRefeitos([]);
      onSalvo(corpo.prancha!);
      toast.success(`Prancha gravada — revisão ${corpo.prancha!.revisao}.`);
    } catch (causa) {
      toast.error(causa instanceof Error ? causa.message : "Não foi possível gravar a prancha.");
    } finally {
      definirSalvando(false);
    }
  }

  function exportar() {
    const conteudo = exportarSvg(documento, { titulo: nome, origem: window.location.origin });
    const url = URL.createObjectURL(new Blob([conteudo], { type: "image/svg+xml" }));
    const ligacao = document.createElement("a");
    ligacao.href = url;
    ligacao.download = `${nome.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "prancha"}.svg`;
    ligacao.click();
    URL.revokeObjectURL(url);
  }

  const passoMalha = documento.malhaMm * (vista.largura > 40000 ? 10 : vista.largura > 12000 ? 5 : 1);

  return <div className="prancheta space-y-4">
    <header className="prancheta-barra flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onVoltar}><ArrowLeft />Pranchas</Button>
      <Input value={nome} onChange={(evento) => { definirNome(evento.target.value); definirSujo(true); }}
        disabled={!canEdit} aria-label="Nome da prancha" className="h-10 w-full max-w-72" />
      <span className="text-xs text-hoikos-500">Revisão {revisao}{sujo ? " · alterações não gravadas" : ""}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={desfazer} disabled={!historico.length} aria-label="Desfazer"><Undo2 />Desfazer</Button>
        <Button variant="outline" size="sm" onClick={refazer} disabled={!refeitos.length} aria-label="Refazer"><Redo2 />Refazer</Button>
        <Button variant="outline" size="sm" onClick={exportar}><Download />Exportar SVG</Button>
        {canEdit && <Button size="sm" onClick={() => void salvar()} disabled={salvando || !sujo}>
          {salvando ? <LoaderCircle className="animate-spin" /> : <Save />}Gravar
        </Button>}
      </div>
    </header>

    {conflito && <p role="alert" className="rounded-md border border-hoikos-gold bg-hoikos-50 px-4 py-3 text-sm text-hoikos-800">
      Esta prancha foi alterada em outro lugar depois que você abriu. Exporte o seu desenho antes de recarregar, para não perder o que fez aqui.
    </p>}

    <div className="prancheta-area grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)_20rem]">
      <aside className="prancheta-ferramentas space-y-3">
        <div className="grid grid-cols-4 gap-1 xl:grid-cols-3">
          {ferramentas.map((item) => <button key={item.id} type="button"
            onClick={() => { definirFerramenta(item.id); definirPendentes([]); }}
            aria-pressed={ferramenta === item.id} aria-label={`${item.rotulo} (${item.atalho})`} title={`${item.rotulo} — tecla ${item.atalho}`}
            className="grid h-11 place-items-center rounded-md border border-hoikos-200 bg-white text-hoikos-700 aria-pressed:border-hoikos-800 aria-pressed:bg-hoikos-800 aria-pressed:text-white">
            <item.icone className="size-4" />
          </button>)}
        </div>
        <p className="text-xs leading-5 text-hoikos-500">{ferramentas.find((item) => item.id === ferramenta)?.rotulo}</p>

        {ferramenta === "simbolo" && <div className="space-y-2">
          {Object.entries(FAMILIAS_SIMBOLO).map(([disciplina, familias]) => <div key={disciplina}>
            <p className="eyebrow text-hoikos-600">{disciplinaLabels[disciplina as keyof typeof disciplinaLabels]}</p>
            <div className="mt-1 grid grid-cols-4 gap-1 xl:grid-cols-3">
              {familias.map((item) => <button key={item} type="button" onClick={() => definirFamilia(item)}
                aria-pressed={familia === item} aria-label={simboloLabels[item]} title={simboloLabels[item]}
                className="grid h-10 place-items-center rounded-md border border-hoikos-200 bg-white text-hoikos-700 aria-pressed:border-hoikos-gold aria-pressed:text-hoikos-gold">
                <Glifo familia={item} />
              </button>)}
            </div>
          </div>)}
        </div>}

        {ferramenta === "imagem" && <div className="space-y-2">
          <p className="eyebrow text-hoikos-600">Biblioteca</p>
          {biblioteca.length ? <div className="grid max-h-64 grid-cols-3 gap-1 overflow-y-auto xl:grid-cols-2">
            {biblioteca.map((item) => <button key={item.id} type="button" onClick={() => definirItemImagem(item)}
              aria-pressed={itemImagem?.id === item.id} title={item.nome}
              className="overflow-hidden rounded-md border border-hoikos-200 aria-pressed:border-hoikos-gold">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.url} alt={item.nome} className="aspect-square w-full object-cover" />
            </button>)}
          </div> : <p className="text-xs text-hoikos-500">Nenhuma imagem na biblioteca. Envie mobiliário, texturas ou referências na aba Biblioteca.</p>}
        </div>}

        {ferramenta === "comodo" && pendentes.length > 0 && <Button size="sm" className="w-full" onClick={fecharComodo}>
          Fechar cômodo ({pendentes.length} cantos)
        </Button>}

        <div className="space-y-2 border-t border-hoikos-200 pt-3">
          <Label htmlFor="prancheta-malha" className="text-xs">Malha de encaixe</Label>
          <NativeSelect id="prancheta-malha" value={String(documento.malhaMm)}
            onChange={(evento) => { definirDocumento((anterior) => ({ ...anterior, malhaMm: Number(evento.target.value) })); definirSujo(true); }}>
            {MALHAS.map((malha) => <option key={malha} value={malha}>{malha} mm</option>)}
          </NativeSelect>
          <Label htmlFor="prancheta-escala" className="text-xs">Escala de impressão</Label>
          <NativeSelect id="prancheta-escala" value={String(documento.escala)}
            onChange={(evento) => { definirDocumento((anterior) => ({ ...anterior, escala: Number(evento.target.value) })); definirSujo(true); }}>
            {ESCALAS.map((escala) => <option key={escala} value={escala}>1:{escala}</option>)}
          </NativeSelect>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => ampliar(0.8)} aria-label="Aproximar"><ZoomIn /></Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => ampliar(1.25)} aria-label="Afastar"><ZoomOut /></Button>
          </div>
        </div>
      </aside>

      <div className="prancheta-mesa overflow-hidden rounded-md border border-hoikos-200 bg-white">
        <svg ref={svgRef} role="application" aria-label={`Prancha ${nome}`}
          viewBox={`${vista.x} ${vista.y} ${vista.largura} ${vista.largura * 0.62}`}
          className="h-[min(70svh,640px)] w-full touch-none"
          onPointerDown={aoApontar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerLeave={() => definirCursor(null)}
          onContextMenu={(evento) => evento.preventDefault()}>
          <defs>
            <pattern id="prancheta-malha-padrao" width={passoMalha} height={passoMalha} patternUnits="userSpaceOnUse">
              <path d={`M ${passoMalha} 0 L 0 0 0 ${passoMalha}`} fill="none" stroke="#B5B19E" strokeOpacity={0.5} strokeWidth={passoMalha / 60} />
            </pattern>
          </defs>
          <rect x={vista.x} y={vista.y} width={vista.largura} height={vista.largura} fill="url(#prancheta-malha-padrao)" />
          {documento.fundo && <image href={documento.fundo.chave} x={0} y={0}
            width={documento.fundo.larguraMm} height={documento.fundo.alturaMm}
            opacity={documento.fundo.opacidade / 100} preserveAspectRatio="xMidYMid meet" />}
          {visiveis.map((elemento) => <DesenhoElemento key={elemento.id} elemento={elemento} selecionado={elemento.id === selecao} />)}
          {pendentes.length > 0 && <polyline
            points={[...pendentes, ...(cursor ? [cursor] : [])].map((ponto) => `${ponto.x},${ponto.y}`).join(" ")}
            fill="none" stroke="#846100" strokeWidth={60} strokeDasharray="200 140" />}
          {cursor && ferramenta !== "selecionar" && <circle cx={cursor.x} cy={cursor.y} r={vista.largura / 160} fill="#846100" />}
        </svg>
        <p className="flex flex-wrap items-center gap-3 border-t border-hoikos-200 px-3 py-2 text-xs text-hoikos-500">
          <Grid2x2 aria-hidden="true" className="size-3.5" />
          {cursor ? `${(cursor.x / 1000).toFixed(2).replace(".", ",")} m · ${(cursor.y / 1000).toFixed(2).replace(".", ",")} m` : "Mova o cursor sobre a prancha"}
          <span>Arraste com Shift ou com o botão direito para deslocar a vista.</span>
        </p>
      </div>

      <aside className="prancheta-painel">
        <Tabs defaultValue="propriedades">
          <TabsList>
            <TabsTrigger value="propriedades">Seleção</TabsTrigger>
            <TabsTrigger value="camadas">Camadas</TabsTrigger>
            <TabsTrigger value="quantitativo">Quantitativo</TabsTrigger>
          </TabsList>

          <TabsContent value="propriedades" className="space-y-3 pt-3">
            {!selecionado ? <p className="text-sm text-hoikos-500">Nada selecionado. Use a ferramenta de seleção e clique sobre um elemento do desenho.</p> : <>
              <p className="eyebrow text-hoikos-600">{selecionado.tipo}</p>
              {"rotulo" in selecionado && <div className="space-y-1">
                <Label htmlFor="prop-rotulo" className="text-xs">Rótulo</Label>
                <Input id="prop-rotulo" value={selecionado.rotulo ?? ""} disabled={!canEdit}
                  onChange={(evento) => trocar(selecionado.id, { rotulo: evento.target.value.slice(0, 60) } as Partial<Elemento>)} />
              </div>}
              {selecionado.tipo === "comodo" && <div className="space-y-1">
                <Label htmlFor="prop-nome" className="text-xs">Nome do cômodo</Label>
                <Input id="prop-nome" value={selecionado.nome} disabled={!canEdit}
                  onChange={(evento) => trocar(selecionado.id, { nome: evento.target.value.slice(0, 60) } as Partial<Elemento>)} />
                <p className="text-xs text-hoikos-500">Área {metrosQuadrados(areaM2(selecionado.pontos))} — calculada do desenho, não digitada.</p>
              </div>}
              {selecionado.tipo === "texto" && <div className="space-y-1">
                <Label htmlFor="prop-texto" className="text-xs">Texto</Label>
                <Input id="prop-texto" value={selecionado.texto} disabled={!canEdit}
                  onChange={(evento) => trocar(selecionado.id, { texto: evento.target.value.slice(0, 500) || " " } as Partial<Elemento>)} />
              </div>}
              {"larguraMm" in selecionado && <div className="space-y-1">
                <Label htmlFor="prop-largura" className="text-xs">Largura (mm)</Label>
                <Input id="prop-largura" type="number" inputMode="numeric" value={selecionado.larguraMm} disabled={!canEdit}
                  onChange={(evento) => {
                    const valor = Math.round(Number(evento.target.value));
                    if (Number.isFinite(valor) && valor >= 10) trocar(selecionado.id, { larguraMm: valor } as Partial<Elemento>);
                  }} />
              </div>}
              {"alturaMm" in selecionado && <div className="space-y-1">
                <Label htmlFor="prop-altura" className="text-xs">{selecionado.tipo === "texto" ? "Corpo do texto (mm)" : "Profundidade (mm)"}</Label>
                <Input id="prop-altura" type="number" inputMode="numeric" value={selecionado.alturaMm} disabled={!canEdit}
                  onChange={(evento) => {
                    const valor = Math.round(Number(evento.target.value));
                    if (Number.isFinite(valor) && valor >= 10) trocar(selecionado.id, { alturaMm: valor } as Partial<Elemento>);
                  }} />
              </div>}
              {"espessuraMm" in selecionado && <div className="space-y-1">
                <Label htmlFor="prop-espessura" className="text-xs">Espessura (mm)</Label>
                <Input id="prop-espessura" type="number" inputMode="numeric" value={selecionado.espessuraMm} disabled={!canEdit}
                  onChange={(evento) => {
                    const valor = Math.round(Number(evento.target.value));
                    if (Number.isFinite(valor) && valor >= 1) trocar(selecionado.id, { espessuraMm: valor } as Partial<Elemento>);
                  }} />
              </div>}
              {"rotacaoGraus" in selecionado && <div className="space-y-1">
                <Label htmlFor="prop-giro" className="text-xs">Giro (graus)</Label>
                <Input id="prop-giro" type="number" inputMode="numeric" min={0} max={359} value={selecionado.rotacaoGraus} disabled={!canEdit}
                  onChange={(evento) => {
                    const valor = Math.round(Number(evento.target.value));
                    if (Number.isFinite(valor)) trocar(selecionado.id, { rotacaoGraus: ((valor % 360) + 360) % 360 } as Partial<Elemento>);
                  }} />
              </div>}
              {selecionado.tipo === "parede" && <p className="text-xs text-hoikos-500">Comprimento {metros(comprimentoM(selecionado.a, selecionado.b))}.</p>}
              {canEdit && <Button variant="outline" size="sm" onClick={() => apagar(selecionado.id)}><Trash2 />Apagar elemento</Button>}
            </>}
          </TabsContent>

          <TabsContent value="camadas" className="space-y-2 pt-3">
            {documento.camadas.map((camada) => {
              const quantos = documento.elementos.filter((elemento) => elemento.camada === camada.id).length;
              return <div key={camada.id} className="flex items-center gap-2 rounded-md border border-hoikos-200 bg-white px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-hoikos-800">{camada.nome}</p>
                  <p className="text-xs text-hoikos-500">{quantos} elemento{quantos === 1 ? "" : "s"}</p>
                </div>
                <button type="button" onClick={() => trocarCamada(camada.id, { visivel: !camada.visivel })}
                  aria-label={`${camada.visivel ? "Esconder" : "Mostrar"} ${camada.nome}`}
                  className="grid size-8 place-items-center rounded-md text-hoikos-600 hover:bg-hoikos-50">
                  {camada.visivel ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </button>
                <button type="button" onClick={() => trocarCamada(camada.id, { bloqueada: !camada.bloqueada })}
                  aria-label={`${camada.bloqueada ? "Destravar" : "Travar"} ${camada.nome}`}
                  className="grid size-8 place-items-center rounded-md text-hoikos-600 hover:bg-hoikos-50">
                  {camada.bloqueada ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
                </button>
              </div>;
            })}
            <p className="text-xs leading-5 text-hoikos-500">
              Esconder é visualização, não exclusão: a camada escondida sai da tela e do arquivo exportado, e continua contando no quantitativo.
            </p>
          </TabsContent>

          <TabsContent value="quantitativo" className="space-y-3 pt-3">
            <div className="rounded-md border border-hoikos-200 bg-white px-3 py-2">
              <p className="eyebrow text-hoikos-600">Área construída desenhada</p>
              <p className="metric-number text-2xl text-hoikos-950">{metrosQuadrados(resumo.areaTotalM2)}</p>
              <p className="text-xs text-hoikos-500">{metros(resumo.paredesM)} de parede</p>
            </div>
            {resumo.comodos.length > 0 && <div>
              <p className="eyebrow text-hoikos-600">Cômodos</p>
              <ul className="mt-1 space-y-1 text-sm">
                {resumo.comodos.map((comodo, indice) => <li key={`${comodo.nome}-${indice}`} className="flex justify-between gap-2 border-b border-hoikos-100 py-1">
                  <span className="truncate text-hoikos-700">{comodo.nome}</span>
                  <span className="shrink-0 text-hoikos-500">{metrosQuadrados(comodo.areaM2)}</span>
                </li>)}
              </ul>
            </div>}
            {resumo.porDisciplina.map((linha) => <div key={linha.disciplina}>
              <p className="eyebrow text-hoikos-600">{disciplinaLabels[linha.disciplina]}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {Object.entries(linha.simbolos).map(([nomeFamilia, contagem]) => <li key={nomeFamilia} className="flex justify-between gap-2 border-b border-hoikos-100 py-1">
                  <span className="truncate text-hoikos-700">{simboloLabels[nomeFamilia] ?? nomeFamilia}</span>
                  <span className="shrink-0 text-hoikos-500">{contagem}</span>
                </li>)}
              </ul>
            </div>)}
            {!resumo.comodos.length && !resumo.porDisciplina.length && !resumo.paredesM &&
              <p className="text-sm text-hoikos-500">O quantitativo sai do desenho. Comece pelas paredes e pelos cômodos.</p>}
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  </div>;
}
