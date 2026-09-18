"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Blinds, Circle, CircleDashed, DoorOpen, Download, Eye, EyeOff, Grid2x2, Lamp, LoaderCircle,
  Lock, LockOpen, Minus, MousePointer2, PencilLine, Plug, Redo2, Ruler, Save, Sofa,
  Copy, FlipHorizontal2, Grid3x3, Magnet, MoveHorizontal, Scissors, Spline, Square,
  Trash2, Type, Undo2, Upload, ZoomIn, ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { exportarDxf } from "@/lib/integrations/dxf";
import { conferir } from "@/lib/parametros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Encaixe, TIPOS_ENCAIXE, TipoEncaixe, encaixeLabels, encaixePerto, moverVertice,
  aparar, espelhar, estender, lerMedida, matrizRetangular, ortogonal, paralelaDe,
  resolverEntrada, segmentosDo, verticesDe,
} from "@/lib/prancheta-cad";
import {
  Camada, Documento, Elemento, FAMILIAS_SIMBOLO, areaM2, camadaBloqueada,
  comprimentoM, disciplinaLabels, elementosVisiveis, encaixar, exportarSvg, glifoDoSimbolo,
  pontosDoArco,
  limitesDoElemento, moverElemento, quantitativo, simboloLabels,
} from "@/lib/prancheta";

type Ferramenta =
  | "selecionar" | "parede" | "comodo" | "porta" | "janela" | "passagem"
  | "simbolo" | "mobilia" | "imagem" | "texto" | "cota" | "traco"
  | "circulo" | "arco" | "espelhar" | "aparar" | "estender";

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
  { id: "circulo", rotulo: "Círculo — centro e depois raio", icone: CircleDashed, atalho: "R" },
  { id: "arco", rotulo: "Arco — centro, início e fim", icone: Spline, atalho: "A" },
  { id: "espelhar", rotulo: "Espelhar a seleção — marque os dois pontos do eixo", icone: FlipHorizontal2, atalho: "H" },
  { id: "aparar", rotulo: "Aparar — clique no pedaço que deve sumir", icone: Scissors, atalho: "X" },
  { id: "estender", rotulo: "Estender — clique na ponta que deve crescer", icone: MoveHorizontal, atalho: "N" },
];

// A ferramenta decide em que camada o desenho cai. Obrigar a escolher a camada antes de
// cada traço seria burocracia: quem coloca uma tomada está no elétrico por definição.
const camadaDaFerramenta: Record<Ferramenta, string> = {
  selecionar: "layout", parede: "layout", comodo: "layout", porta: "layout",
  janela: "layout", passagem: "layout", simbolo: "eletrico", mobilia: "mobiliario",
  imagem: "mobiliario", texto: "anotacao", cota: "anotacao", traco: "anotacao",
  circulo: "layout", arco: "layout", espelhar: "layout", aparar: "layout", estender: "layout",
};

type Importado = {
  nomeArquivo: string; unidade: string; unidadeDeclarada: boolean;
  camadas: Camada[]; elementos: Elemento[]; avisos: string[]; truncado: boolean;
};

const UNIDADES_ROTULO: Record<string, string> = {
  mm: "Milímetro", cm: "Centímetro", m: "Metro", polegada: "Polegada", pe: "Pé",
};

const MALHAS = [10, 25, 50, 100, 250, 500];
const ESCALAS = [20, 25, 50, 75, 100, 200];
const LIMITE_HISTORICO = 60;

const metros = (valor: number) => `${valor.toFixed(2).replace(".", ",")} m`;
const metrosQuadrados = (valor: number) => `${valor.toFixed(2).replace(".", ",")} m²`;

/** Altura do fundo pela proporção real da imagem. Esticar a planta escaneada para uma
 *  proporção inventada é pior do que não ter fundo nenhum: tudo que for traçado por cima
 *  sai com a medida errada, e o erro só aparece na obra. */
function alturaPelaProporcao(url: string, larguraMm: number): Promise<number> {
  return new Promise((resolver, rejeitar) => {
    const imagem = new Image();
    imagem.onload = () => {
      if (!imagem.naturalWidth || !imagem.naturalHeight) { rejeitar(new Error("sem proporção")); return; }
      resolver(Math.max(1, Math.round(larguraMm * imagem.naturalHeight / imagem.naturalWidth)));
    };
    imagem.onerror = () => rejeitar(new Error("não abriu"));
    imagem.src = url;
  });
}

/** Quanto um ajuste deslocou as pontas do elemento. Serve para escolher, entre vários
 *  limites possíveis, o que mexe menos — que é o que a pessoa vê e espera. */
function alteracaoDe(antes: Elemento, depois: Elemento) {
  const pontosDe = (elemento: Elemento) => elemento.tipo === "parede" ? [elemento.a, elemento.b]
    : elemento.tipo === "traco" ? elemento.pontos : [];
  const um = pontosDe(antes);
  const outro = pontosDe(depois);
  if (um.length !== outro.length) return Infinity;
  return um.reduce((soma, ponto, i) => soma + Math.hypot(outro[i].x - ponto.x, outro[i].y - ponto.y), 0);
}

/** Ângulo do desenho técnico entre dois pontos: 0° à direita, crescendo no anti-horário.
 *  O Y da tela aponta para baixo, por isso ele entra negado. */
function anguloDe(centro: { x: number; y: number }, ponto: { x: number; y: number }) {
  const graus = Math.round(Math.atan2(-(ponto.y - centro.y), ponto.x - centro.x) * 180 / Math.PI);
  return ((graus % 360) + 360) % 360;
}

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
  // Arco e traço desenham a mesma coisa: uma polilinha. O arco chega em pontos pela
  // mesma tessellation que alimenta o arquivo exportado, então tela e papel concordam.
  const linha = elemento.tipo === "arco" ? pontosDoArco(elemento) : elemento.pontos;
  return <polyline points={linha.map((ponto) => `${ponto.x},${ponto.y}`).join(" ")} fill="none"
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
  const [ativosEncaixe, definirAtivosEncaixe] = useState<TipoEncaixe[]>([...TIPOS_ENCAIXE]);
  const [orto, definirOrto] = useState(false);
  const [entrada, definirEntrada] = useState("");
  const [matriz, definirMatriz] = useState({ colunas: 3, linhas: 1, passoXMm: 1000, passoYMm: 1000 });
  const [encaixeAtual, definirEncaixeAtual] = useState<Encaixe | null>(null);
  const [importado, definirImportado] = useState<Importado | null>(null);
  const [importando, definirImportando] = useState(false);
  const [unidadeImportacao, definirUnidadeImportacao] = useState("");
  const arquivoDxf = useRef<HTMLInputElement | null>(null);
  // O arquivo fica guardado aqui, e não no input: o input é limpo logo após a leitura
  // para aceitar o mesmo arquivo duas vezes seguidas, e sem esta cópia trocar a unidade
  // não teria o que reler.
  const dxfEscolhido = useRef<File | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const arrastando = useRef<{ id: string; de: { x: number; y: number } } | null>(null);
  const panorama = useRef<{ x: number; y: number; vista: { x: number; y: number } } | null>(null);
  const verticeArrastado = useRef<{ id: string; indice: number } | null>(null);

  const camadaAtiva = camadaDaFerramenta[ferramenta];
  const bloqueada = camadaBloqueada(documento, camadaAtiva);
  const podeDesenhar = canEdit && !bloqueada;
  const selecionado = useMemo(() => documento.elementos.find((elemento) => elemento.id === selecao) ?? null, [documento, selecao]);
  const resumo = useMemo(() => quantitativo(documento), [documento]);
  const conferencia = useMemo(() => conferir(documento), [documento]);
  const visiveis = useMemo(() => elementosVisiveis(documento), [documento]);

  const aplicar = useCallback((proximo: Documento) => {
    definirHistorico((anterior) => [...anterior, documento].slice(-LIMITE_HISTORICO));
    definirRefeitos([]);
    definirDocumento(proximo);
    definirSujo(true);
  }, [documento]);

  /** Um ponto de desfazer antes de um arrasto. O arrasto em si altera sem empilhar a
   *  cada quadro, senão desfazer voltaria um pixel por vez; sem esta marca no começo,
   *  porém, mover não teria volta nenhuma. */
  const marcarHistorico = useCallback(() => {
    definirHistorico((anterior) => [...anterior, documento].slice(-LIMITE_HISTORICO));
    definirRefeitos([]);
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

  /** Raio de captura em milímetros de desenho, derivado do zoom. O que a mão sente é a
   *  distância na TELA: um raio fixo em milímetros seria impossível de acertar afastado
   *  e agarraria tudo de perto. */
  const toleranciaMm = useCallback(() => {
    const largura = svgRef.current?.getBoundingClientRect().width ?? 0;
    return largura > 0 ? vista.largura / largura * 14 : vista.largura / 80;
  }, [vista.largura]);

  const encaixarEm = useCallback((bruto: { x: number; y: number }, origem?: { x: number; y: number } | null) => {
    const alvo = orto && origem ? ortogonal(origem, bruto) : bruto;
    const encaixe = encaixePerto(documento, alvo, { toleranciaMm: toleranciaMm(), origem, ativos: ativosEncaixe });
    // Com a trava ortogonal ligada, só vale o encaixe que não sai do eixo — senão a
    // trava seria desfeita pelo próprio encaixe, calada.
    if (orto && origem && encaixe.tipo !== "malha"
      && encaixe.ponto.x !== origem.x && encaixe.ponto.y !== origem.y) {
      return { tipo: "malha" as const, ponto: { x: encaixar(alvo.x, documento.malhaMm), y: encaixar(alvo.y, documento.malhaMm) } };
    }
    return encaixe;
  }, [ativosEncaixe, documento, orto, toleranciaMm]);

  const fundosPossiveis = useMemo(
    () => biblioteca.filter((item) => item.categoria === "fundo" || item.categoria === "referencia"),
    [biblioteca],
  );

  async function colocarFundo(assetId: string) {
    const escolhido = biblioteca.find((item) => item.id === assetId);
    if (!escolhido) return;
    const larguraMm = escolhido.larguraMm ?? 10000;
    try {
      const alturaMm = await alturaPelaProporcao(escolhido.url, larguraMm);
      aplicar({ ...documento, fundo: { chave: escolhido.url, nome: escolhido.nome.slice(0, 200), larguraMm, alturaMm, opacidade: 45 } });
    } catch {
      // Sem proporção real não há fundo confiável, e um fundo esticado leva o traçado
      // inteiro junto. Melhor não colocar do que colocar torto.
      toast.error("Não foi possível ler as dimensões desta imagem. Envie-a de novo como PNG, JPEG ou WebP.");
    }
  }

  async function redimensionarFundo(larguraMm: number) {
    if (!documento.fundo || !Number.isFinite(larguraMm) || larguraMm < 100) return;
    const chave = documento.fundo.chave;
    try {
      const alturaMm = await alturaPelaProporcao(chave, larguraMm);
      definirDocumento((anterior) => anterior.fundo && anterior.fundo.chave === chave
        ? { ...anterior, fundo: { ...anterior.fundo, larguraMm, alturaMm } } : anterior);
      definirSujo(true);
    } catch {
      toast.error("Não foi possível ler as dimensões desta imagem.");
    }
  }

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
    const origem = pendentes.length ? pendentes[pendentes.length - 1] : null;
    const encaixe = encaixarEm(bruto, origem);
    const ponto = encaixe.ponto;
    definirEncaixeAtual(encaixe);

    if (ferramenta === "selecionar") {
      // Vértice antes de elemento: quem clica em cima de uma alça quer a alça. Testar o
      // elemento primeiro tornaria a alça inalcançável, já que ela fica dentro dele.
      if (selecionado && canEdit && !camadaBloqueada(documento, selecionado.camada)) {
        const raio = toleranciaMm();
        const alca = verticesDe(selecionado).find((vertice) =>
          Math.hypot(vertice.ponto.x - bruto.x, vertice.ponto.y - bruto.y) <= raio);
        if (alca) {
          marcarHistorico();
          verticeArrastado.current = { id: selecionado.id, indice: alca.indice };
          (evento.target as Element).setPointerCapture?.(evento.pointerId);
          return;
        }
      }
      const alvo = elementoNoPonto(documento, bruto.x, bruto.y);
      definirSelecao(alvo?.id ?? null);
      if (alvo && canEdit) {
        marcarHistorico();
        arrastando.current = { id: alvo.id, de: ponto };
        (evento.target as Element).setPointerCapture?.(evento.pointerId);
      }
      return;
    }
    if (ferramenta === "espelhar" || ferramenta === "aparar" || ferramenta === "estender") {
      // Estas três agem sobre a SELEÇÃO, então quem manda é a camada dela. A guarda logo
      // abaixo olha a camada da ferramenta, e recusaria espelhar uma tomada só porque a
      // camada de layout está travada.
      if (!canEdit) { toast.error("Você não tem permissão para editar esta prancha."); return; }
      if (!selecionado) { toast.error("Selecione o elemento antes de usar esta ferramenta."); return; }
      if (camadaBloqueada(documento, selecionado.camada)) {
        toast.error("A camada do elemento selecionado está travada. Destrave-a no painel de camadas.");
        return;
      }
    }
    if (ferramenta === "espelhar") {
      if (!selecionado) { toast.error("Selecione o que deve ser espelhado antes de marcar o eixo."); return; }
      if (!pendentes.length) { definirPendentes([ponto]); return; }
      const refletido = espelhar(selecionado, pendentes[0], ponto);
      definirPendentes([]);
      if (!refletido) { toast.error("O eixo ficou com comprimento zero. Marque dois pontos diferentes."); return; }
      const id = novoId();
      aplicar({ ...documento, elementos: [...documento.elementos, { ...refletido, id }] });
      definirSelecao(id);
      return;
    }
    if (ferramenta === "aparar" || ferramenta === "estender") {
      // O cortante é o que está por baixo do clique; o alvo é o que está selecionado.
      // Selecionar primeiro e apontar depois é a ordem de todo CAD.
      if (!selecionado) { toast.error("Selecione a parede ou o traço a ajustar antes de apontar o limite."); return; }
      const cortantes = segmentosDo(documento).filter((segmento) => segmento.elementoId !== selecionado.id);
      const ajustados = cortantes
        .map((corte) => ferramenta === "aparar" ? aparar(selecionado, corte, bruto) : estender(selecionado, corte, bruto))
        .filter((resultado): resultado is Elemento => Boolean(resultado));
      if (!ajustados.length) {
        toast.error(ferramenta === "aparar"
          ? "Nada cruza este traço aqui. Aparar precisa de um limite que o atravesse de verdade."
          : "Nada para estender até aqui. O limite precisa estar além da ponta, no caminho dela.");
        return;
      }
      // Entre vários limites possíveis, vale o que mexe menos: é o que a pessoa vê e
      // espera, e evita a parede saltar para o outro lado do desenho.
      const escolhido = ajustados.reduce((melhor, candidato) =>
        alteracaoDe(selecionado, candidato) < alteracaoDe(selecionado, melhor) ? candidato : melhor);
      trocar(selecionado.id, escolhido as Partial<Elemento>);
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
    if (ferramenta === "circulo" || ferramenta === "arco") {
      // Centro, depois um ponto do raio; no arco, um terceiro clique fecha a varredura.
      // A ordem é a de todo CAD, e é a única em que o raio já aparece enquanto se move.
      const marcados = [...pendentes, ponto];
      const precisa = ferramenta === "arco" ? 3 : 2;
      if (marcados.length < precisa) { definirPendentes(marcados); return; }
      const [centro, inicio, fim] = marcados;
      const raioMm = Math.round(Math.hypot(inicio.x - centro.x, inicio.y - centro.y));
      if (raioMm < 1) { toast.error("O raio ficou em zero. Marque o centro e depois um ponto afastado dele."); definirPendentes([]); return; }
      const inicioGraus = anguloDe(centro, inicio);
      const varreduraGraus = ferramenta === "circulo"
        ? 360
        : Math.max(1, ((anguloDe(centro, fim) - inicioGraus) % 360 + 360) % 360 || 360);
      acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "arco", centro, raioMm, inicioGraus, varreduraGraus, espessuraMm: 25 });
      definirPendentes([]);
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
    const origem = pendentes.length ? pendentes[pendentes.length - 1] : arrastando.current?.de ?? null;
    const encaixe = encaixarEm(bruto, origem);
    const ponto = encaixe.ponto;
    definirCursor(ponto);
    definirEncaixeAtual(encaixe);

    if (verticeArrastado.current) {
      const { id, indice } = verticeArrastado.current;
      definirDocumento((anterior) => ({
        ...anterior,
        elementos: anterior.elementos.map((item) => item.id === id ? moverVertice(item, indice, ponto) : item),
      }));
      definirSujo(true);
      return;
    }

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
    if (verticeArrastado.current) { verticeArrastado.current = null; return; }
    if (arrastando.current) { arrastando.current = null; return; }
    if (ferramenta === "traco" && pendentes.length > 1) {
      acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "traco", pontos: pendentes, espessuraMm: 30 });
      definirPendentes([]);
    }
  }

  /** Confirma o traço pelo que foi digitado, a partir do último ponto marcado. Ninguém
   *  desenha parede de 3,15 m arrastando o mouse até acertar. */
  function confirmarEntrada() {
    const origem = pendentes.length ? pendentes[pendentes.length - 1] : null;
    if (!origem) { toast.error("Marque o ponto de partida na prancha antes de digitar a medida."); return; }
    const resolvido = resolverEntrada(origem, entrada, cursor);
    if (!resolvido) {
      toast.error("Não entendi a medida. Use 3150, 3150<90, @3000,1500 ou 3,15m.");
      return;
    }
    const destino = resolvido.ponto;
    if (ferramenta === "parede") {
      acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "parede", a: origem, b: destino, espessuraMm: 150 });
      definirPendentes([destino]);
    } else if (ferramenta === "cota") {
      acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "cota", a: origem, b: destino, deslocamentoMm: 400 });
      definirPendentes([]);
    } else if (ferramenta === "comodo") {
      definirPendentes((anterior) => [...anterior, destino]);
    } else {
      toast.error("A medida digitada vale para parede, cômodo e cota.");
      return;
    }
    definirEntrada("");
  }

  /** Paralela do elemento selecionado. A distância vem do campo de medida, porque é o
   *  mesmo gesto: dizer quanto. */
  function criarParalela(sinal: 1 | -1) {
    if (!selecionado || !canEdit) return;
    const distancia = lerMedida(entrada) ?? Math.round(documento.malhaMm);
    const nova = paralelaDe(selecionado, Math.abs(distancia) * sinal);
    if (!nova) {
      toast.error("Este elemento não tem paralela. Vale para parede, cômodo, traço e arco.");
      return;
    }
    const id = novoId();
    aplicar({ ...documento, elementos: [...documento.elementos, { ...nova, id }] });
    definirSelecao(id);
    toast.success(`Paralela a ${Math.abs(distancia)} mm.`);
  }

  function repetirEmMatriz() {
    if (!selecionado || !canEdit) return;
    const copias = matrizRetangular(selecionado, matriz, novoId);
    if (!copias.length) {
      toast.error("Revise a matriz: precisa de pelo menos uma repetição, com passo diferente de zero e no máximo 400 cópias.");
      return;
    }
    if (documento.elementos.length + copias.length > 20000) {
      toast.error("O desenho passaria do limite de 20 mil elementos.");
      return;
    }
    aplicar({ ...documento, elementos: [...documento.elementos, ...copias] });
    toast.success(`${copias.length} cópia(s) criadas.`);
  }

  function alternarEncaixe(tipo: TipoEncaixe) {
    definirAtivosEncaixe((anterior) => anterior.includes(tipo)
      ? anterior.filter((item) => item !== tipo) : [...anterior, tipo]);
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
      if (evento.key === "Escape") { definirPendentes([]); definirSelecao(null); definirEntrada(""); return; }
      if (evento.key.toLowerCase() === "o") { evento.preventDefault(); definirOrto((anterior) => !anterior); return; }
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

  async function importar(arquivo: File, unidade: string) {
    definirImportando(true);
    try {
      const formulario = new FormData();
      formulario.append("file", arquivo);
      if (unidade) formulario.append("unidade", unidade);
      const resposta = await fetch("/api/studio/importar", { method: "POST", body: formulario });
      const corpo = await resposta.json().catch(() => ({})) as Importado & { error?: string };
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível ler o arquivo.");
      definirImportado(corpo);
      definirUnidadeImportacao(corpo.unidade);
    } catch (causa) {
      definirImportado(null);
      toast.error(causa instanceof Error ? causa.message : "Não foi possível ler o arquivo.");
    } finally {
      definirImportando(false);
    }
  }

  // A importação só entra no desenho depois que alguém confirma a unidade. Um arquivo
  // lido em metro quando era centímetro entra cem vezes maior, e nada na tela denuncia
  // isso antes de a cota ser medida.
  function aceitarImportacao() {
    if (!importado) return;
    const existentes = new Set(documento.camadas.map((camada) => camada.id));
    const novas = importado.camadas.filter((camada) => !existentes.has(camada.id));
    const cabem = Math.max(0, 60 - documento.camadas.length);
    if (novas.length > cabem) {
      toast.error(`O arquivo traz ${novas.length} camadas e só cabem mais ${cabem} nesta prancha. Importe para uma prancha nova.`);
      return;
    }
    const existentesElementos = new Set(documento.elementos.map((elemento) => elemento.id));
    const chegando = importado.elementos.filter((elemento) => !existentesElementos.has(elemento.id));
    if (documento.elementos.length + chegando.length > 20000) {
      toast.error("O desenho ficaria acima do limite de 20 mil elementos. Importe para uma prancha nova.");
      return;
    }
    aplicar({
      ...documento,
      camadas: [...documento.camadas, ...novas],
      elementos: [...documento.elementos, ...chegando],
    });
    definirImportado(null);
    dxfEscolhido.current = null;
    toast.success(`${chegando.length} elemento(s) importados em ${novas.length} camada(s) novas.`);
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

  function baixar(conteudo: string, tipo: string, extensao: string) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const ligacao = document.createElement("a");
    ligacao.href = url;
    ligacao.download = `${nome.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "prancha"}.${extensao}`;
    ligacao.click();
    URL.revokeObjectURL(url);
  }

  function exportarParaCad() {
    // Só o visível, o mesmo critério da tela e do SVG: as três exportações precisam
    // concordar sobre o que está no desenho.
    baixar(exportarDxf(documento, { visiveis }), "image/vnd.dxf", "dxf");
  }

  function exportar() {
    baixar(exportarSvg(documento, { titulo: nome, origem: window.location.origin }), "image/svg+xml", "svg");
  }

  const faltas = conferencia.achados.filter((achado) => achado.severidade === "falta").length;
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
        {canEdit && <>
          <input ref={arquivoDxf} type="file" accept=".dxf,text/plain,application/dxf,image/vnd.dxf,.dwg" className="sr-only"
            aria-label="Arquivo DXF para importar"
            onChange={(evento) => {
              const arquivo = evento.target.files?.[0] ?? null;
              evento.target.value = "";
              dxfEscolhido.current = arquivo;
              if (arquivo) void importar(arquivo, "");
            }} />
          <Button variant="outline" size="sm" onClick={() => arquivoDxf.current?.click()} disabled={importando}>
            {importando ? <LoaderCircle className="animate-spin" /> : <Upload />}Importar DXF
          </Button>
        </>}
        <Button variant="outline" size="sm" onClick={exportarParaCad}><Download />Exportar DXF</Button>
        <Button variant="outline" size="sm" onClick={exportar}><Download />SVG</Button>
        {canEdit && <Button size="sm" onClick={() => void salvar()} disabled={salvando || !sujo}>
          {salvando ? <LoaderCircle className="animate-spin" /> : <Save />}Gravar
        </Button>}
      </div>
    </header>

    {conflito && <p role="alert" className="rounded-md border border-hoikos-gold bg-hoikos-50 px-4 py-3 text-sm text-hoikos-800">
      Esta prancha foi alterada em outro lugar depois que você abriu. Exporte o seu desenho antes de recarregar, para não perder o que fez aqui.
    </p>}

    {importado && <section aria-label="Revisão da importação"
      className="space-y-3 rounded-md border border-hoikos-300 bg-hoikos-50 px-4 py-3">
      <div>
        <p className="eyebrow text-hoikos-600">Importação pronta para revisão</p>
        <p className="mt-1 text-sm text-hoikos-800">
          <strong>{importado.nomeArquivo}</strong> — {importado.elementos.length} elemento(s) em {importado.camadas.length} camada(s).
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="importacao-unidade" className="text-xs">Unidade do desenho no arquivo</Label>
          <NativeSelect id="importacao-unidade" value={unidadeImportacao} className="h-10 w-44"
            onChange={(evento) => {
              const escolhida = evento.target.value;
              definirUnidadeImportacao(escolhida);
              if (dxfEscolhido.current) void importar(dxfEscolhido.current, escolhida);
            }}>
            {Object.entries(UNIDADES_ROTULO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </NativeSelect>
        </div>
        <Button size="sm" onClick={aceitarImportacao} disabled={importando || !importado.elementos.length}>
          Colocar na prancha
        </Button>
        <Button variant="outline" size="sm" onClick={() => { definirImportado(null); dxfEscolhido.current = null; }}>Descartar</Button>
      </div>
      <p className="text-xs leading-5 text-hoikos-600">
        {importado.unidadeDeclarada
          ? `O arquivo declara ${UNIDADES_ROTULO[importado.unidade]?.toLowerCase() ?? importado.unidade}. Trocar aqui recalcula tudo.`
          : "O arquivo não declara a unidade. Confira a escolha antes de colocar na prancha: em metro quando era centímetro, o desenho entra cem vezes maior."}
      </p>
      {importado.avisos.length > 0 && <ul className="space-y-1 text-xs leading-5 text-hoikos-700">
        {importado.avisos.map((aviso) => <li key={aviso}>· {aviso}</li>)}
      </ul>}
    </section>}

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

        <div className="space-y-2 border-t border-hoikos-200 pt-3">
          <p className="eyebrow text-hoikos-600">Fundo de traçado</p>
          {documento.fundo ? <>
            <p className="truncate text-xs text-hoikos-700" title={documento.fundo.nome}>{documento.fundo.nome}</p>
            <Label htmlFor="fundo-largura" className="text-xs">Largura real do fundo (mm)</Label>
            <Input id="fundo-largura" type="number" inputMode="numeric" min={100} value={documento.fundo.larguraMm} disabled={!canEdit}
              onChange={(evento) => { void redimensionarFundo(Math.round(Number(evento.target.value))); }} />
            <Label htmlFor="fundo-opacidade" className="text-xs">Opacidade: {documento.fundo.opacidade}%</Label>
            <input id="fundo-opacidade" type="range" min={5} max={100} value={documento.fundo.opacidade} disabled={!canEdit}
              className="w-full accent-hoikos-700"
              onChange={(evento) => {
                const opacidade = Number(evento.target.value);
                definirDocumento((anterior) => anterior.fundo ? { ...anterior, fundo: { ...anterior.fundo, opacidade } } : anterior);
                definirSujo(true);
              }} />
            <p className="text-xs leading-5 text-hoikos-500">Meça algo conhecido com a ferramenta de cota e ajuste a largura até fechar. É assim que o traçado sai na escala certa.</p>
            {canEdit && <Button variant="outline" size="sm" className="w-full" onClick={() => {
              aplicar({ ...documento, fundo: null });
            }}><Trash2 />Tirar o fundo</Button>}
          </> : <>
            {fundosPossiveis.length ? <>
              <NativeSelect aria-label="Escolher fundo de traçado" value="" disabled={!canEdit}
                onChange={(evento) => { void colocarFundo(evento.target.value); }}>
                <option value="">Escolha uma imagem da biblioteca…</option>
                {fundosPossiveis.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </NativeSelect>
              <p className="text-xs leading-5 text-hoikos-500">A planta existente entra por baixo do desenho para ser traçada. PDF e DWG ficam como anexo: converta em imagem para usar como fundo.</p>
            </> : <p className="text-xs leading-5 text-hoikos-500">Envie a planta existente como imagem na aba Biblioteca para traçar por cima dela.</p>}
          </>}
        </div>

        {ferramenta === "comodo" && pendentes.length > 0 && <Button size="sm" className="w-full" onClick={fecharComodo}>
          Fechar cômodo ({pendentes.length} cantos)
        </Button>}

        <div className="space-y-2 border-t border-hoikos-200 pt-3">
          <p className="eyebrow text-hoikos-600">Encaixe</p>
          <div className="grid grid-cols-2 gap-1">
            {TIPOS_ENCAIXE.filter((tipo) => tipo !== "malha").map((tipo) => <button key={tipo} type="button"
              onClick={() => alternarEncaixe(tipo)} aria-pressed={ativosEncaixe.includes(tipo)}
              className="rounded-md border border-hoikos-200 bg-white px-2 py-1.5 text-xs text-hoikos-700 aria-pressed:border-hoikos-800 aria-pressed:bg-hoikos-800 aria-pressed:text-white">
              {encaixeLabels[tipo]}
            </button>)}
          </div>
          <button type="button" onClick={() => definirOrto((anterior) => !anterior)} aria-pressed={orto}
            title="Trava ortogonal — tecla O"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-hoikos-200 bg-white px-2 py-2 text-xs text-hoikos-700 aria-pressed:border-hoikos-gold aria-pressed:bg-hoikos-gold aria-pressed:text-white">
            <Magnet className="size-3.5" />Trava ortogonal (O)
          </button>
        </div>

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
          {/* Prévia do traço. Para círculo e arco ela precisa ser a curva: uma linha até o
              cursor não diria nada sobre o raio que está sendo marcado. */}
          {pendentes.length > 0 && (ferramenta === "circulo" || ferramenta === "arco")
            ? (() => {
              const centro = pendentes[0];
              const referencia = pendentes[1] ?? cursor;
              if (!referencia) return null;
              const raio = Math.round(Math.hypot(referencia.x - centro.x, referencia.y - centro.y));
              if (raio < 1) return null;
              const varredura = ferramenta === "circulo" || pendentes.length < 2 || !cursor
                ? 360
                : Math.max(1, ((anguloDe(centro, cursor) - anguloDe(centro, pendentes[1])) % 360 + 360) % 360 || 360);
              const previa = pontosDoArco({
                id: "previa", camada: camadaAtiva, tipo: "arco", centro, raioMm: raio,
                inicioGraus: anguloDe(centro, referencia), varreduraGraus: varredura, espessuraMm: 25,
              });
              return <g fill="none" stroke="#846100" strokeWidth={60} strokeDasharray="200 140">
                <polyline points={previa.map((ponto) => `${ponto.x},${ponto.y}`).join(" ")} />
                <line x1={centro.x} y1={centro.y} x2={referencia.x} y2={referencia.y} strokeWidth={30} />
              </g>;
            })()
            : pendentes.length > 0 && <polyline
              points={[...pendentes, ...(cursor ? [cursor] : [])].map((ponto) => `${ponto.x},${ponto.y}`).join(" ")}
              fill="none" stroke="#846100" strokeWidth={60} strokeDasharray="200 140" />}
          {/* Alças dos vértices do elemento selecionado: corrigir um canto sem refazer o
              cômodo inteiro é o que faz alguém de fato corrigir o canto. */}
          {canEdit && selecionado && verticesDe(selecionado).map((vertice) => <rect key={vertice.indice}
            x={vertice.ponto.x - vista.largura / 220} y={vertice.ponto.y - vista.largura / 220}
            width={vista.largura / 110} height={vista.largura / 110}
            fill="#F4F2E9" stroke="#846100" strokeWidth={vista.largura / 900} />)}
          {/* A marca do encaixe diz em QUE ponto o traço vai cair, antes de o clique
              acontecer. Sem ela o encaixe age por baixo e a pessoa não confia nele. */}
          {encaixeAtual && encaixeAtual.tipo !== "malha" && <g stroke="#846100" fill="none" strokeWidth={vista.largura / 700}>
            <rect x={encaixeAtual.ponto.x - vista.largura / 130} y={encaixeAtual.ponto.y - vista.largura / 130}
              width={vista.largura / 65} height={vista.largura / 65} />
            {encaixeAtual.tipo === "interseccao" && <>
              <line x1={encaixeAtual.ponto.x - vista.largura / 130} y1={encaixeAtual.ponto.y - vista.largura / 130}
                x2={encaixeAtual.ponto.x + vista.largura / 130} y2={encaixeAtual.ponto.y + vista.largura / 130} />
              <line x1={encaixeAtual.ponto.x + vista.largura / 130} y1={encaixeAtual.ponto.y - vista.largura / 130}
                x2={encaixeAtual.ponto.x - vista.largura / 130} y2={encaixeAtual.ponto.y + vista.largura / 130} />
            </>}
          </g>}
          {cursor && ferramenta !== "selecionar" && <circle cx={cursor.x} cy={cursor.y} r={vista.largura / 160} fill="#846100" />}
        </svg>
        <div className="flex flex-wrap items-center gap-3 border-t border-hoikos-200 px-3 py-2 text-xs text-hoikos-500">
          <span className="flex items-center gap-1.5">
            <Grid2x2 aria-hidden="true" className="size-3.5" />
            {cursor ? `${(cursor.x / 1000).toFixed(2).replace(".", ",")} m · ${(cursor.y / 1000).toFixed(2).replace(".", ",")} m` : "Mova o cursor sobre a prancha"}
          </span>
          {encaixeAtual && encaixeAtual.tipo !== "malha" && <span className="font-medium text-hoikos-gold">{encaixeLabels[encaixeAtual.tipo]}</span>}
          {orto && <span className="font-medium text-hoikos-gold">Ortogonal</span>}
          {pendentes.length > 0 && cursor && <span>
            {ferramenta === "circulo" || ferramenta === "arco"
              ? `raio ${metros(comprimentoM(pendentes[0], pendentes[1] ?? cursor))}`
              : metros(comprimentoM(pendentes[pendentes.length - 1], cursor))}
          </span>}
          {canEdit && <form className="ml-auto flex items-center gap-2"
            onSubmit={(evento) => { evento.preventDefault(); confirmarEntrada(); }}>
            <Label htmlFor="prancheta-medida" className="text-xs">Medida</Label>
            <Input id="prancheta-medida" value={entrada} onChange={(evento) => definirEntrada(evento.target.value)}
              placeholder="3150 · 3150<90 · @3000,1500" className="h-8 w-56 text-xs"
              disabled={!pendentes.length} />
            <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!pendentes.length || !entrada.trim()}>
              Aplicar
            </Button>
          </form>}
        </div>
      </div>

      <aside className="prancheta-painel">
        <Tabs defaultValue="propriedades">
          <TabsList>
            <TabsTrigger value="propriedades">Seleção</TabsTrigger>
            <TabsTrigger value="camadas">Camadas</TabsTrigger>
            <TabsTrigger value="quantitativo">Quantitativo</TabsTrigger>
            <TabsTrigger value="conferencia">
              Norma{faltas > 0 ? ` · ${faltas}` : ""}
            </TabsTrigger>
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
              {selecionado.tipo === "arco" && <>
                <div className="space-y-1">
                  <Label htmlFor="prop-raio" className="text-xs">Raio (mm)</Label>
                  <Input id="prop-raio" type="number" inputMode="numeric" value={selecionado.raioMm} disabled={!canEdit}
                    onChange={(evento) => {
                      const valor = Math.round(Number(evento.target.value));
                      if (Number.isFinite(valor) && valor >= 1) trocar(selecionado.id, { raioMm: valor } as Partial<Elemento>);
                    }} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="prop-varredura" className="text-xs">Varredura (graus)</Label>
                  <Input id="prop-varredura" type="number" inputMode="numeric" min={1} max={360} value={selecionado.varreduraGraus} disabled={!canEdit}
                    onChange={(evento) => {
                      const valor = Math.round(Number(evento.target.value));
                      if (Number.isFinite(valor) && valor >= 1 && valor <= 360) trocar(selecionado.id, { varreduraGraus: valor } as Partial<Elemento>);
                    }} />
                </div>
                <p className="text-xs text-hoikos-500">
                  {selecionado.varreduraGraus >= 360 ? "Círculo completo." : `Arco de ${selecionado.varreduraGraus}° a partir de ${selecionado.inicioGraus}°.`}
                </p>
              </>}
              {selecionado.tipo === "parede" && <p className="text-xs text-hoikos-500">Comprimento {metros(comprimentoM(selecionado.a, selecionado.b))}.</p>}
              {canEdit && <div className="space-y-2 border-t border-hoikos-200 pt-3">
                <p className="eyebrow text-hoikos-600">Repetir em matriz</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="matriz-colunas" className="text-xs">Colunas</Label>
                    <Input id="matriz-colunas" type="number" inputMode="numeric" min={1} value={matriz.colunas}
                      onChange={(evento) => definirMatriz((anterior) => ({ ...anterior, colunas: Math.round(Number(evento.target.value)) || 1 }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="matriz-linhas" className="text-xs">Linhas</Label>
                    <Input id="matriz-linhas" type="number" inputMode="numeric" min={1} value={matriz.linhas}
                      onChange={(evento) => definirMatriz((anterior) => ({ ...anterior, linhas: Math.round(Number(evento.target.value)) || 1 }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="matriz-passo-x" className="text-xs">Passo →  (mm)</Label>
                    <Input id="matriz-passo-x" type="number" inputMode="numeric" value={matriz.passoXMm}
                      onChange={(evento) => definirMatriz((anterior) => ({ ...anterior, passoXMm: Math.round(Number(evento.target.value)) || 0 }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="matriz-passo-y" className="text-xs">Passo ↓ (mm)</Label>
                    <Input id="matriz-passo-y" type="number" inputMode="numeric" value={matriz.passoYMm}
                      onChange={(evento) => definirMatriz((anterior) => ({ ...anterior, passoYMm: Math.round(Number(evento.target.value)) || 0 }))} />
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={repetirEmMatriz}>
                  <Grid3x3 />Repetir {Math.max(0, matriz.colunas * matriz.linhas - 1)} vez(es)
                </Button>
              </div>}
              {canEdit && paralelaDe(selecionado, 1) && <div className="space-y-1 border-t border-hoikos-200 pt-3">
                <p className="text-xs text-hoikos-600">
                  Paralela à distância digitada no campo Medida (hoje {lerMedida(entrada) ?? documento.malhaMm} mm).
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => criarParalela(1)}><Copy />Um lado</Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => criarParalela(-1)}><Copy />Outro lado</Button>
                </div>
              </div>}
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

          <TabsContent value="conferencia" className="space-y-3 pt-3">
            <p className="text-xs leading-5 text-hoikos-500">
              Conferência contra a NBR 5410 (pontos de tomada e iluminação) e a NBR 9050 (vão de porta),
              derivada da área e do perímetro que você desenhou. A ferramenta aponta; quem decide é você —
              norma tem exceção, e nada aqui altera o desenho.
            </p>

            {conferencia.achados.length === 0 && conferencia.comodos.length > 0
              ? <p className="rounded-md border border-hoikos-200 bg-white px-3 py-2 text-sm text-hoikos-700">
                Nenhuma não conformidade nos itens conferidos.
              </p>
              : <ul className="space-y-2">
                {conferencia.achados.map((achado, indice) => <li key={`${achado.parametroId}-${indice}`}
                  className={`rounded-md border px-3 py-2 ${achado.severidade === "falta"
                    ? "border-hoikos-gold bg-hoikos-50" : "border-hoikos-200 bg-white"}`}>
                  <p className="text-xs font-medium text-hoikos-800">
                    {achado.comodo ? `${achado.comodo} · ` : ""}{achado.severidade === "falta" ? "Falta" : achado.severidade === "atencao" ? "Atenção" : "Nota"}
                    <span className="ml-1 font-normal text-hoikos-500">item {achado.item}</span>
                  </p>
                  <p className="mt-1 text-xs leading-5 text-hoikos-600">{achado.mensagem}</p>
                </li>)}
              </ul>}

            {conferencia.comodos.length > 0 && <div>
              <p className="eyebrow text-hoikos-600">Exigido por cômodo</p>
              <ul className="mt-1 space-y-1 text-xs">
                {conferencia.comodos.map((linha, indice) => <li key={`${linha.nome}-${indice}`}
                  className="flex items-baseline justify-between gap-2 border-b border-hoikos-100 py-1">
                  <span className="truncate text-hoikos-700">{linha.nome}</span>
                  <span className="shrink-0 text-hoikos-500">
                    {linha.tomadasDesenhadas}/{linha.tomadasMinimas} tomadas · {linha.pontosDeLuzDesenhados}/{linha.pontosDeLuzMinimos} luz
                  </span>
                </li>)}
              </ul>
              <p className="mt-2 text-xs text-hoikos-500">
                Carga prevista somada: {conferencia.cargaTotalVa.toLocaleString("pt-BR")} VA.
                É o mínimo da norma, não o dimensionamento do quadro.
              </p>
            </div>}
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  </div>;
}
