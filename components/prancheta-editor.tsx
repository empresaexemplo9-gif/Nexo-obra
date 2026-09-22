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
import { nearestOnSegment } from "@/packages/cad-core";
import { zoomNaVista, enquadrarElementos } from "@/lib/prancheta-viewport";
import { executarNaSelecao, selecionarNaJanela } from "@/lib/cad-selection";
import { CAD_COMMANDS } from "@/lib/cad-commands";
import { exportNative, mergeCadImport, type ImportReport } from "@/lib/cad-formats";
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
  Camada, Documento, Elemento, FAMILIAS_SIMBOLO, areaM2, camadaBloqueada, documentoSchema,
  comprimentoM, disciplinaLabels, elementosVisiveis, encaixar, exportarSvg, glifoDoSimbolo,
  pontosDoArco,
  limitesDoElemento, moverElemento, quantitativo, simboloLabels,
} from "@/lib/prancheta";

type Ferramenta =
  | "selecionar" | "parede" | "comodo" | "porta" | "janela" | "passagem"
  | "simbolo" | "mobilia" | "imagem" | "texto" | "cota" | "traco"
  | "circulo" | "arco" | "espelhar" | "aparar" | "estender"
  | "linha" | "polilinha" | "retangulo" | "janelaSelecao";

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
  { id: "janelaSelecao", rotulo: "Selecionar por janela", icone: Square, atalho: "B" },
  { id: "linha", rotulo: "Linha", icone: Minus, atalho: "F" },
  { id: "polilinha", rotulo: "Polilinha", icone: Spline, atalho: "W" },
  { id: "retangulo", rotulo: "Retângulo", icone: Square, atalho: "Q" },
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

const instrucoes: Record<Ferramenta, string> = {
  selecionar: "Clique para selecionar; Shift+clique adiciona ou remove da seleção. Segure o botão esquerdo e arraste a seleção para mover. Arraste o espaço vazio para deslocar a vista.",
  janelaSelecao: "Arraste uma janela envolvendo os elementos inteiros. Shift mantém a seleção anterior. Botão do meio ou direito desloca a vista.",
  linha: "Clique no início e no fim da linha, ou digite uma medida após o primeiro ponto. Esc encerra.",
  polilinha: "Clique nos vértices. Enter conclui aberta; Fechar polilinha une o último ponto ao primeiro. Esc cancela.",
  retangulo: "Clique em dois cantos opostos, ou digite @largura,altura após o primeiro ponto.",
  parede: "Clique no início e no fim da parede. Continue clicando para encadear paredes; Esc encerra.",
  comodo: "Clique em cada canto do cômodo e use Fechar cômodo para concluir.",
  porta: "Clique no ponto onde a porta deve ser colocada e ajuste suas medidas no painel Seleção.",
  janela: "Clique no ponto da janela e ajuste largura ou rotação no painel Seleção.",
  passagem: "Clique no ponto da passagem e ajuste suas medidas no painel Seleção.",
  simbolo: "Escolha o símbolo no painel e clique no desenho para colocá-lo.",
  mobilia: "Clique no desenho para inserir um móvel e ajuste suas dimensões no painel Seleção.",
  imagem: "Escolha uma imagem da biblioteca e clique no desenho para colocá-la.",
  texto: "Clique onde a anotação deve aparecer; edite o texto no painel Seleção.",
  cota: "Clique nos dois pontos que deseja medir. A distância aparece na prancha.",
  traco: "Segure o botão esquerdo e arraste para desenhar um traço livre; solte para concluir.",
  circulo: "Clique no centro e depois no ponto que define o raio.",
  arco: "Clique no centro, no início e no fim do arco.",
  espelhar: "Selecione um elemento, marque dois pontos do eixo e crie sua cópia espelhada.",
  aparar: "Selecione uma parede ou traço e clique no trecho que deve ser removido.",
  estender: "Selecione uma parede ou traço e clique na ponta que deve alcançar o limite.",
};

// A ferramenta decide em que camada o desenho cai. Obrigar a escolher a camada antes de
// cada traço seria burocracia: quem coloca uma tomada está no elétrico por definição.
const camadaDaFerramenta: Record<Ferramenta, string> = {
  linha: "layout", polilinha: "layout", retangulo: "layout", janelaSelecao: "layout",
  selecionar: "layout", parede: "layout", comodo: "layout", porta: "layout",
  janela: "layout", passagem: "layout", simbolo: "eletrico", mobilia: "mobiliario",
  imagem: "mobiliario", texto: "anotacao", cota: "anotacao", traco: "anotacao",
  circulo: "layout", arco: "layout", espelhar: "layout", aparar: "layout", estender: "layout",
};

type Importado = {
  nomeArquivo: string; unidade: string; unidadeDeclarada: boolean;
  camadas: Camada[]; elementos: Elemento[]; avisos: string[]; truncado: boolean;
  report?: ImportReport;
};

const UNIDADES_ROTULO: Record<string, string> = {
  mm: "Milímetro", cm: "Centímetro", m: "Metro", polegada: "Polegada", pe: "Pé",
};

const MALHAS = [1, 10, 25, 50, 100, 250, 500];
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
  const graus = Math.atan2(-(ponto.y - centro.y), ponto.x - centro.x) * 180 / Math.PI;
  return ((graus % 360) + 360) % 360;
}

function novoId() {
  return globalThis.crypto?.randomUUID?.() ?? `el-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Acerto de clique: o elemento mais acima na ordem de desenho que contém o ponto. Mais
 *  acima primeiro porque é o que a pessoa enxerga — selecionar o que está por baixo de
 *  algo visível é a origem de metade da frustração em editor de desenho. */
function elementoNoPonto(documento: Documento, x: number, y: number, tolerance: number): Elemento | null {
  const visiveis = elementosVisiveis(documento);
  for (let i = visiveis.length - 1; i >= 0; i -= 1) {
    const elemento = visiveis[i];
    if (camadaBloqueada(documento, elemento.camada)) continue;
    const caixa = limitesDoElemento(elemento);
    if (x < caixa.x1 - tolerance || x > caixa.x2 + tolerance || y < caixa.y1 - tolerance || y > caixa.y2 + tolerance) continue;
    if (elemento.tipo === "parede" || elemento.tipo === "cota" || elemento.tipo === "traco" || elemento.tipo === "arco") {
      const points = elemento.tipo === "cota" ? [elemento.a, { x: elemento.a.x, y: elemento.a.y + elemento.deslocamentoMm }, { x: elemento.b.x, y: elemento.b.y + elemento.deslocamentoMm }, elemento.b] : elemento.tipo === "parede" ? [elemento.a, elemento.b] : elemento.tipo === "arco" ? pontosDoArco(elemento) : elemento.pontos;
      const margin = tolerance + ("espessuraMm" in elemento ? elemento.espessuraMm / 2 : 0);
      if (points.slice(1).some((b, index) => { const near = nearestOnSegment({ x, y }, points[index], b); return Math.hypot(near.x - x, near.y - y) <= margin; })) return elemento;
      continue;
    }
    if (elemento.tipo === "comodo") {
      let dentro = false;
      for (let a = 0, b = elemento.pontos.length - 1; a < elemento.pontos.length; b = a++) {
        const p = elemento.pontos[a], q = elemento.pontos[b];
        const perto = nearestOnSegment({ x, y }, p, q);
        if (Math.hypot(perto.x - x, perto.y - y) <= tolerance) return elemento;
        if ((p.y > y) !== (q.y > y) && x < (q.x - p.x) * (y - p.y) / (q.y - p.y) + p.x) dentro = !dentro;
      }
      if (!dentro) continue;
    }
    if (elemento.tipo === "mobilia" || elemento.tipo === "imagem") {
      const r = elemento.rotacaoGraus * Math.PI / 180;
      const dx = x - elemento.posicao.x, dy = y - elemento.posicao.y;
      if (Math.abs(dx * Math.cos(r) + dy * Math.sin(r)) > elemento.larguraMm / 2 + tolerance
        || Math.abs(-dx * Math.sin(r) + dy * Math.cos(r)) > elemento.alturaMm / 2 + tolerance) continue;
    }
    return elemento;
  }
  return null;
}

function Glifo({ familia }: { familia: string }) {
  const glifo = glifoDoSimbolo(familia);
  return <svg viewBox="-450 -450 900 900" className="size-5" aria-hidden="true">
    <path d={glifo.d} fill={glifo.preenchido ? "currentColor" : "none"} stroke="currentColor" strokeWidth={60} />
  </svg>;
}

function DesenhoElemento({ elemento, selecionado, minimumStroke }: { elemento: Elemento; selecionado: boolean; minimumStroke: number }) {
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
    stroke={selecionado ? "#846100" : "#1C190F"} strokeWidth={Math.max(elemento.espessuraMm, minimumStroke)} strokeLinecap="round" strokeLinejoin="round" />;
}

export function PranchetaEditor({ prancha, canEdit, onVoltar, onSalvo, fullPage = false }: {
  prancha: Prancha; canEdit: boolean; onVoltar: () => void;
  onSalvo: (atualizada: Prancha) => void;
  fullPage?: boolean;
}) {
  const [documento, definirDocumento] = useState<Documento>(prancha.documento);
  const [revisao, definirRevisao] = useState(prancha.revisao);
  const [nome, definirNome] = useState(prancha.nome);
  const [ferramenta, definirFerramenta] = useState<Ferramenta>("selecionar");
  const [ajudaVisivel, definirAjudaVisivel] = useState<Ferramenta | null>(null);
  const temporizadorAjuda = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [familia, definirFamilia] = useState<string>("tomada-media");
  const [itemImagem, definirItemImagem] = useState<ItemBiblioteca | null>(null);
  const [biblioteca, definirBiblioteca] = useState<ItemBiblioteca[]>([]);
  const [selecoes, definirSelecoes] = useState<string[]>([]);
  const selecao = selecoes.length === 1 ? selecoes[0] : null;
  const definirSelecao = useCallback((id: string | null) => definirSelecoes(id ? [id] : []), []);
  const [janelaSelecao, definirJanelaSelecao] = useState<{ a: { x: number; y: number }; b: { x: number; y: number }; manter: boolean } | null>(null);
  const janelaRef = useRef<typeof janelaSelecao>(null);
  const [distanciaParalela, definirDistanciaParalela] = useState("100");
  const [transformacao, definirTransformacao] = useState({ dx: "1000", dy: "0", angulo: "90", fator: "2", x: "0", y: "0" });
  const [novaCamada, definirNovaCamada] = useState("");
  const [camadaEscolhida, definirCamadaEscolhida] = useState("");
  const estadoAtual = useRef({ documento, nome });
  useEffect(() => { estadoAtual.current = { documento, nome }; }, [documento, nome]);
  const salvamentoEmCurso = useRef(false);
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
  const [comando, definirComando] = useState("");
  const [mensagemComando, definirMensagemComando] = useState("Coordenadas em mm. Exemplo: L 0,0 3000,0");
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
  const arrastando = useRef<{ ids: string[]; de: { x: number; y: number }; documento: Documento; mudou: boolean } | null>(null);
  const panorama = useRef<{ x: number; y: number; vista: { x: number; y: number } } | null>(null);
  const verticeArrastado = useRef<{ id: string; indice: number; documento: Documento; mudou: boolean } | null>(null);

  function esconderAjuda() {
    if (temporizadorAjuda.current) clearTimeout(temporizadorAjuda.current);
    temporizadorAjuda.current = null;
    definirAjudaVisivel(null);
  }

  function aguardarAjuda(id: Ferramenta) {
    esconderAjuda();
    temporizadorAjuda.current = setTimeout(() => definirAjudaVisivel(id), 4000);
  }

  useEffect(() => () => {
    if (temporizadorAjuda.current) clearTimeout(temporizadorAjuda.current);
  }, []);

  const camadaAtiva = camadaEscolhida || (ferramenta === "simbolo" ? (FAMILIAS_SIMBOLO.eletrico.includes(familia as never) ? "eletrico" : "luminotecnico") : camadaDaFerramenta[ferramenta]);
  const bloqueada = camadaBloqueada(documento, camadaAtiva) || !documento.camadas.find(c => c.id === camadaAtiva)?.visivel;
  const podeDesenhar = canEdit && !bloqueada;
  const selecionado = useMemo(() => documento.elementos.find((elemento) => elemento.id === selecao) ?? null, [documento, selecao]);
  const resumo = useMemo(() => quantitativo(documento), [documento]);
  const conferencia = useMemo(() => conferir(documento), [documento]);
  const visiveis = useMemo(() => elementosVisiveis(documento), [documento]);

  const aplicar = useCallback((proximo: Documento) => {
    if (!canEdit) return false;
    const validacao = documentoSchema.safeParse(proximo);
    if (!validacao.success) { toast.error("A alteração ultrapassa os limites de medida ou de elementos da prancha."); return false; }
    definirHistorico((anterior) => [...anterior, documento].slice(-LIMITE_HISTORICO));
    definirRefeitos([]);
    definirDocumento(proximo);
    definirSujo(true);
    return true;
  }, [documento, canEdit]);

  const acrescentar = useCallback((elemento: Elemento) => {
    if (camadaBloqueada(documento, elemento.camada) || !documento.camadas.find(c => c.id === elemento.camada)?.visivel) {
      toast.error("A camada de destino está oculta ou travada."); return false;
    }
    return aplicar({ ...documento, elementos: [...documento.elementos, elemento] });
  }, [aplicar, documento]);

  const trocar = useCallback((id: string, mudanca: Partial<Elemento>) => {
    const target = documento.elementos.find((element) => element.id === id);
    if (!canEdit || !target || camadaBloqueada(documento, target.camada)) return;
    aplicar({
      ...documento,
      elementos: documento.elementos.map((elemento) => elemento.id === id ? { ...elemento, ...mudanca } as Elemento : elemento),
    });
  }, [aplicar, documento, canEdit]);

  const apagar = useCallback((id: string) => {
    const target = documento.elementos.find((element) => element.id === id);
    if (!canEdit || !target || camadaBloqueada(documento, target.camada)) return;
    aplicar({ ...documento, elementos: documento.elementos.filter((elemento) => elemento.id !== id) });
    definirSelecao(null);
  }, [aplicar, documento, canEdit, definirSelecao]);

  const desfazer = useCallback(() => {
    if (!canEdit || !historico.length) return;
    definirRefeitos([...refeitos, documento].slice(-LIMITE_HISTORICO));
    definirDocumento(historico[historico.length - 1]);
    definirHistorico(historico.slice(0, -1));
    definirSujo(true); definirSelecao(null); definirPendentes([]);
  }, [canEdit, historico, refeitos, documento, definirSelecao]);

  const refazer = useCallback(() => {
    if (!canEdit || !refeitos.length) return;
    definirHistorico([...historico, documento].slice(-LIMITE_HISTORICO));
    definirDocumento(refeitos[refeitos.length - 1]);
    definirRefeitos(refeitos.slice(0, -1));
    definirSujo(true); definirSelecao(null); definirPendentes([]);
  }, [canEdit, historico, refeitos, documento, definirSelecao]);

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
    return { x: ponto.x, y: ponto.y };
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const roda = (evento: WheelEvent) => {
      const ancora = paraMilimetros(evento);
      if (!ancora) return;
      evento.preventDefault();
      const delta = evento.deltaY * (evento.deltaMode === 1 ? 16 : evento.deltaMode === 2 ? 640 : 1);
      const fator = Math.exp(Math.max(-1, Math.min(1, delta * 0.002)));
      definirVista(anterior => zoomNaVista({ ...anterior, proporcao: 0.62 }, fator, ancora));
    };
    svg.addEventListener("wheel", roda, { passive: false });
    return () => svg.removeEventListener("wheel", roda);
  }, [paraMilimetros]);

  /** Raio de captura em milímetros de desenho, derivado do zoom. O que a mão sente é a
   *  distância na TELA: um raio fixo em milímetros seria impossível de acertar afastado
   *  e agarraria tudo de perto. */
  const toleranciaMm = useCallback(() => {
    const largura = svgRef.current?.getBoundingClientRect().width ?? 0;
    return largura > 0 ? vista.largura / largura * 14 : vista.largura / 80;
  }, [vista.largura]);

  const encaixarEm = useCallback((bruto: { x: number; y: number }, origem?: { x: number; y: number } | null) => {
    const alvo = orto && origem ? ortogonal(origem, bruto) : bruto;
    const ignorar = new Set(arrastando.current?.ids ?? (verticeArrastado.current ? [verticeArrastado.current.id] : []));
    const referencia = ignorar.size ? { ...documento, elementos: documento.elementos.filter(e => !ignorar.has(e.id)) } : documento;
    const encaixe = encaixePerto(referencia, alvo, { toleranciaMm: toleranciaMm(), origem, ativos: ativosEncaixe });
    // Com a trava ortogonal ligada, só vale o encaixe que não sai do eixo — senão a
    // trava seria desfeita pelo próprio encaixe, calada.
    if (orto && origem && encaixe.tipo !== "malha"
      && encaixe.ponto.x !== origem.x && encaixe.ponto.y !== origem.y) {
      return { tipo: "malha" as const, ponto: ortogonal(origem, { x: encaixar(alvo.x, documento.malhaMm), y: encaixar(alvo.y, documento.malhaMm) }) };
    }
    return orto && origem && encaixe.tipo === "malha" ? { ...encaixe, ponto: ortogonal(origem, encaixe.ponto) } : encaixe;
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
      acrescentar({ ...base,
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
    esconderAjuda();
    if (evento.button === 1 || evento.button === 2) {
      panorama.current = { x: evento.clientX, y: evento.clientY, vista: { x: vista.x, y: vista.y } };
      evento.currentTarget.setPointerCapture?.(evento.pointerId);
      return;
    }
    if (evento.button !== 0) return;
    const bruto = paraMilimetros(evento);
    if (!bruto) return;
    const origem = (ferramenta === "circulo" || ferramenta === "arco") && pendentes.length ? pendentes[0] : pendentes.at(-1) ?? null;
    const encaixe = encaixarEm(bruto, origem);
    const ponto = encaixe.ponto;
    definirEncaixeAtual(encaixe);

    if (ferramenta === "janelaSelecao") {
      janelaRef.current = { a: bruto, b: bruto, manter: evento.shiftKey };
      definirJanelaSelecao(janelaRef.current);
      evento.currentTarget.setPointerCapture?.(evento.pointerId);
      return;
    }
    if (ferramenta === "selecionar") {
      if (evento.shiftKey) {
        const alvo = elementoNoPonto(documento, bruto.x, bruto.y, toleranciaMm());
        if (alvo) definirSelecoes(atual => atual.includes(alvo.id) ? atual.filter(id => id !== alvo.id) : [...atual, alvo.id]);
        return;
      }
      // Vértice antes de elemento: quem clica em cima de uma alça quer a alça. Testar o
      // elemento primeiro tornaria a alça inalcançável, já que ela fica dentro dele.
      if (selecionado && canEdit && !camadaBloqueada(documento, selecionado.camada)) {
        const raio = toleranciaMm();
        const alca = verticesDe(selecionado).find((vertice) =>
          Math.hypot(vertice.ponto.x - bruto.x, vertice.ponto.y - bruto.y) <= raio);
        if (alca) {
          verticeArrastado.current = { id: selecionado.id, indice: alca.indice, documento, mudou: false };
          evento.currentTarget.setPointerCapture?.(evento.pointerId);
          return;
        }
      }
      const alvo = elementoNoPonto(documento, bruto.x, bruto.y, toleranciaMm());
      const ids = alvo ? (selecoes.includes(alvo.id) ? selecoes : [alvo.id]) : [];
      definirSelecoes(ids);
      if (alvo && canEdit) {
        arrastando.current = { ids, de: bruto, documento, mudou: false };
        evento.currentTarget.setPointerCapture?.(evento.pointerId);
      } else if (!alvo) {
        // Na seleção, arrastar o espaço vazio com o botão esquerdo desloca a vista.
        panorama.current = { x: evento.clientX, y: evento.clientY, vista: { x: vista.x, y: vista.y } };
        evento.currentTarget.setPointerCapture?.(evento.pointerId);
      }
      return;
    }
    if (ferramenta === "espelhar" || ferramenta === "aparar" || ferramenta === "estender") {
      // Estas três agem sobre a SELEÇÃO, então quem manda é a camada dela. A guarda logo
      // abaixo olha a camada da ferramenta, e recusaria espelhar uma tomada só porque a
      // camada de layout está travada.
      if (!canEdit) { toast.error("Você não tem permissão para editar esta prancha."); return; }
      if (!selecoes.length || (ferramenta !== "espelhar" && !selecionado)) { toast.error("Selecione um elemento para aparar/estender, ou um grupo para espelhar."); return; }
      if (documento.elementos.some(e => selecoes.includes(e.id) && camadaBloqueada(documento, e.camada))) {
        toast.error("A camada do elemento selecionado está travada. Destrave-a no painel de camadas.");
        return;
      }
    }
    if (ferramenta === "espelhar") {
      if (!pendentes.length) { definirPendentes([ponto]); return; }
      const copias = documento.elementos.filter(e => selecoes.includes(e.id)).map(e => espelhar(e, pendentes[0], ponto));
      definirPendentes([]);
      if (copias.some(e => !e)) { toast.error("Marque dois pontos diferentes para o eixo."); return; }
      const novas = copias.map(e => ({ ...e!, id: novoId() }));
      if (aplicar({ ...documento, elementos: [...documento.elementos, ...novas] })) definirSelecoes(novas.map(e => e.id));
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
    if (["parede", "cota", "linha", "polilinha", "retangulo", "comodo", "circulo", "arco"].includes(ferramenta)) {
      confirmarPonto(ponto); return;
    }
    if (ferramenta === "traco") {
      definirPendentes([ponto]);
      evento.currentTarget.setPointerCapture?.(evento.pointerId);
      return;
    }
    colocar(ponto);
  }

  function confirmarPonto(ponto: { x: number; y: number }) {
    if (!["parede", "cota", "linha", "polilinha", "retangulo", "comodo", "circulo", "arco"].includes(ferramenta)) { toast.error("Escolha uma ferramenta de desenho para aplicar a medida."); return; }
    if (!podeDesenhar) { toast.error("A camada está oculta ou travada, ou seu acesso é somente leitura."); return; }
    if (!pendentes.length) { definirPendentes([ponto]); return; }
    const inicio = pendentes[0];
    const ultimo = pendentes[pendentes.length - 1];
    if (Math.hypot(ultimo.x - ponto.x, ultimo.y - ponto.y) < 1e-9) { toast.error("Marque um ponto diferente."); return; }
    if (ferramenta === "polilinha" || ferramenta === "comodo") {
      if (pendentes.length >= (ferramenta === "comodo" ? 200 : 1999)) { toast.error("Limite de vértices atingido. Conclua o desenho."); return; }
      definirPendentes([...pendentes, ponto]); return;
    }
    const base = { id: novoId(), camada: camadaAtiva };
    let elemento: Elemento;
    if (ferramenta === "circulo" || ferramenta === "arco") {
      if (ferramenta === "arco" && pendentes.length === 1) { definirPendentes([...pendentes, ponto]); return; }
      const raioPonto = ferramenta === "circulo" ? ponto : pendentes[1];
      const raioMm = Math.hypot(raioPonto.x - inicio.x, raioPonto.y - inicio.y);
      elemento = { ...base, tipo: "arco", centro: inicio, raioMm, inicioGraus: anguloDe(inicio, raioPonto),
        varreduraGraus: ferramenta === "circulo" ? 360 : (anguloDe(inicio, ponto) - anguloDe(inicio, raioPonto) + 360) % 360 || 360, espessuraMm: 25 };
    } else if (ferramenta === "retangulo") {
      if (inicio.x === ponto.x || inicio.y === ponto.y) { toast.error("O retângulo precisa de largura e altura."); return; }
      elemento = { ...base, tipo: "traco", pontos: [inicio, { x: ponto.x, y: inicio.y }, ponto, { x: inicio.x, y: ponto.y }, inicio], espessuraMm: 25 };
    } else if (ferramenta === "linha") elemento = { ...base, tipo: "traco", pontos: [inicio, ponto], espessuraMm: 25 };
    else if (ferramenta === "parede") elemento = { ...base, tipo: "parede", a: inicio, b: ponto, espessuraMm: 150 };
    else elemento = { ...base, tipo: "cota", a: inicio, b: ponto, deslocamentoMm: 400 };
    if (acrescentar(elemento)) definirPendentes(ferramenta === "parede" || ferramenta === "linha" ? [ponto] : []);
  }

  function concluirPolilinha(fechar = false) {
    if (pendentes.length < (fechar ? 3 : 2)) { toast.error("Marque mais vértices para concluir a polilinha."); return; }
    const pontos = fechar ? [...pendentes, pendentes[0]] : pendentes;
    if (acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "traco", pontos, espessuraMm: 25 })) definirPendentes([]);
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
    if (janelaRef.current) {
      janelaRef.current = { ...janelaRef.current, b: bruto }; definirJanelaSelecao(janelaRef.current); return;
    }
    const origem = (ferramenta === "circulo" || ferramenta === "arco") && pendentes.length ? pendentes[0]
      : pendentes.length ? pendentes[pendentes.length - 1] : arrastando.current?.de ?? null;
    const encaixe = encaixarEm(bruto, origem);
    const ponto = encaixe.ponto;
    definirCursor(ponto);
    definirEncaixeAtual(encaixe);

    const gesto = verticeArrastado.current ?? arrastando.current;
    if (gesto) {
      const proximo = { ...gesto.documento, elementos: gesto.documento.elementos.map(item => {
        if ("indice" in gesto) return item.id === gesto.id ? moverVertice(item, gesto.indice, ponto) : item;
        return gesto.ids.includes(item.id) ? moverElemento(item, ponto.x - gesto.de.x, ponto.y - gesto.de.y, 1) : item;
      }) };
      if (!documentoSchema.safeParse(proximo).success) return;
      const mudou = JSON.stringify(proximo.elementos) !== JSON.stringify(gesto.documento.elementos);
      if (!gesto.mudou && mudou) {
        definirHistorico(h => [...h, gesto.documento].slice(-LIMITE_HISTORICO)); definirRefeitos([]);
      }
      gesto.mudou ||= mudou;
      definirDocumento(proximo);
      if (mudou) definirSujo(true);
      return;
    }
    if (ferramenta === "traco" && pendentes.length && evento.buttons === 1) {
      definirPendentes((anterior) => anterior.length < 2000 ? [...anterior, ponto] : anterior);
    }
  }

  function aoSoltar(evento?: React.PointerEvent<SVGSVGElement>) {
    if (evento?.currentTarget.hasPointerCapture?.(evento.pointerId)) evento.currentTarget.releasePointerCapture(evento.pointerId);
    if (janelaRef.current) {
      const janela = janelaRef.current;
      const ids = selecionarNaJanela(documento, janela.a, janela.b);
      definirSelecoes(janela.manter ? [...new Set([...selecoes, ...ids])] : ids);
      janelaRef.current = null; definirJanelaSelecao(null); return;
    }
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
    const origem = (ferramenta === "circulo" || ferramenta === "arco") ? pendentes[0] : pendentes.at(-1);
    if (!origem) { toast.error("Marque o ponto de partida na prancha antes de digitar a medida."); return; }
    const resolvido = resolverEntrada(origem, entrada, cursor);
    if (!resolvido) {
      toast.error("Não entendi a medida. Use 3150, 3150<90, @3000,1500 ou 3,15m.");
      return;
    }
    confirmarPonto(resolvido.ponto);
    definirEntrada("");
  }

  /** Paralela do elemento selecionado. A distância vem do campo de medida, porque é o
   *  mesmo gesto: dizer quanto. */
  function criarParalela(sinal: 1 | -1) {
    if (!selecionado || !canEdit || camadaBloqueada(documento, selecionado.camada)) return;
    const distancia = lerMedida(distanciaParalela);
    if (distancia === null || distancia === 0) { toast.error("Informe uma distância não nula para a paralela."); return; }
    const nova = paralelaDe(selecionado, Math.abs(distancia) * sinal);
    if (!nova) {
      toast.error("Este elemento não tem paralela. Vale para parede, cômodo, traço e arco.");
      return;
    }
    const id = novoId();
    if (!aplicar({ ...documento, elementos: [...documento.elementos, { ...nova, id }] })) return;
    definirSelecao(id);
    toast.success(`Paralela a ${Math.abs(distancia)} mm.`);
  }

  function repetirEmMatriz() {
    if (!selecionado || !canEdit || camadaBloqueada(documento, selecionado.camada)) return;
    const copias = matrizRetangular(selecionado, matriz, novoId);
    if (!copias.length) {
      toast.error("Revise a matriz: precisa de pelo menos uma repetição, com passo diferente de zero e no máximo 400 cópias.");
      return;
    }
    if (documento.elementos.length + copias.length > 20000) {
      toast.error("O desenho passaria do limite de 20 mil elementos.");
      return;
    }
    if (!aplicar({ ...documento, elementos: [...documento.elementos, ...copias] })) return;
    toast.success(`${copias.length} cópia(s) criadas.`);
  }

  function alternarEncaixe(tipo: TipoEncaixe) {
    definirAtivosEncaixe((anterior) => anterior.includes(tipo)
      ? anterior.filter((item) => item !== tipo) : [...anterior, tipo]);
  }

  function fecharComodo() {
    if (pendentes.length < 3) { toast.error("Um cômodo precisa de pelo menos três cantos."); return; }
    acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "comodo", pontos: pendentes, nome: "Cômodo" });
    definirPendentes([]);
  }

  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      const alvo = evento.target as HTMLElement | null;
      if (alvo && (["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName) || alvo.isContentEditable)) return;
      if (evento.ctrlKey || evento.metaKey) {
        if (evento.key.toLowerCase() === "a") { evento.preventDefault(); definirSelecoes(visiveis.filter(e => !camadaBloqueada(documento, e.camada)).map(e => e.id)); return; }
        if (evento.key.toLowerCase() === "y") { evento.preventDefault(); refazer(); return; }
        if (evento.key.toLowerCase() !== "z") return;
      }
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "z") {
        evento.preventDefault();
        if (evento.shiftKey) refazer(); else desfazer();
        return;
      }
      if (evento.key === "Escape") { definirPendentes([]); definirSelecao(null); definirEntrada(""); return; }
      if (evento.key.toLowerCase() === "o") { evento.preventDefault(); definirOrto((anterior) => !anterior); return; }
      if (evento.key === "Enter" && ferramenta === "polilinha") { evento.preventDefault(); concluirPolilinha(); return; }
      if (evento.key === "Enter" && ferramenta === "comodo") { evento.preventDefault(); fecharComodo(); return; }
      if ((evento.key === "Delete" || evento.key === "Backspace") && selecoes.length && canEdit) {
        evento.preventDefault(); operarSelecao("E"); return;
      }
      const escolhida = ferramentas.find((item) => item.atalho.toLowerCase() === evento.key.toLowerCase());
      if (escolhida) { definirFerramenta(escolhida.id); definirPendentes([]); }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  function ampliar(fator: number) {
    definirVista((anterior) => {
      const centro = { x: anterior.x + anterior.largura / 2, y: anterior.y + anterior.largura * 0.62 / 2 };
      return zoomNaVista({ ...anterior, proporcao: 0.62 }, fator, centro);
    });
  }

  function trocarCamada(id: string, mudanca: Partial<Camada>) {
    if (!canEdit) return;
    aplicar({ ...documento, camadas: documento.camadas.map(camada => camada.id === id ? { ...camada, ...mudanca } : camada) });
    if (mudanca.bloqueada || mudanca.visivel === false) definirSelecoes(selecoes.filter(el => documento.elementos.find(e => e.id === el)?.camada !== id));
  }

  function operarSelecao(input: string) {
    if (!canEdit) return;
    try {
      const result = executarNaSelecao(documento, input, selecoes);
      if (aplicar(result.document)) { definirSelecoes(result.selectedIds); definirMensagemComando(result.message); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível editar a seleção."); }
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
    if (!importado || !canEdit) return;
    try {
      const proximo = mergeCadImport(documento, importado);
      aplicar(proximo);
      definirVista(enquadrarElementos(elementosVisiveis(proximo)));
      toast.success(`${importado.elementos.length} elemento(s) importados.`);
      definirImportado(null);
      dxfEscolhido.current = null;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível importar."); }
  }

  function executarComando() {
    if (!canEdit) return;
    try {
      const normalized = comando.trim().toUpperCase();
      if (normalized === "Z" || normalized === "ZOOM") { enquadrar(); definirMensagemComando("Desenho enquadrado."); }
      else if (normalized === "U" || normalized === "UNDO") { desfazer(); definirMensagemComando("Desfazer concluído."); }
      else if (normalized === "REDO") { refazer(); definirMensagemComando("Refazer concluído."); }
      else {
        const result = executarNaSelecao(documento, comando, selecoes);
        aplicar(result.document);
        definirSelecoes(result.selectedIds);
        definirMensagemComando(result.message);
      }
      definirComando("");
    } catch (error) { definirMensagemComando(error instanceof Error ? error.message : "Comando inválido."); }
  }

  function enquadrar() {
    definirVista(enquadrarElementos(visiveis));
  }

  async function salvar() {
    if (!canEdit || salvamentoEmCurso.current) return;
    salvamentoEmCurso.current = true;
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
      definirSujo(estadoAtual.current.documento !== documento || estadoAtual.current.nome !== nome);
      onSalvo(corpo.prancha!);
      toast.success(`Prancha gravada — revisão ${corpo.prancha!.revisao}.`);
    } catch (causa) {
      toast.error(causa instanceof Error ? causa.message : "Não foi possível gravar a prancha.");
    } finally {
      salvamentoEmCurso.current = false;
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

  async function exportarPng() {
    // Private images require authenticated fetching and a separate compositing path.
    if (documento.fundo || documento.elementos.some(e => e.tipo === "imagem")) { toast.error("Para PNG, exporte uma prancha sem imagens de referência. O SVG preserva essas referências."); return; }
    const svg = exportarSvg(documento, { titulo: nome, origem: window.location.origin });
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement("canvas");
      const ratio = image.naturalHeight / image.naturalWidth;
      if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("Dimensões inválidas.");
      canvas.width = Math.min(4096, Math.round(4096 / ratio));
      canvas.height = Math.min(4096, Math.round(4096 * ratio));
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas indisponível.");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Não foi possível exportar.")), "image/png"));
      const download = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = download; link.download = `${nome.replace(/[^\p{L}\p{N}_-]/gu, "-")}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(download), 1000);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível exportar PNG."); }
    finally { URL.revokeObjectURL(url); }
  }

  const faltas = conferencia.achados.filter((achado) => achado.severidade === "falta").length;
  const passoMalha = documento.malhaMm * (vista.largura > 40000 ? 10 : vista.largura > 12000 ? 5 : 1);

  return <div className={`prancheta space-y-4 ${fullPage ? "prancheta-ampla" : ""}`}>
    <header className="prancheta-barra flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onVoltar}><ArrowLeft />Pranchas</Button>
      <Input value={nome} onChange={(evento) => { definirNome(evento.target.value); definirSujo(true); }}
        disabled={!canEdit} aria-label="Nome da prancha" className="h-10 w-full max-w-72" />
      <span className="text-xs text-hoikos-500">Revisão {revisao}{sujo ? " · alterações não gravadas" : ""}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={desfazer} disabled={!canEdit || !historico.length} aria-label="Desfazer"><Undo2 />Desfazer</Button>
        <Button variant="outline" size="sm" onClick={refazer} disabled={!canEdit || !refeitos.length} aria-label="Refazer"><Redo2 />Refazer</Button>
        {canEdit && <>
          <input ref={arquivoDxf} type="file" accept=".nexo,.dxf,text/plain,application/dxf,image/vnd.dxf,.dwg,application/json" className="sr-only"
            aria-label="Arquivo CAD para importar"
            onChange={(evento) => {
              const arquivo = evento.target.files?.[0] ?? null;
              evento.target.value = "";
              dxfEscolhido.current = arquivo;
              if (arquivo) void importar(arquivo, "");
            }} />
          <Button variant="outline" size="sm" onClick={() => arquivoDxf.current?.click()} disabled={importando}>
            {importando ? <LoaderCircle className="animate-spin" /> : <Upload />}Importar CAD
          </Button>
        </>}
        <Button variant="outline" size="sm" onClick={exportarParaCad}><Download />Exportar DXF</Button>
        <Button variant="outline" size="sm" onClick={() => baixar(exportNative(documento), "application/json", "nexo")}><Download />NEXO</Button>
        <a href="/formatos" target="_blank" rel="noreferrer" className="self-center text-xs underline">Formatos aceitos</a>
        <Button variant="outline" size="sm" onClick={exportar}><Download />SVG</Button>
        <Button variant="outline" size="sm" onClick={() => void exportarPng()}><Download />PNG</Button>
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
          <NativeSelect id="importacao-unidade" value={unidadeImportacao} className="h-10 w-44" disabled={importando || importado.report?.format === "nexo"}
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
        {importado.report?.format === "nexo" ? "Documento Nexo: coordenadas em milímetros, sem conversão de unidade." : importado.unidadeDeclarada
          ? `O arquivo declara ${UNIDADES_ROTULO[importado.unidade]?.toLowerCase() ?? importado.unidade}. Trocar aqui recalcula tudo.`
          : "O arquivo não declara a unidade. Confira a escolha antes de colocar na prancha: em metro quando era centímetro, o desenho entra cem vezes maior."}
      </p>
      {importado.avisos.length > 0 && <ul className="space-y-1 text-xs leading-5 text-hoikos-700">
        {importado.avisos.map((aviso) => <li key={aviso}>· {aviso}</li>)}
      </ul>}
      {importado.report && <p className="text-xs font-medium">Relatório {importado.report.format.toUpperCase()}: {importado.report.imported} elemento(s) convertido(s), {importado.report.discarded} descartado(s){importado.truncado ? "; arquivo truncado pelo limite de importação" : ""}.</p>}
    </section>}

    <section aria-label="Linha de comando CAD" className="rounded-xl border border-hoikos-200 bg-hoikos-50 p-3 space-y-2">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); executarComando(); }}>
        <Label htmlFor="cad-command">Comando CAD</Label>
        <Input id="cad-command" list="cad-command-options" value={comando} onChange={(event) => definirComando(event.target.value)} disabled={!canEdit} autoComplete="off" placeholder="L 0,0 3000,0" className="min-w-60 flex-1 font-mono" />
        <datalist id="cad-command-options">{CAD_COMMANDS.map((item) => <option key={item.alias} value={item.syntax}>{item.description}</option>)}</datalist>
        <Button type="submit" disabled={!canEdit || !comando.trim()}>Executar</Button>
      </form>
      <p role="status" aria-live="polite" className="text-xs">{mensagemComando}</p>
      <details className="text-xs"><summary className="cursor-pointer">Comandos e exemplos</summary><div className="grid gap-2 pt-3 sm:grid-cols-2 lg:grid-cols-3">{CAD_COMMANDS.map((item) => <button key={item.alias} type="button" className="rounded border p-2 text-left" onClick={() => definirComando(item.syntax)} disabled={!canEdit}><code>{item.syntax}</code><span className="block pt-1">{item.description}</span></button>)}</div></details>
    </section>
    <div className="prancheta-area grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)_20rem]">
      <aside className="prancheta-ferramentas space-y-3">
        <div className="grid grid-cols-4 gap-1 xl:grid-cols-3">
          {ferramentas.map((item) => <div key={item.id} className="relative">
            <button type="button"
              onClick={() => { esconderAjuda(); definirFerramenta(item.id); definirPendentes([]); }}
              onPointerEnter={(evento) => { if (evento.pointerType === "mouse") aguardarAjuda(item.id); }}
              onPointerMove={(evento) => { if (evento.pointerType === "mouse") aguardarAjuda(item.id); }}
              onPointerLeave={esconderAjuda} onPointerDown={esconderAjuda}
              aria-pressed={ferramenta === item.id} aria-label={`${item.rotulo} (${item.atalho})`}
              aria-describedby={ajudaVisivel === item.id ? `ajuda-${item.id}` : undefined}
              className="grid h-11 w-full place-items-center rounded-md border border-hoikos-200 bg-white text-hoikos-700 aria-pressed:border-hoikos-800 aria-pressed:bg-hoikos-800 aria-pressed:text-white">
              <item.icone className="size-4" />
            </button>
            {ajudaVisivel === item.id && <div id={`ajuda-${item.id}`} role="tooltip"
              className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-64 rounded-md border border-hoikos-200 bg-white p-3 text-left shadow-lg">
              <p className="text-sm font-semibold text-hoikos-900">{item.rotulo} · tecla {item.atalho}</p>
              <p className="mt-1 text-xs leading-5 text-hoikos-700">{instrucoes[item.id]}</p>
            </div>}
          </div>)}
        </div>
        <p className="text-xs leading-5 text-hoikos-500">{ferramentas.find((item) => item.id === ferramenta)?.rotulo}</p>

        <Label htmlFor="camada-desenho">Camada de desenho</Label>
        <NativeSelect id="camada-desenho" value={camadaEscolhida} onChange={e => definirCamadaEscolhida(e.target.value)}>
          <option value="">Automática pela ferramenta</option>
          {documento.camadas.map(c => <option key={c.id} value={c.id} disabled={c.bloqueada || !c.visivel}>{c.nome}</option>)}
        </NativeSelect>
        <p className="text-xs text-hoikos-500">{instrucoes[ferramenta]}</p>
        {ferramenta === "polilinha" && pendentes.length > 0 && <div className="space-y-1">
          <Button size="sm" onClick={() => concluirPolilinha()}>Concluir polilinha</Button>
          <Button size="sm" variant="outline" onClick={() => concluirPolilinha(true)}>Fechar polilinha</Button>
        </div>}
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
              onChange={(evento) => { void redimensionarFundo(Number(evento.target.value)); }} />
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
          <NativeSelect id="prancheta-malha" value={String(documento.malhaMm)} disabled={!canEdit}
            onChange={(evento) => aplicar({ ...documento, malhaMm: Number(evento.target.value) })}>
            {MALHAS.map((malha) => <option key={malha} value={malha}>{malha === 1 ? "Livre (sem malha)" : `${malha} mm`}</option>)}
          </NativeSelect>
          <Label htmlFor="prancheta-escala" className="text-xs">Escala de impressão</Label>
          <NativeSelect id="prancheta-escala" value={String(documento.escala)} disabled={!canEdit}
            onChange={(evento) => aplicar({ ...documento, escala: Number(evento.target.value) })}>
            {ESCALAS.map((escala) => <option key={escala} value={escala}>1:{escala}</option>)}
          </NativeSelect>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="flex-1" onClick={enquadrar} aria-label="Enquadrar desenho"><Grid2x2 /></Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => ampliar(0.8)} aria-label="Aproximar"><ZoomIn /></Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => ampliar(1.25)} aria-label="Afastar"><ZoomOut /></Button>
          </div>
        </div>
      </aside>

      <div className="prancheta-mesa overflow-hidden rounded-md border border-hoikos-200 bg-white">
        <svg ref={svgRef} role="application" aria-label={`Prancha ${nome}`}
          viewBox={`${vista.x} ${vista.y} ${vista.largura} ${vista.largura * 0.62}`}
          className={fullPage ? "w-full touch-none" : "h-[min(70svh,640px)] w-full touch-none"}
          style={fullPage ? { height: "max(420px, calc(100svh - 16rem))" } : undefined}
          onPointerDown={aoApontar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={() => { const gesto = arrastando.current ?? verticeArrastado.current; if (gesto?.mudou) { definirDocumento(gesto.documento); definirHistorico(h => h.slice(0, -1)); } arrastando.current = null; verticeArrastado.current = null; panorama.current = null; janelaRef.current = null; definirJanelaSelecao(null); definirPendentes([]); }} onPointerLeave={() => definirCursor(null)}
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
          {visiveis.map((elemento) => <DesenhoElemento key={elemento.id} elemento={elemento} selecionado={selecoes.includes(elemento.id)} minimumStroke={vista.largura / 800} />)}
          {janelaSelecao && <rect x={Math.min(janelaSelecao.a.x, janelaSelecao.b.x)} y={Math.min(janelaSelecao.a.y, janelaSelecao.b.y)} width={Math.abs(janelaSelecao.b.x - janelaSelecao.a.x)} height={Math.abs(janelaSelecao.b.y - janelaSelecao.a.y)} fill="#846100" fillOpacity={0.1} stroke="#846100" strokeWidth={vista.largura / 800} />}
          {ferramenta === "retangulo" && pendentes[0] && cursor && <rect x={Math.min(pendentes[0].x, cursor.x)} y={Math.min(pendentes[0].y, cursor.y)} width={Math.abs(pendentes[0].x - cursor.x)} height={Math.abs(pendentes[0].y - cursor.y)} fill="none" stroke="#846100" strokeWidth={vista.largura / 800} />}
          {/* Prévia do traço. Para círculo e arco ela precisa ser a curva: uma linha até o
              cursor não diria nada sobre o raio que está sendo marcado. */}
          {pendentes.length > 0 && (ferramenta === "circulo" || ferramenta === "arco")
            ? (() => {
              const centro = pendentes[0];
              const referencia = pendentes[1] ?? cursor;
              if (!referencia) return null;
              const raio = Math.hypot(referencia.x - centro.x, referencia.y - centro.y);
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
          {canEdit && ferramenta === "selecionar" && selecionado && !camadaBloqueada(documento, selecionado.camada) && verticesDe(selecionado).map((vertice) => <rect key={vertice.indice}
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
            {cursor ? `X ${Number(cursor.x.toFixed(3))} mm · Y ${Number((-cursor.y).toFixed(3))} mm` : "Mova o cursor sobre a prancha"}
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
            {selecoes.length > 0 && <section aria-label="Editar seleção" className="space-y-2 border-b pb-3">
              <p className="text-sm">{selecoes.length} elemento(s) selecionado(s)</p>
              {canEdit && <>
                <div className="grid grid-cols-2 gap-2">
                  {([ ["dx", "Deslocamento X (mm)"], ["dy", "Deslocamento Y (mm)"], ["x", "Pivô X (mm)"], ["y", "Pivô Y (mm)"], ["angulo", "Ângulo (graus)"], ["fator", "Fator de escala"] ] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<Input aria-label={label} value={transformacao[key]} onChange={e => definirTransformacao(v => ({ ...v, [key]: e.target.value }))} /></label>)}
                </div>
                <p className="text-xs text-hoikos-500">Y positivo sobe. Giro positivo é anti-horário. Pivô em coordenadas do desenho.</p>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => operarSelecao(`M @${transformacao.dx},${transformacao.dy}`)}>Mover seleção</Button>
                  <Button size="sm" variant="outline" onClick={() => operarSelecao(`CO @${transformacao.dx},${transformacao.dy}`)}>Copiar seleção</Button>
                  <Button size="sm" variant="outline" onClick={() => operarSelecao(`RO ${transformacao.angulo} ${transformacao.x},${transformacao.y}`)}>Girar seleção</Button>
                  <Button size="sm" variant="outline" onClick={() => operarSelecao(`SC ${transformacao.fator} ${transformacao.x},${transformacao.y}`)}>Escalar seleção</Button>
                  <Button size="sm" variant="outline" onClick={() => operarSelecao("E")}><Trash2 />Apagar seleção</Button>
                </div>
                <Label htmlFor="selecao-camada">Mover seleção para camada</Label>
                <NativeSelect id="selecao-camada" value="" onChange={e => {
                  const camada = e.target.value;
                  if (!camada || documento.elementos.some(el => selecoes.includes(el.id) && camadaBloqueada(documento, el.camada))) return;
                  aplicar({ ...documento, elementos: documento.elementos.map(el => selecoes.includes(el.id) ? { ...el, camada } : el) });
                }}><option value="">Escolha a camada…</option>{documento.camadas.filter(c => !c.bloqueada && c.visivel).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</NativeSelect>
              </>}
              <Button size="sm" variant="outline" onClick={() => definirSelecoes([])}>Limpar seleção</Button>
            </section>}

            {!selecionado ? <p className="text-sm text-hoikos-500">{selecoes.length > 1 ? "Seleção múltipla ativa. Para editar propriedades individuais, selecione um único elemento." : "Nada selecionado."} Use a ferramenta de seleção e clique sobre um elemento do desenho.</p> : <>
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
                    const valor = Number(evento.target.value);
                    if (Number.isFinite(valor) && valor >= 10) trocar(selecionado.id, { larguraMm: valor } as Partial<Elemento>);
                  }} />
              </div>}
              {"alturaMm" in selecionado && <div className="space-y-1">
                <Label htmlFor="prop-altura" className="text-xs">{selecionado.tipo === "texto" ? "Corpo do texto (mm)" : "Profundidade (mm)"}</Label>
                <Input id="prop-altura" type="number" inputMode="numeric" value={selecionado.alturaMm} disabled={!canEdit}
                  onChange={(evento) => {
                    const valor = Number(evento.target.value);
                    if (Number.isFinite(valor) && valor >= 10) trocar(selecionado.id, { alturaMm: valor } as Partial<Elemento>);
                  }} />
              </div>}
              {"espessuraMm" in selecionado && <div className="space-y-1">
                <Label htmlFor="prop-espessura" className="text-xs">Espessura (mm)</Label>
                <Input id="prop-espessura" type="number" inputMode="numeric" value={selecionado.espessuraMm} disabled={!canEdit}
                  onChange={(evento) => {
                    const valor = Number(evento.target.value);
                    if (Number.isFinite(valor) && valor >= 1) trocar(selecionado.id, { espessuraMm: valor } as Partial<Elemento>);
                  }} />
              </div>}
              {"rotacaoGraus" in selecionado && <div className="space-y-1">
                <Label htmlFor="prop-giro" className="text-xs">Giro (graus)</Label>
                <Input id="prop-giro" type="number" inputMode="numeric" min={0} max={359} value={selecionado.rotacaoGraus} disabled={!canEdit}
                  onChange={(evento) => {
                    const valor = Number(evento.target.value);
                    if (Number.isFinite(valor)) trocar(selecionado.id, { rotacaoGraus: ((valor % 360) + 360) % 360 } as Partial<Elemento>);
                  }} />
              </div>}
              {selecionado.tipo === "arco" && <>
                <div className="space-y-1">
                  <Label htmlFor="prop-raio" className="text-xs">Raio (mm)</Label>
                  <Input id="prop-raio" type="number" inputMode="numeric" value={selecionado.raioMm} disabled={!canEdit}
                    onChange={(evento) => {
                      const valor = Number(evento.target.value);
                      if (Number.isFinite(valor) && valor >= 1) trocar(selecionado.id, { raioMm: valor } as Partial<Elemento>);
                    }} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="prop-varredura" className="text-xs">Varredura (graus)</Label>
                  <Input id="prop-varredura" type="number" inputMode="numeric" min={1} max={360} value={selecionado.varreduraGraus} disabled={!canEdit}
                    onChange={(evento) => {
                      const valor = Number(evento.target.value);
                      if (Number.isFinite(valor) && valor >= 1 && valor <= 360) trocar(selecionado.id, { varreduraGraus: valor } as Partial<Elemento>);
                    }} />
                </div>
                <p className="text-xs text-hoikos-500">
                  {selecionado.varreduraGraus >= 360 ? "Círculo completo." : `Arco de ${selecionado.varreduraGraus}° a partir de ${selecionado.inicioGraus}°.`}
                </p>
              </>}
              {selecionado.tipo === "cota" && <label className="text-xs">Afastamento da cota (mm)<Input type="number" step="any" value={selecionado.deslocamentoMm} disabled={!canEdit} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) trocar(selecionado.id, { deslocamentoMm: v }); }} /></label>}
              {selecionado.tipo === "parede" && <p className="text-xs text-hoikos-500">Comprimento {metros(comprimentoM(selecionado.a, selecionado.b))}.</p>}
              {canEdit && <div className="space-y-2 border-t border-hoikos-200 pt-3">
                <p className="eyebrow text-hoikos-600">Repetir em matriz</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="matriz-colunas" className="text-xs">Colunas</Label>
                    <Input id="matriz-colunas" type="number" inputMode="numeric" min={1} value={matriz.colunas}
                      onChange={(evento) => definirMatriz((anterior) => ({ ...anterior, colunas: Number(evento.target.value) || 1 }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="matriz-linhas" className="text-xs">Linhas</Label>
                    <Input id="matriz-linhas" type="number" inputMode="numeric" min={1} value={matriz.linhas}
                      onChange={(evento) => definirMatriz((anterior) => ({ ...anterior, linhas: Number(evento.target.value) || 1 }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="matriz-passo-x" className="text-xs">Passo →  (mm)</Label>
                    <Input id="matriz-passo-x" type="number" inputMode="numeric" value={matriz.passoXMm}
                      onChange={(evento) => definirMatriz((anterior) => ({ ...anterior, passoXMm: Number(evento.target.value) || 0 }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="matriz-passo-y" className="text-xs">Passo ↓ (mm)</Label>
                    <Input id="matriz-passo-y" type="number" inputMode="numeric" value={matriz.passoYMm}
                      onChange={(evento) => definirMatriz((anterior) => ({ ...anterior, passoYMm: Number(evento.target.value) || 0 }))} />
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={repetirEmMatriz}>
                  <Grid3x3 />Repetir {Math.max(0, matriz.colunas * matriz.linhas - 1)} vez(es)
                </Button>
              </div>}
              {canEdit && paralelaDe(selecionado, 1) && <div className="space-y-1 border-t border-hoikos-200 pt-3">
                <Label htmlFor="distancia-paralela">Distância da paralela (mm)</Label>
                <Input id="distancia-paralela" value={distanciaParalela} onChange={e => definirDistanciaParalela(e.target.value)} placeholder="100 ou 0,15m" />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => criarParalela(1)}><Copy />Um lado</Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => criarParalela(-1)}><Copy />Outro lado</Button>
                </div>
              </div>}
              {canEdit && <Button variant="outline" size="sm" onClick={() => apagar(selecionado.id)}><Trash2 />Apagar elemento</Button>}
            </>}
          </TabsContent>

          <TabsContent value="camadas" className="space-y-2 pt-3">
            {canEdit && <form className="flex gap-2" onSubmit={e => {
              e.preventDefault(); const nome = novaCamada.trim(); if (!nome) return;
              const id = novoId();
              if (aplicar({ ...documento, camadas: [...documento.camadas, { id, nome, disciplina: "layout", visivel: true, bloqueada: false }] })) { definirNovaCamada(""); definirCamadaEscolhida(id); }
            }}><Input aria-label="Nome da nova camada" maxLength={60} value={novaCamada} onChange={e => definirNovaCamada(e.target.value)} placeholder="Nova camada" /><Button type="submit" disabled={!novaCamada.trim() || documento.camadas.length >= 60}>Criar</Button></form>}

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
