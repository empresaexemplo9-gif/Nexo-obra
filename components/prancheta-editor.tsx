"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft, Blinds, BrickWall, ChevronsLeftRight, CircleDashed, DoorOpen, Download, Eye, EyeOff, Grid2x2, Image as ImageIcon, LandPlot, LoaderCircle,
  Lock, LockOpen, Moon, MousePointer2, PencilLine, Plug, RectangleHorizontal, Redo2, Save, Search, Slash, Sofa, Sun,
  Copy, CopySlash, CornerDownRight, Eraser, FlipHorizontal2, Grid3x3, Hexagon, Link2, Move, MoveDiagonal2, MoveHorizontal, RotateCw, RulerDimensionLine, Scaling, Scissors, Shrink,
  Spline, SquareDashed, SquareSlash, StretchHorizontal, Unlink, Waypoints,
  Trash2, Type, Undo2, Upload, ZoomIn, ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { exportarDxf } from "@/lib/integrations/dxf";
import { desenharPrancha } from "@/components/prancheta-canvas";
import { corNaTela, TIPOS_LINHA, tipoLinhaLabels, tracejadoPara, type TipoLinha } from "@/lib/cad-cores";
import { CABECALHO_ACEITA, corpoComprimido, JSON_GZIP, jsonDaResposta } from "@/lib/compressao";
import { uploadOrgFile } from "@/lib/org-files-client";
import { nearestOnSegment } from "@/packages/cad-core";
import { zoomNaVista, enquadrarElementos } from "@/lib/prancheta-viewport";
import { executarNaSelecao, selecionarCruzando, selecionarNaJanela } from "@/lib/cad-selection";
import { CAD_COMMANDS } from "@/lib/cad-commands";
import { COMANDOS, Interprete, acharComando, sugerirComandos, textoDoPedido, type AcaoEditor, type Pedido } from "@/lib/cad-interativo";
import { exportNative, mergeCadImport, type ImportReport } from "@/lib/cad-formats";
import { conferir } from "@/lib/parametros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Encaixe, TIPOS_ENCAIXE, TipoEncaixe, encaixeLabels, encaixePerto, moverVertice,
  lerMedida, matrizRetangular, ortogonal, paralelaDe, verticesDe,
} from "@/lib/prancheta-cad";
import {
  Camada, DISCIPLINAS, Documento, Elemento, FAMILIAS_SIMBOLO, LIMITE_CAMADAS, LIMITE_ELEMENTOS, areaM2, camadaBloqueada, caminhoDosAneis,
  comprimentoM, disciplinaLabels, elementosVisiveis, encaixar, exportarSvg, glifoDoSimbolo,
  elementoSchema, pontosDoArco, validarAlteracao,
  limitesEmCache, moverElemento, quantitativo, simboloLabels,
} from "@/lib/prancheta";

type Ferramenta =
  | "selecionar" | "parede" | "comodo" | "porta" | "janela" | "passagem"
  | "simbolo" | "mobilia" | "imagem" | "traco";

type ItemBiblioteca = {
  id: string; nome: string; categoria: string; larguraMm: number | null;
  alturaMm: number | null; desenhavel: boolean; url: string;
};

export type Prancha = {
  id: string; nome: string; especie: string; revisao: number;
  projectId: string | null; projectName: string | null;
  documento: Documento; atualizadoEm: string; autor: string | null;
};

type Botao = { id: string; rotulo: string; icone: typeof MousePointer2; atalho: string; ferramenta?: Ferramenta; comando?: string };

// Cada botão é um comando, como na faixa de opções do AutoCAD: o atalho mostrado é o que
// se digita na linha de comando. As ferramentas de arquitetura (parede, porta…) seguem
// como modos de clique.
const botoesDesenho: Botao[] = [
  { id: "selecionar", rotulo: "Selecionar", icone: MousePointer2, atalho: "Esc", ferramenta: "selecionar" },
  { id: "linha", rotulo: "Linha", icone: Slash, atalho: "L", comando: "LINHA" },
  { id: "polilinha", rotulo: "Polilinha", icone: Waypoints, atalho: "PL", comando: "POLILINHA" },
  { id: "retangulo", rotulo: "Retângulo", icone: RectangleHorizontal, atalho: "REC", comando: "RETANGULO" },
  { id: "circulo", rotulo: "Círculo", icone: CircleDashed, atalho: "C", comando: "CIRCULO" },
  { id: "arco", rotulo: "Arco", icone: Spline, atalho: "A", comando: "ARCO" },
  { id: "poligono", rotulo: "Polígono", icone: Hexagon, atalho: "POL", comando: "POLIGONO" },
  { id: "texto", rotulo: "Texto", icone: Type, atalho: "T", comando: "TEXTO" },
  { id: "cota", rotulo: "Cota", icone: RulerDimensionLine, atalho: "DIM", comando: "COTA" },
  { id: "parede", rotulo: "Parede", icone: BrickWall, atalho: "PAREDE", ferramenta: "parede" },
  { id: "comodo", rotulo: "Cômodo", icone: LandPlot, atalho: "COMODO", ferramenta: "comodo" },
  { id: "porta", rotulo: "Porta", icone: DoorOpen, atalho: "PORTA", ferramenta: "porta" },
  { id: "janela", rotulo: "Janela", icone: Blinds, atalho: "JANELA", ferramenta: "janela" },
  { id: "passagem", rotulo: "Passagem", icone: ChevronsLeftRight, atalho: "PASSAGEM", ferramenta: "passagem" },
  { id: "simbolo", rotulo: "Ponto elétrico ou luminária", icone: Plug, atalho: "SIMBOLO", ferramenta: "simbolo" },
  { id: "mobilia", rotulo: "Mobília", icone: Sofa, atalho: "MOVEL", ferramenta: "mobilia" },
  { id: "imagem", rotulo: "Imagem da biblioteca", icone: ImageIcon, atalho: "IMAGEM", ferramenta: "imagem" },
  { id: "traco", rotulo: "Traço livre", icone: PencilLine, atalho: "TRACOLIVRE", ferramenta: "traco" },
];

const botoesModificar: Botao[] = [
  { id: "mover", rotulo: "Mover", icone: Move, atalho: "M", comando: "MOVER" },
  { id: "copiar", rotulo: "Copiar", icone: Copy, atalho: "CO", comando: "COPIAR" },
  { id: "girar", rotulo: "Girar", icone: RotateCw, atalho: "RO", comando: "ROTACIONAR" },
  { id: "escala", rotulo: "Escala", icone: Scaling, atalho: "SC", comando: "ESCALA" },
  { id: "espelhar", rotulo: "Espelhar", icone: FlipHorizontal2, atalho: "MI", comando: "ESPELHAR" },
  { id: "deslocamento", rotulo: "Deslocamento (paralela)", icone: CopySlash, atalho: "O", comando: "DESLOCAMENTO" },
  { id: "aparar", rotulo: "Aparar", icone: Scissors, atalho: "TR", comando: "APARAR" },
  { id: "estender", rotulo: "Estender", icone: MoveHorizontal, atalho: "EX", comando: "ESTENDER" },
  { id: "concordar", rotulo: "Concordar", icone: CornerDownRight, atalho: "F", comando: "CONCORDAR" },
  { id: "chanfrar", rotulo: "Chanfrar", icone: SquareSlash, atalho: "CHA", comando: "CHANFRAR" },
  { id: "quebrar", rotulo: "Quebrar", icone: Unlink, atalho: "BR", comando: "QUEBRAR" },
  { id: "unir", rotulo: "Unir", icone: Link2, atalho: "J", comando: "UNIR" },
  { id: "esticar", rotulo: "Esticar", icone: StretchHorizontal, atalho: "S", comando: "ESTICAR" },
  { id: "matriz", rotulo: "Matriz", icone: Grid3x3, atalho: "AR", comando: "MATRIZ" },
  { id: "explodir", rotulo: "Explodir", icone: Shrink, atalho: "X", comando: "EXPLODIR" },
  { id: "apagar", rotulo: "Apagar", icone: Eraser, atalho: "E", comando: "APAGAR" },
  { id: "dist", rotulo: "Medir distância", icone: MoveDiagonal2, atalho: "DI", comando: "DIST" },
  { id: "area", rotulo: "Medir área", icone: SquareDashed, atalho: "AA", comando: "AREA" },
];

const instrucoes: Record<Ferramenta, string> = {
  selecionar: "Clique nos objetos para selecionar; Shift+clique tira da seleção. Arraste da esquerda para a direita para selecionar o que está inteiro dentro da janela, ou da direita para a esquerda para pegar tudo que ela cruza. Segure o botão esquerdo sobre a seleção e arraste para mover. Clique numa alça para esticar.",
  parede: "Clique no início e no fim da parede. Continue clicando para encadear paredes; Enter ou Esc encerra.",
  comodo: "Clique em cada canto do cômodo; Enter ou clique direito fecha.",
  porta: "Clique no ponto onde a porta deve ser colocada e ajuste suas medidas no painel Seleção.",
  janela: "Clique no ponto da janela e ajuste largura ou rotação no painel Seleção.",
  passagem: "Clique no ponto da passagem e ajuste suas medidas no painel Seleção.",
  simbolo: "Escolha o símbolo no painel e clique no desenho para colocá-lo.",
  mobilia: "Clique no desenho para inserir um móvel e ajuste suas dimensões no painel Seleção.",
  imagem: "Escolha uma imagem da biblioteca e clique no desenho para colocá-la.",
  traco: "Segure o botão esquerdo e arraste para desenhar um traço livre; solte para concluir.",
};

const ajudaDoBotao = (botao: Botao) => botao.ferramenta ? instrucoes[botao.ferramenta] : acharComando(botao.comando ?? "")?.descricao ?? "";

// A ferramenta decide em que camada o desenho cai. Obrigar a escolher a camada antes de
// cada traço seria burocracia: quem coloca uma tomada está no elétrico por definição.
const camadaDaFerramenta: Record<Ferramenta, string> = {
  selecionar: "layout", parede: "layout", comodo: "layout", porta: "layout",
  janela: "layout", passagem: "layout", simbolo: "eletrico", mobilia: "mobiliario",
  imagem: "mobiliario", traco: "anotacao",
};

type Importado = {
  nomeArquivo: string; unidade: string; unidadeDeclarada: boolean;
  camadas: Camada[]; elementos: Elemento[]; avisos: string[]; truncado: boolean;
  report?: ImportReport;
};

const rotuloDoTipo: Record<Elemento["tipo"], string> = {
  parede: "Parede", comodo: "Cômodo", abertura: "Abertura", simbolo: "Símbolo", mobilia: "Mobília", imagem: "Imagem",
  texto: "Texto", cota: "Cota", traco: "Linha", arco: "Arco", hachura: "Hachura",
};

const UNIDADES_ROTULO: Record<string, string> = {
  mm: "Milímetro", cm: "Centímetro", m: "Metro", polegada: "Polegada", pe: "Pé",
};

const MALHAS = [1, 10, 25, 50, 100, 250, 500];
/** Acima disto o desenho é pintado em canvas; o SVG fica só com seleção, cursor e prévias. */
const LIMITE_SVG = 2000;
const ESCALAS = [20, 25, 50, 75, 100, 200];
const LIMITE_HISTORICO = 60;

/** Medida na dica do cursor: vírgula decimal e sem separador de milhar, que confundiria com decimal. */
const medidaMm = (valor: number) => Number(valor.toFixed(2)).toLocaleString("pt-BR", { useGrouping: false, maximumFractionDigits: 2 });
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
    const caixa = limitesEmCache(elemento);
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
    if (elemento.tipo === "hachura" && !dentroDosAneis(elemento.aneis, x, y)) continue;
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

/** Traço fino que não some ao afastar: o maior entre a espessura real e um fio da tela.
 *  A variável fica no SVG, então aproximar não obriga a redesenhar cada elemento. */
const fio = (espessuraMm: number): CSSProperties => ({ strokeWidth: `max(${espessuraMm}px, var(--traco-min))` });

// Memorizado: um DWG importado tem dezenas de milhares de elementos, e redesenhar todos a
// cada movimento do cursor travava a tela. Só o que mudou volta a ser desenhado.
const DesenhoElemento = memo(function DesenhoElemento({ elemento, selecionado, cor, tracejado, realceCor }: {
  elemento: Elemento; selecionado: boolean; cor: string; tracejado?: string; realceCor: string;
}) {
  const realce = selecionado ? { stroke: realceCor, strokeWidth: 60, strokeOpacity: 0.35 } : null;
  const giro = "rotacaoGraus" in elemento && elemento.rotacaoGraus
    ? `rotate(${elemento.rotacaoGraus} ${elemento.posicao.x} ${elemento.posicao.y})` : undefined;

  if (elemento.tipo === "parede") {
    return <g>
      {realce && <line x1={elemento.a.x} y1={elemento.a.y} x2={elemento.b.x} y2={elemento.b.y} {...realce} strokeWidth={elemento.espessuraMm + 140} />}
      <line x1={elemento.a.x} y1={elemento.a.y} x2={elemento.b.x} y2={elemento.b.y} stroke={cor} strokeWidth={elemento.espessuraMm} strokeLinecap="square" />
    </g>;
  }
  if (elemento.tipo === "comodo") {
    const pontos = elemento.pontos.map((ponto) => `${ponto.x},${ponto.y}`).join(" ");
    const centro = elemento.pontos.reduce((soma, ponto) => ({
      x: soma.x + ponto.x / elemento.pontos.length, y: soma.y + ponto.y / elemento.pontos.length,
    }), { x: 0, y: 0 });
    return <g>
      <polygon points={pontos} fill="#B5B19E" fillOpacity={selecionado ? 0.34 : 0.18} stroke={realceCor} strokeWidth={selecionado ? 50 : 20} />
      {elemento.nome && <>
        <text x={centro.x} y={centro.y} fontSize={220} textAnchor="middle" fill={cor}>{elemento.nome}</text>
        <text x={centro.x} y={centro.y + 260} fontSize={170} textAnchor="middle" fill={realceCor}>{metrosQuadrados(areaM2(elemento.pontos))}</text>
      </>}
    </g>;
  }
  if (elemento.tipo === "abertura") {
    const meia = elemento.larguraMm / 2;
    return <g transform={giro} stroke={selecionado ? realceCor : cor}>
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
        {selecionado && <circle r={420} fill={realceCor} fillOpacity={0.14} />}
        <path d={glifo.d} fill={glifo.preenchido ? realceCor : "none"} stroke={realceCor} strokeWidth={35} />
      </g>
    </g>;
  }
  if (elemento.tipo === "mobilia") {
    return <g transform={giro}>
      <rect x={elemento.posicao.x - elemento.larguraMm / 2} y={elemento.posicao.y - elemento.alturaMm / 2}
        width={elemento.larguraMm} height={elemento.alturaMm} rx={40}
        fill="#F4F2E9" fillOpacity={0.9} stroke={selecionado ? realceCor : cor} strokeWidth={selecionado ? 60 : 25} />
      <text x={elemento.posicao.x} y={elemento.posicao.y + 60} fontSize={150} textAnchor="middle" fill="#38301B">{elemento.rotulo}</text>
    </g>;
  }
  if (elemento.tipo === "imagem") {
    return <g transform={giro}>
      <image href={elemento.chave} x={elemento.posicao.x - elemento.larguraMm / 2} y={elemento.posicao.y - elemento.alturaMm / 2}
        width={elemento.larguraMm} height={elemento.alturaMm} preserveAspectRatio="xMidYMid slice" />
      {selecionado && <rect x={elemento.posicao.x - elemento.larguraMm / 2} y={elemento.posicao.y - elemento.alturaMm / 2}
        width={elemento.larguraMm} height={elemento.alturaMm} fill="none" stroke={realceCor} strokeWidth={60} />}
    </g>;
  }
  if (elemento.tipo === "texto") {
    return <g transform={giro}>
      <text x={elemento.posicao.x} y={elemento.posicao.y} fontSize={elemento.alturaMm} fontFamily="Arial, Helvetica, sans-serif" fill={selecionado ? realceCor : cor}
        textAnchor={elemento.ancoraH === "meio" ? "middle" : elemento.ancoraH === "fim" ? "end" : "start"}
        dominantBaseline={elemento.ancoraV === "meio" ? "central" : elemento.ancoraV === "topo" ? "hanging" : "alphabetic"}>{elemento.texto}</text>
    </g>;
  }
  if (elemento.tipo === "cota") {
    const meio = { x: (elemento.a.x + elemento.b.x) / 2, y: (elemento.a.y + elemento.b.y) / 2 + elemento.deslocamentoMm };
    return <g stroke={realceCor} strokeWidth={selecionado ? 40 : 18} fill="none">
      <line x1={elemento.a.x} y1={elemento.a.y + elemento.deslocamentoMm} x2={elemento.b.x} y2={elemento.b.y + elemento.deslocamentoMm} />
      <line x1={elemento.a.x} y1={elemento.a.y} x2={elemento.a.x} y2={elemento.a.y + elemento.deslocamentoMm} />
      <line x1={elemento.b.x} y1={elemento.b.y} x2={elemento.b.x} y2={elemento.b.y + elemento.deslocamentoMm} />
      <text x={meio.x} y={meio.y - 80} fontSize={180} textAnchor="middle" fill={realceCor} stroke="none">{metros(comprimentoM(elemento.a, elemento.b))}</text>
    </g>;
  }
  if (elemento.tipo === "hachura") {
    return <path d={caminhoDosAneis(elemento.aneis)} fill={cor} fillOpacity={elemento.solida ? (selecionado ? 0.6 : 1) : selecionado ? 0.5 : 0.28} fillRule="evenodd"
      stroke={selecionado ? realceCor : "none"} style={selecionado ? fio(1) : undefined} />;
  }
  // Arco e traço desenham a mesma coisa: uma polilinha. O arco chega em pontos pela
  // mesma tessellation que alimenta o arquivo exportado, então tela e papel concordam.
  const linha = elemento.tipo === "arco" ? pontosDoArco(elemento) : elemento.pontos;
  return <polyline points={linha.map((ponto) => `${ponto.x},${ponto.y}`).join(" ")} fill="none"
    stroke={selecionado ? realceCor : cor} style={fio(elemento.espessuraMm)} strokeDasharray={tracejado}
    strokeLinecap="round" strokeLinejoin="round" />;
});

/** O desenho como um bloco memorizado: re-renderizar o editor (a cada movimento do
 *  cursor) não percorre os milhares de elementos filhos. */
const CamadaDesenho = memo(function CamadaDesenho({ children }: { children: React.ReactNode }) {
  return <g>{children}</g>;
});

/** Ponto dentro dos anéis pela regra par-ímpar, a mesma do preenchimento na tela. */
function dentroDosAneis(aneis: { x: number; y: number }[][], x: number, y: number) {
  let dentro = false;
  for (const anel of aneis) {
    for (let a = 0, b = anel.length - 1; a < anel.length; b = a++) {
      const p = anel[a], q = anel[b];
      if ((p.y > y) !== (q.y > y) && x < (q.x - p.x) * (y - p.y) / (q.y - p.y) + p.x) dentro = !dentro;
    }
  }
  return dentro;
}

/** Contorno de um elemento provisório, para a prévia tracejada dos comandos. */
function caminhoDaPrevia(elemento: Elemento): string {
  const linha = (pontos: { x: number; y: number }[], fechar = false) => pontos.length ? `M ${pontos.map((p) => `${p.x} ${p.y}`).join(" L ")}${fechar ? " Z" : ""}` : "";
  switch (elemento.tipo) {
    case "traco": return linha(elemento.pontos);
    case "arco": return linha(pontosDoArco(elemento));
    case "parede": return linha([elemento.a, elemento.b]);
    case "cota": {
      const d = elemento.deslocamentoMm;
      return `${linha([elemento.a, { x: elemento.a.x, y: elemento.a.y + d }, { x: elemento.b.x, y: elemento.b.y + d }, elemento.b])}`;
    }
    case "comodo": return linha(elemento.pontos, true);
    case "hachura": return caminhoDosAneis(elemento.aneis);
    default: {
      const caixa = limitesEmCache(elemento);
      return linha([{ x: caixa.x1, y: caixa.y1 }, { x: caixa.x2, y: caixa.y1 }, { x: caixa.x2, y: caixa.y2 }, { x: caixa.x1, y: caixa.y2 }], true);
    }
  }
}

/** Desenho do marcador de encaixe, igual ao do AutoCAD: quadrado no extremo, triângulo no
 *  meio, círculo no centro, losango no quadrante, xis na interseção… */
function marcadorDoEncaixe(tipo: TipoEncaixe, p: { x: number; y: number }, m: number): string {
  const { x, y } = p;
  const circulo = (r: number) => `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  switch (tipo) {
    case "extremo": return `M ${x - m} ${y - m} h ${2 * m} v ${2 * m} h ${-2 * m} Z`;
    case "meio": return `M ${x} ${y - m} L ${x + m} ${y + m} L ${x - m} ${y + m} Z`;
    case "centro": return circulo(m);
    case "quadrante": return `M ${x} ${y - m} L ${x + m} ${y} L ${x} ${y + m} L ${x - m} ${y} Z`;
    case "interseccao": return `M ${x - m} ${y - m} L ${x + m} ${y + m} M ${x + m} ${y - m} L ${x - m} ${y + m}`;
    case "perpendicular": return `M ${x - m} ${y - m} L ${x - m} ${y + m} L ${x + m} ${y + m} M ${x - m} ${y} L ${x} ${y} L ${x} ${y + m}`;
    case "tangente": return `${circulo(m * 0.8)} M ${x - m} ${y - m} L ${x + m} ${y - m}`;
    case "proximo": return `M ${x - m} ${y - m} L ${x + m} ${y - m} L ${x - m} ${y + m} L ${x + m} ${y + m} Z`;
    default: return `M ${x - m} ${y} L ${x + m} ${y} M ${x} ${y - m} L ${x} ${y + m}`;
  }
}

export function PranchetaEditor({ prancha, canEdit, onVoltar, onSalvo, fullPage = false, importarDaBiblioteca = null }: {
  prancha: Prancha; canEdit: boolean; onVoltar: () => void;
  onSalvo: (atualizada: Prancha) => void;
  fullPage?: boolean;
  /** Arquivo DWG/DXF da biblioteca da Prancheta para importar assim que o editor abre. */
  importarDaBiblioteca?: { id: string; nome: string } | null;
}) {
  const [documento, definirDocumento] = useState<Documento>(prancha.documento);
  // Cópia síncrona do documento: um comando aplica várias alterações seguidas (LINHA
  // grava trecho a trecho) antes de a tela redesenhar, e cada uma precisa partir da anterior.
  const docRef = useRef(documento);
  useEffect(() => { docRef.current = documento; }, [documento]);
  const [revisao, definirRevisao] = useState(prancha.revisao);
  const [nome, definirNome] = useState(prancha.nome);
  const [ferramenta, definirFerramenta] = useState<Ferramenta>("selecionar");
  const [ajudaVisivel, definirAjudaVisivel] = useState<string | null>(null);
  const temporizadorAjuda = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [familia, definirFamilia] = useState<string>("tomada-media");
  const [itemImagem, definirItemImagem] = useState<ItemBiblioteca | null>(null);
  const [biblioteca, definirBiblioteca] = useState<ItemBiblioteca[]>([]);
  const [selecoes, definirSelecoesEstado] = useState<string[]>([]);
  const selRef = useRef<string[]>([]);
  const definirSelecoes = useCallback((valor: string[] | ((atual: string[]) => string[])) => {
    const proximo = typeof valor === "function" ? valor(selRef.current) : valor;
    selRef.current = proximo;
    definirSelecoesEstado(proximo);
  }, []);
  const selecao = selecoes.length === 1 ? selecoes[0] : null;
  const definirSelecao = useCallback((id: string | null) => definirSelecoes(id ? [id] : []), [definirSelecoes]);
  type JanelaEmCurso = { a: { x: number; y: number }; b: { x: number; y: number }; remover: boolean; aberta: boolean; tela: { x: number; y: number } };
  const [janelaSelecao, definirJanelaSelecao] = useState<JanelaEmCurso | null>(null);
  const janelaRef = useRef<JanelaEmCurso | null>(null);
  const [distanciaParalela, definirDistanciaParalela] = useState("100");
  const [transformacao, definirTransformacao] = useState({ dx: "1000", dy: "0", angulo: "90", fator: "2", x: "0", y: "0" });
  const [novaCamada, definirNovaCamada] = useState("");
  const [camadaEscolhida, definirCamadaEscolhida] = useState("");
  const estadoAtual = useRef({ documento, nome });
  useEffect(() => { estadoAtual.current = { documento, nome }; }, [documento, nome]);
  const salvamentoEmCurso = useRef(false);
  const [pendentes, definirPendentes] = useState<{ x: number; y: number }[]>([]);
  const [cursor, definirCursor] = useState<{ x: number; y: number } | null>(null);
  const [vista, definirVistaEstado] = useState({ x: -2000, y: -2000, largura: 24000 });
  // Vistas anteriores para o ZOOM Anterior.
  const vistasAnteriores = useRef<{ x: number; y: number; largura: number }[]>([]);
  const definirVista = useCallback((valor: { x: number; y: number; largura: number } | ((anterior: { x: number; y: number; largura: number }) => { x: number; y: number; largura: number }), guardar = false) => {
    definirVistaEstado((anterior) => {
      if (guardar) vistasAnteriores.current = [...vistasAnteriores.current, anterior].slice(-20);
      return typeof valor === "function" ? valor(anterior) : valor;
    });
  }, []);
  const [historico, definirHistorico] = useState<Documento[]>([]);
  const [refeitos, definirRefeitos] = useState<Documento[]>([]);
  const [sujo, definirSujo] = useState(false);
  const [salvando, definirSalvando] = useState(false);
  const [conflito, definirConflito] = useState(false);
  const [ativosEncaixe, definirAtivosEncaixe] = useState<TipoEncaixe[]>(TIPOS_ENCAIXE.filter((tipo) => tipo !== "tangente" && tipo !== "proximo"));
  // Barra de status do AutoCAD: cada chave com a sua tecla F.
  const [orto, definirOrto] = useState(false);            // F8
  const [osnap, definirOsnap] = useState(true);           // F3
  const [polar, definirPolar] = useState(true);           // F10
  const [grade, definirGrade] = useState(true);           // F7
  const [snapGrade, definirSnapGrade] = useState(true);   // F9
  const [dinamica, definirDinamica] = useState(true);     // F12
  const [rastreio, definirRastreio] = useState<{ origem: { x: number; y: number }; angulo: number; distancia: number } | null>(null);
  const [comando, definirComando] = useState("");
  const [linhasDigitadas, definirLinhasDigitadas] = useState<string[]>([]);
  const indiceDigitado = useRef(-1);
  const [registro, definirRegistro] = useState<string[]>(["Digite um comando (L, PL, C, M, CO, TR…) ou clique numa ferramenta. Enter repete o último."]);
  const [registroAberto, definirRegistroAberto] = useState(false);
  const [pedido, definirPedido] = useState<Pedido | null>(null);
  const [nomeComando, definirNomeComando] = useState<string | null>(null);
  const campoComando = useRef<HTMLInputElement | null>(null);
  const [matriz, definirMatriz] = useState({ colunas: 3, linhas: 1, passoXMm: 1000, passoYMm: 1000 });
  const [encaixeAtual, definirEncaixeAtual] = useState<Encaixe | null>(null);
  const [importado, definirImportado] = useState<Importado | null>(null);
  const [importando, definirImportando] = useState(false);
  const [unidadeImportacao, definirUnidadeImportacao] = useState("");
  // Fundo escuro como o espaço do modelo do AutoCAD: as cores do DWG foram escolhidas
  // para ele. É preferência de quem olha, então fica no navegador.
  const [fundoEscuro, definirFundoEscuro] = useState(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem("hoikos-cad-fundo") === "escuro"; } catch { return false; }
  });
  const [filtroCamada, definirFiltroCamada] = useState("");
  // Arquivo grande importado pela biblioteca: trocar a unidade relê pelo identificador.
  const arquivoDaBiblioteca = useRef<{ id: string; nome: string } | null>(null);
  const arquivoDxf = useRef<HTMLInputElement | null>(null);
  // O arquivo fica guardado aqui, e não no input: o input é limpo logo após a leitura
  // para aceitar o mesmo arquivo duas vezes seguidas, e sem esta cópia trocar a unidade
  // não teria o que reler.
  const dxfEscolhido = useRef<File | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Largura da tela guardada pelo observador: ler do DOM a cada movimento forçava o
  // navegador a recalcular o layout de milhares de nós.
  const larguraTela = useRef(0);
  const [tamanhoTela, definirTamanhoTela] = useState({ largura: 0, altura: 0 });
  const arrastando = useRef<{ ids: string[]; de: { x: number; y: number }; documento: Documento; mudou: boolean } | null>(null);
  const panorama = useRef<{ x: number; y: number; vista: { x: number; y: number }; botao: number; moveu: boolean } | null>(null);
  // Alça: arrastada com o botão preso, ou "quente" (clicada) até o próximo clique, como no AutoCAD.
  const verticeArrastado = useRef<{ id: string; indice: number; documento: Documento; mudou: boolean; quente: boolean; de: { x: number; y: number } } | null>(null);
  const [alcaQuente, definirAlcaQuente] = useState<{ id: string; indice: number } | null>(null);
  const ultimoMeio = useRef(0);

  function esconderAjuda() {
    if (temporizadorAjuda.current) clearTimeout(temporizadorAjuda.current);
    temporizadorAjuda.current = null;
    definirAjudaVisivel(null);
  }

  function aguardarAjuda(id: string) {
    esconderAjuda();
    temporizadorAjuda.current = setTimeout(() => definirAjudaVisivel(id), 700);
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

  const aplicar = useCallback((proximo: Documento, jaValidado = false) => {
    if (!canEdit) return false;
    const anterior = docRef.current;
    // Só o que mudou é validado: validar o desenho inteiro a cada gesto travava plantas grandes.
    if (!jaValidado && !validarAlteracao(anterior, proximo)) { toast.error("A alteração ultrapassa os limites de medida ou de elementos da prancha."); return false; }
    definirHistorico((lista) => [...lista, anterior].slice(-LIMITE_HISTORICO));
    definirRefeitos([]);
    docRef.current = proximo;
    definirDocumento(proximo);
    definirSujo(true);
    return true;
  }, [canEdit]);

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
    const anterior = historico[historico.length - 1];
    definirRefeitos([...refeitos, documento].slice(-LIMITE_HISTORICO));
    docRef.current = anterior;
    definirDocumento(anterior);
    definirHistorico(historico.slice(0, -1));
    definirSujo(true); definirSelecao(null); definirPendentes([]);
  }, [canEdit, historico, refeitos, documento, definirSelecao]);

  const refazer = useCallback(() => {
    if (!canEdit || !refeitos.length) return;
    const proximo = refeitos[refeitos.length - 1];
    definirHistorico([...historico, documento].slice(-LIMITE_HISTORICO));
    docRef.current = proximo;
    definirDocumento(proximo);
    definirRefeitos(refeitos.slice(0, -1));
    definirSujo(true); definirSelecao(null); definirPendentes([]);
  }, [canEdit, historico, refeitos, documento, definirSelecao]);

  // ## Linha de comando
  //
  // O intérprete vive a sessão inteira do editor (guarda o último comando, o último ponto,
  // o raio do último círculo…). Ele lê o documento e a seleção pelas cópias síncronas.
  const registrar = useCallback((texto: string) => definirRegistro((linhas) => [...linhas, texto].slice(-200)), []);
  const acaoRef = useRef<(acao: AcaoEditor) => void>(() => undefined);
  const canEditRef = useRef(canEdit);
  const camadaEscolhidaRef = useRef(camadaEscolhida);
  useEffect(() => { canEditRef.current = canEdit; camadaEscolhidaRef.current = camadaEscolhida; }, [canEdit, camadaEscolhida]);
  const interpreteRef = useRef<Interprete | null>(null);
  useEffect(() => {
    if (interpreteRef.current) return;
    interpreteRef.current = new Interprete({
    documento: () => docRef.current,
    selecao: () => selRef.current,
    selecionar: (ids) => { selRef.current = ids; definirSelecoesEstado(ids); },
    aplicar: (proximo, novaSelecao) => {
      if (!canEditRef.current) { registrar("Somente leitura: o desenho não pode ser alterado."); return false; }
      const anterior = docRef.current;
      if (!validarAlteracao(anterior, proximo)) { registrar("A alteração ultrapassa os limites de medida ou de elementos da prancha."); return false; }
      definirHistorico((lista) => [...lista, anterior].slice(-LIMITE_HISTORICO));
      definirRefeitos([]);
      docRef.current = proximo;
      definirDocumento(proximo);
      definirSujo(true);
      if (novaSelecao) { selRef.current = novaSelecao; definirSelecoesEstado(novaSelecao); }
      return true;
    },
    registrar: (texto) => registrar(texto),
    acao: (acao) => acaoRef.current(acao),
    novoId,
    camadaEscolhida: () => camadaEscolhidaRef.current || undefined,
    });
  }, [registrar]);
  /** O intérprete só existe depois da montagem; os gestos e teclas chegam depois dela. */
  const cmd = useCallback(() => interpreteRef.current ?? new Interprete({
    documento: () => docRef.current, selecao: () => [], selecionar: () => undefined, aplicar: () => false,
    registrar: () => undefined, acao: () => undefined, novoId, camadaEscolhida: () => undefined,
  }), []);
  const sincronizar = useCallback(() => {
    const atual = cmd().pedido;
    definirPedido(atual);
    definirNomeComando(cmd().nome);
    // Janela aberta com um clique não sobrevive ao fim da seleção que a pediu.
    if (atual?.modo !== "selecao" && janelaRef.current) { janelaRef.current = null; definirJanelaSelecao(null); }
    // Comando em curso tira do modo de parede, porta etc.: o clique passa a ser do comando.
    if (atual) { definirFerramenta("selecionar"); definirPendentes([]); }
  }, [cmd]);

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
    // Vários passos da roda no mesmo quadro viram um zoom só: cada zoom redesenha a prancha.
    let acumulado = 1, ancoraPendente: { x: number; y: number } | null = null, quadro = 0, ultimaRoda = 0;
    const roda = (evento: WheelEvent) => {
      const ancora = paraMilimetros(evento);
      if (!ancora) return;
      evento.preventDefault();
      const delta = evento.deltaY * (evento.deltaMode === 1 ? 16 : evento.deltaMode === 2 ? 640 : 1);
      acumulado *= Math.exp(Math.max(-1, Math.min(1, delta * 0.002)));
      ancoraPendente = ancora;
      if (quadro) return;
      quadro = requestAnimationFrame(() => {
        quadro = 0;
        const fator = acumulado, ponto = ancoraPendente!;
        acumulado = 1;
        // Cada rodada de roda vira uma vista só no ZOOM Anterior.
        const agora = performance.now();
        const guardar = agora - ultimaRoda > 600;
        ultimaRoda = agora;
        definirVista(anterior => zoomNaVista({ ...anterior, proporcao: 0.62 }, fator, ponto), guardar);
      });
    };
    svg.addEventListener("wheel", roda, { passive: false });
    return () => { svg.removeEventListener("wheel", roda); if (quadro) cancelAnimationFrame(quadro); };
  }, [paraMilimetros, definirVista]);

  /** Raio de captura em milímetros de desenho, derivado do zoom. O que a mão sente é a
   *  distância na TELA: um raio fixo em milímetros seria impossível de acertar afastado
   *  e agarraria tudo de perto. */
  const toleranciaMm = useCallback(() => {
    const largura = larguraTela.current || (svgRef.current?.getBoundingClientRect().width ?? 0);
    return largura > 0 ? vista.largura / largura * 14 : vista.largura / 80;
  }, [vista.largura]);

  /** Onde o clique cai: encaixe a objetos (F3), malha (F9), trava ortogonal (F8) e
   *  rastreamento polar (F10), nessa ordem de prioridade, como no AutoCAD. */
  const encaixarEm = useCallback((bruto: { x: number; y: number }, origemDoTraco?: { x: number; y: number } | null, livre = false): Encaixe & { polar?: { angulo: number; distancia: number } } => {
    // Canto oposto de retângulo ou de janela: sem trava, mas ainda com encaixe a objetos.
    const origem = livre ? null : origemDoTraco;
    const alvo = orto && origem ? ortogonal(origem, bruto) : bruto;
    // Durante o arrasto, o encaixe olha o desenho de antes do gesto (que não muda a cada
    // movimento, então o índice de encaixe é montado uma vez só) e ignora o que se move.
    const gesto = arrastando.current ?? verticeArrastado.current;
    const ignorar = gesto ? new Set("ids" in gesto ? gesto.ids : [gesto.id]) : undefined;
    const referencia = gesto?.documento ?? documento;
    const unico = cmd().encaixeUnico;
    const ativos = unico ? [unico] : osnap ? ativosEncaixe : [];
    const encaixe = encaixePerto(referencia, alvo, { toleranciaMm: toleranciaMm(), origem: origemDoTraco, ativos, ignorar, malha: snapGrade });
    // Com a trava ortogonal ligada, só vale o encaixe que não sai do eixo — senão a
    // trava seria desfeita pelo próprio encaixe, calada.
    if (orto && origem && encaixe.tipo !== "malha"
      && encaixe.ponto.x !== origem.x && encaixe.ponto.y !== origem.y) {
      const naMalha = snapGrade ? { x: encaixar(alvo.x, documento.malhaMm), y: encaixar(alvo.y, documento.malhaMm) } : alvo;
      return { tipo: "malha" as const, ponto: ortogonal(origem, naMalha) };
    }
    if (orto && origem && encaixe.tipo === "malha") return { ...encaixe, ponto: ortogonal(origem, encaixe.ponto) };
    // Polar: perto de um múltiplo de 45°, o ponto corre sobre essa direção. Arrastar a
    // seleção com o mouse não usa o polar, como o arrastar e soltar do AutoCAD.
    if (polar && !orto && origem && encaixe.tipo === "malha" && !arrastando.current) {
      const dx = bruto.x - origem.x, dy = bruto.y - origem.y, d = Math.hypot(dx, dy);
      if (d > toleranciaMm()) {
        const graus = ((Math.atan2(-dy, dx) * 180 / Math.PI) % 360 + 360) % 360;
        const alvoPolar = Math.round(graus / 45) * 45 % 360;
        const diferenca = Math.abs(((graus - alvoPolar + 540) % 360) - 180);
        if (diferenca <= 4) {
          const projetada = d * Math.cos(diferenca * Math.PI / 180);
          const distancia = snapGrade && documento.malhaMm > 1 ? Math.max(documento.malhaMm, Math.round(projetada / documento.malhaMm) * documento.malhaMm) : projetada;
          const rad = alvoPolar * Math.PI / 180;
          const ponto = { x: origem.x + distancia * Math.cos(rad), y: origem.y - distancia * Math.sin(rad) };
          return { tipo: "malha", ponto: { x: Math.abs(ponto.x) < 1e-9 ? 0 : Math.round(ponto.x * 1e6) / 1e6, y: Math.abs(ponto.y) < 1e-9 ? 0 : Math.round(ponto.y * 1e6) / 1e6 }, polar: { angulo: alvoPolar, distancia } };
        }
      }
    }
    return encaixe;
  }, [ativosEncaixe, documento, orto, osnap, polar, snapGrade, toleranciaMm, cmd]);

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
  }

  function ampliar(fator: number) {
    definirVista((anterior) => {
      const centro = { x: anterior.x + anterior.largura / 2, y: anterior.y + anterior.largura * 0.62 / 2 };
      return zoomNaVista({ ...anterior, proporcao: 0.62 }, fator, centro);
    }, true);
  }

  function enquadrar() {
    definirVista(enquadrarElementos(visiveis), true);
  }

  function responderPonto(ponto: { x: number; y: number }) {
    cmd().responder({ tipo: "ponto", ponto });
    sincronizar();
  }

  function iniciarComando(nomeDoComando: string) {
    esconderAjuda();
    definirPendentes([]);
    definirFerramenta("selecionar");
    cmd().iniciar(nomeDoComando);
    sincronizar();
  }

  function escolherBotao(botao: Botao) {
    esconderAjuda();
    if (botao.comando) { iniciarComando(botao.comando); return; }
    cmd().cancelar(true);
    sincronizar();
    definirFerramenta(botao.ferramenta ?? "selecionar");
    definirPendentes([]);
  }

  /** Objetos selecionados que mostram alças (até cem, como o GRIPOBJLIMIT do AutoCAD). */
  const comAlcas = useMemo(() => {
    if (!selecoes.length || selecoes.length > 100) return [];
    const ids = new Set(selecoes);
    return documento.elementos.filter((elemento) => ids.has(elemento.id) && !camadaBloqueada(documento, elemento.camada));
  }, [documento, selecoes]);

  function aoApontar(evento: React.PointerEvent<SVGSVGElement>) {
    esconderAjuda();
    if (evento.button === 1 || evento.button === 2) {
      // Duplo clique na roda enquadra o desenho, como o ZOOM Extensão do AutoCAD.
      if (evento.button === 1) {
        const agora = evento.timeStamp;
        if (agora - ultimoMeio.current < 350) { ultimoMeio.current = 0; enquadrar(); return; }
        ultimoMeio.current = agora;
      }
      panorama.current = { x: evento.clientX, y: evento.clientY, vista: { x: vista.x, y: vista.y }, botao: evento.button, moveu: false };
      evento.currentTarget.setPointerCapture?.(evento.pointerId);
      return;
    }
    if (evento.button !== 0) return;
    const bruto = paraMilimetros(evento);
    if (!bruto) return;

    // Janela aberta com um clique: o segundo clique a fecha.
    if (janelaRef.current?.aberta) { concluirJanela({ ...janelaRef.current, b: bruto }); return; }

    // Alça quente: o clique seguinte a solta onde o cursor está.
    const alca = verticeArrastado.current;
    if (alca?.quente) {
      aplicarGesto(alca, encaixarEm(bruto, alca.de).ponto);
      verticeArrastado.current = null;
      definirAlcaQuente(null);
      return;
    }

    const atual = cmd().pedido;
    if (atual) {
      if (atual.modo === "ponto" || atual.modo === "valor") {
        const encaixe = encaixarEm(bruto, atual.base ?? null, atual.livre);
        definirEncaixeAtual(null); definirRastreio(null);
        responderPonto(encaixe.ponto);
        return;
      }
      if (atual.modo === "objeto") {
        const alvo = elementoNoPonto(documento, bruto.x, bruto.y, toleranciaMm());
        if (!alvo) { registrar("Nenhum objeto encontrado aqui."); return; }
        cmd().responder({ tipo: "objeto", elemento: alvo, ponto: bruto });
        sincronizar();
        return;
      }
      if (atual.modo === "selecao") selecionarComClique(evento, bruto, false);
      return;
    }

    if (ferramenta === "selecionar") { selecionarComClique(evento, bruto, true); return; }
    if (!podeDesenhar) {
      toast.error(bloqueada ? "A camada desta ferramenta está travada. Destrave-a no painel de camadas." : "Você não tem permissão para editar esta prancha.");
      return;
    }
    const encaixe = encaixarEm(bruto, pendentes.at(-1) ?? null);
    const ponto = encaixe.ponto;
    if (ferramenta === "parede" || ferramenta === "comodo") { confirmarPonto(ponto); return; }
    if (ferramenta === "traco") {
      definirPendentes([ponto]);
      evento.currentTarget.setPointerCapture?.(evento.pointerId);
      return;
    }
    colocar(ponto);
  }

  /** Seleção do AutoCAD: clique acrescenta, Shift+clique tira; no espaço vazio abre uma
   *  janela — da esquerda para a direita pega o que está inteiro dentro, da direita para
   *  a esquerda pega tudo que ela toca. Fora de comando, a seleção também se arrasta e
   *  as alças esticam. */
  function selecionarComClique(evento: React.PointerEvent<SVGSVGElement>, bruto: { x: number; y: number }, editar: boolean) {
    if (editar && canEdit && !evento.shiftKey) {
      const raio = toleranciaMm() * 0.7;
      for (const elemento of comAlcas) {
        const vertice = verticesDe(elemento).find((v) => Math.hypot(v.ponto.x - bruto.x, v.ponto.y - bruto.y) <= raio);
        if (vertice) {
          verticeArrastado.current = { id: elemento.id, indice: vertice.indice, documento, mudou: false, quente: false, de: vertice.ponto };
          definirAlcaQuente({ id: elemento.id, indice: vertice.indice });
          evento.currentTarget.setPointerCapture?.(evento.pointerId);
          return;
        }
      }
    }
    const alvo = elementoNoPonto(documento, bruto.x, bruto.y, toleranciaMm());
    if (alvo) {
      if (evento.shiftKey) { definirSelecoes((atual) => atual.includes(alvo.id) ? atual.filter((id) => id !== alvo.id) : [...atual, alvo.id]); return; }
      const ids = selecoes.includes(alvo.id) ? selecoes : [...selecoes, alvo.id];
      definirSelecoes(ids);
      if (editar && canEdit) {
        arrastando.current = { ids, de: bruto, documento, mudou: false };
        evento.currentTarget.setPointerCapture?.(evento.pointerId);
      }
      return;
    }
    janelaRef.current = { a: bruto, b: bruto, remover: evento.shiftKey, aberta: false, tela: { x: evento.clientX, y: evento.clientY } };
    definirJanelaSelecao(janelaRef.current);
    evento.currentTarget.setPointerCapture?.(evento.pointerId);
  }

  function concluirJanela(janela: JanelaEmCurso) {
    janelaRef.current = null;
    definirJanelaSelecao(null);
    if (Math.abs(janela.b.x - janela.a.x) < 1e-9 && Math.abs(janela.b.y - janela.a.y) < 1e-9) return;
    const cruzada = janela.b.x < janela.a.x;
    const ids = cruzada ? selecionarCruzando(documento, janela.a, janela.b) : selecionarNaJanela(documento, janela.a, janela.b);
    cmd().anotarJanela({ a: janela.a, b: janela.b });
    const achados = new Set(ids);
    definirSelecoes((atual) => janela.remover ? atual.filter((id) => !achados.has(id)) : [...new Set([...atual, ...ids])]);
  }

  /** Clique direito rápido é Enter, como no AutoCAD: conclui o passo, fecha o cômodo ou
   *  repete o último comando. */
  function cliqueDireito() {
    if (cmd().ativo) { cmd().enter(); sincronizar(); return; }
    if (ferramenta === "comodo" && pendentes.length >= 3) { fecharComodo(); return; }
    if (pendentes.length) { definirPendentes([]); return; }
    if (ferramenta !== "selecionar") { definirFerramenta("selecionar"); return; }
    cmd().enter();
    sincronizar();
  }

  /** Esc: solta a alça, fecha a janela, cancela o comando e limpa a seleção, nessa ordem. */
  function escapar() {
    const gesto = verticeArrastado.current;
    if (gesto) {
      if (gesto.mudou) { docRef.current = gesto.documento; definirDocumento(gesto.documento); definirHistorico((h) => h.slice(0, -1)); }
      verticeArrastado.current = null; definirAlcaQuente(null);
      return;
    }
    if (janelaRef.current) { janelaRef.current = null; definirJanelaSelecao(null); return; }
    definirComando("");
    if (cmd().ativo) { cmd().cancelar(); sincronizar(); definirSelecoes([]); definirRastreio(null); return; }
    if (pendentes.length) { definirPendentes([]); return; }
    definirSelecoes([]);
    if (ferramenta !== "selecionar") definirFerramenta("selecionar");
  }

  function confirmarPonto(ponto: { x: number; y: number }) {
    if (ferramenta !== "parede" && ferramenta !== "comodo") return;
    if (!podeDesenhar) { toast.error("A camada está oculta ou travada, ou seu acesso é somente leitura."); return; }
    if (!pendentes.length) { definirPendentes([ponto]); return; }
    const ultimo = pendentes[pendentes.length - 1];
    if (Math.hypot(ultimo.x - ponto.x, ultimo.y - ponto.y) < 1e-9) { toast.error("Marque um ponto diferente."); return; }
    if (ferramenta === "comodo") {
      if (pendentes.length >= 200) { toast.error("Limite de cantos atingido. Feche o cômodo."); return; }
      definirPendentes([...pendentes, ponto]); return;
    }
    if (acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "parede", a: ultimo, b: ponto, espessuraMm: 150 })) definirPendentes([ponto]);
  }

  // Um processamento por quadro: o navegador dispara o movimento do ponteiro bem mais vezes
  // do que a tela redesenha, e cada processamento encaixa, move e redesenha.
  const movimentoPendente = useRef<{ clientX: number; clientY: number; buttons: number } | null>(null);
  const quadroMovimento = useRef(0);
  const ultimoMovimento = useRef(0);
  const processarRef = useRef<(dados: { clientX: number; clientY: number; buttons: number }) => void>(() => undefined);
  useEffect(() => () => { if (quadroMovimento.current) cancelAnimationFrame(quadroMovimento.current); }, []);

  function aoMover(evento: React.PointerEvent<SVGSVGElement>) {
    const dados = { clientX: evento.clientX, clientY: evento.clientY, buttons: evento.buttons };
    const agora = evento.timeStamp;
    if (!quadroMovimento.current && agora - ultimoMovimento.current >= 16) {
      ultimoMovimento.current = agora;
      processarMovimento(dados);
      return;
    }
    movimentoPendente.current = dados;
    if (!quadroMovimento.current) {
      quadroMovimento.current = requestAnimationFrame(() => {
        quadroMovimento.current = 0;
        const pendente = movimentoPendente.current;
        movimentoPendente.current = null;
        if (pendente) { ultimoMovimento.current = agora + 16; processarRef.current(pendente); }
      });
    }
  }

  /** Aplica o último movimento ainda na fila (ao soltar, o gesto termina onde a mão parou). */
  function esvaziarMovimento() {
    if (quadroMovimento.current) { cancelAnimationFrame(quadroMovimento.current); quadroMovimento.current = 0; }
    const pendente = movimentoPendente.current;
    movimentoPendente.current = null;
    if (pendente) processarMovimento(pendente);
  }

  type Gesto = NonNullable<typeof arrastando.current> | NonNullable<typeof verticeArrastado.current>;
  /** Move a seleção arrastada ou a alça até o ponto, com uma entrada só no histórico. */
  function aplicarGesto(gesto: Gesto, ponto: { x: number; y: number }) {
    const ids = "indice" in gesto ? null : new Set(gesto.ids);
    const movidos: Elemento[] = [];
    const proximo = { ...gesto.documento, elementos: gesto.documento.elementos.map(item => {
      if ("indice" in gesto) { if (item.id !== gesto.id) return item; const novo = moverVertice(item, gesto.indice, ponto); movidos.push(novo); return novo; }
      if (!ids!.has(item.id)) return item;
      const novo = moverElemento(item, ponto.x - gesto.de.x, ponto.y - gesto.de.y, 1);
      movidos.push(novo);
      return novo;
    }) };
    // Só o que se move é conferido: serializar e validar o desenho inteiro a cada
    // movimento do mouse travava o arrasto em planta grande.
    if (movidos.some((elemento) => !elementoSchema.safeParse(elemento).success)) return;
    const mudou = "indice" in gesto
      ? JSON.stringify(movidos[0]) !== JSON.stringify(gesto.documento.elementos.find((e) => e.id === gesto.id))
      : ponto.x !== gesto.de.x || ponto.y !== gesto.de.y;
    if (!gesto.mudou && mudou) {
      definirHistorico(h => [...h, gesto.documento].slice(-LIMITE_HISTORICO)); definirRefeitos([]);
    }
    gesto.mudou ||= mudou;
    docRef.current = proximo;
    definirDocumento(proximo);
    if (mudou) definirSujo(true);
  }

  function processarMovimento(evento: { clientX: number; clientY: number; buttons: number }) {
    const vistaArrastada = panorama.current;
    if (vistaArrastada) {
      if (!vistaArrastada.moveu && Math.hypot(evento.clientX - vistaArrastada.x, evento.clientY - vistaArrastada.y) > 3) vistaArrastada.moveu = true;
      const svg = svgRef.current;
      const escala = svg ? vista.largura / (larguraTela.current || svg.getBoundingClientRect().width) : 1;
      definirVistaEstado((anterior) => ({
        ...anterior,
        x: vistaArrastada.vista.x - (evento.clientX - vistaArrastada.x) * escala,
        y: vistaArrastada.vista.y - (evento.clientY - vistaArrastada.y) * escala,
      }));
      return;
    }
    const bruto = paraMilimetros(evento);
    if (!bruto) return;
    if (janelaRef.current) {
      janelaRef.current = { ...janelaRef.current, b: bruto }; definirJanelaSelecao(janelaRef.current); definirCursor(bruto); return;
    }
    const gesto = verticeArrastado.current ?? arrastando.current;
    const atual = cmd().pedido;
    const pedePonto = atual ? atual.modo === "ponto" || atual.modo === "valor" : ferramenta !== "selecionar";
    // Selecionando sem arrastar, o encaixe não serve para nada — e custa, em planta grande.
    if (!gesto && !pedePonto) {
      definirCursor(bruto); definirEncaixeAtual(null); definirRastreio(null);
      return;
    }
    const origem = gesto ? gesto.de : atual?.base ?? pendentes.at(-1) ?? null;
    const encaixe = encaixarEm(bruto, origem, !gesto && atual?.livre);
    definirCursor(encaixe.ponto);
    definirEncaixeAtual(encaixe);
    definirRastreio(encaixe.polar && origem ? { origem, ...encaixe.polar } : null);
    if (gesto) { aplicarGesto(gesto, encaixe.ponto); return; }
    if (ferramenta === "traco" && pendentes.length && evento.buttons === 1) {
      definirPendentes((anterior) => anterior.length < 2000 ? [...anterior, encaixe.ponto] : anterior);
    }
  }

  useEffect(() => { processarRef.current = processarMovimento; });

  function aoSoltar(evento?: React.PointerEvent<SVGSVGElement>) {
    esvaziarMovimento();
    if (evento?.currentTarget.hasPointerCapture?.(evento.pointerId)) evento.currentTarget.releasePointerCapture(evento.pointerId);
    const janela = janelaRef.current;
    if (janela && !janela.aberta) {
      // Arrastou: a janela fecha ao soltar. Só clicou: fica aberta até o próximo clique.
      const moveu = !evento || Math.hypot(evento.clientX - janela.tela.x, evento.clientY - janela.tela.y) > 5;
      if (moveu) concluirJanela(janela);
      else { janelaRef.current = { ...janela, aberta: true }; definirJanelaSelecao(janelaRef.current); }
      return;
    }
    const vistaArrastada = panorama.current;
    if (vistaArrastada) {
      panorama.current = null;
      if (vistaArrastada.botao === 2 && !vistaArrastada.moveu) cliqueDireito();
      return;
    }
    const alca = verticeArrastado.current;
    if (alca) {
      if (alca.mudou && !alca.quente) { verticeArrastado.current = null; definirAlcaQuente(null); }
      else alca.quente = true;
      return;
    }
    if (arrastando.current) { arrastando.current = null; return; }
    if (ferramenta === "traco" && pendentes.length > 1) {
      acrescentar({ id: novoId(), camada: camadaAtiva, tipo: "traco", pontos: pendentes, espessuraMm: 30 });
      definirPendentes([]);
    }
  }

  /** Medida digitada para a parede ou o cômodo em curso, a partir do último ponto. */
  function confirmarEntrada(texto: string) {
    const origem = pendentes.at(-1);
    if (!origem) { registrar("Marque o ponto de partida na prancha antes de digitar a medida."); return; }
    const ponto = cmd().lerPonto(texto, origem, cursor);
    if (!ponto) { registrar("Não entendi a medida. Use 3150, 3150<90, @3000,1500 ou x,y."); return; }
    confirmarPonto(ponto);
  }

  /** O que foi digitado na linha de comando. */
  function enviarComando(evento?: React.FormEvent) {
    evento?.preventDefault();
    const texto = comando;
    definirComando("");
    indiceDigitado.current = -1;
    const t = texto.trim();
    if (t) definirLinhasDigitadas((linhas) => [...linhas.filter((l) => l !== t), t].slice(-50));
    if (cmd().ativo) {
      const atual = cmd().pedido;
      if (atual) registrar(`${textoDoPedido(atual)} ${t}`.trim());
      // Várias respostas de uma vez ("0,0 1000,0"), exceto no texto, onde espaço é letra.
      if (atual?.modo !== "texto" && /\s/.test(t)) {
        for (const parte of t.split(/\s+/)) { if (!cmd().ativo) break; cmd().digitar(parte, cursor); }
      } else cmd().digitar(texto, cursor);
      sincronizar();
      return;
    }
    if (!t) { cmd().enter(); sincronizar(); return; }
    if (pendentes.length && (ferramenta === "parede" || ferramenta === "comodo")) { confirmarEntrada(t); return; }
    if (/\s/.test(t)) { executarLinhaUnica(t); return; }
    cmd().digitar(t, cursor);
    sincronizar();
  }

  /** Linha inteira de uma vez ("L 0,0 3000,0", "CO @100,100"): roda como script, sem diálogo. */
  function executarLinhaUnica(texto: string) {
    registrar(texto);
    try {
      const resultado = executarNaSelecao(documento, texto, selecoes, undefined, camadaEscolhida || undefined);
      if (aplicar(resultado.document)) { definirSelecoes(resultado.selectedIds); registrar(resultado.message); }
    } catch (erro) {
      const [primeiro, ...resto] = texto.trim().split(/\s+/);
      const mensagem = erro instanceof Error ? erro.message : "Comando inválido.";
      // Comando só interativo (F 200, Z 2x…): as partes viram as respostas do diálogo.
      if (/desconhecido|histórico/i.test(mensagem) && acharComando(primeiro)) {
        cmd().iniciar(primeiro);
        for (const parte of resto) { if (!cmd().ativo) break; cmd().digitar(parte, cursor); }
        sincronizar();
        return;
      }
      registrar(mensagem);
    }
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
    if (documento.elementos.length + copias.length > LIMITE_ELEMENTOS) {
      toast.error(`O desenho passaria do limite de ${LIMITE_ELEMENTOS.toLocaleString("pt-BR")} elementos.`);
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


  function trocarCamada(id: string, mudanca: Partial<Camada>) {
    if (!canEdit) return;
    aplicar({ ...documento, camadas: documento.camadas.map(camada => camada.id === id ? { ...camada, ...mudanca } : camada) });
    if (mudanca.bloqueada || mudanca.visivel === false) definirSelecoes(selecoes.filter(el => documento.elementos.find(e => e.id === el)?.camada !== id));
  }

  function operarSelecao(input: string) {
    if (!canEdit) return;
    try {
      const result = executarNaSelecao(documento, input, selecoes, undefined, camadaEscolhida || undefined);
      if (aplicar(result.document)) { definirSelecoes(result.selectedIds); registrar(result.message); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível editar a seleção."); }
  }

  /** Lê o arquivo no servidor. Até 3,5 MB vai no próprio pedido; maior que isso vai
   *  antes para a biblioteca da Prancheta, em partes, e é lido de lá — o corpo de uma
   *  função não comporta um DWG inteiro. A resposta volta comprimida. */
  async function importar(arquivo: File | null, unidade: string) {
    definirImportando(true);
    try {
      let resposta: Response;
      if (arquivo && arquivo.size <= 3.5 * 1024 * 1024) {
        const formulario = new FormData();
        formulario.append("file", arquivo);
        if (unidade) formulario.append("unidade", unidade);
        resposta = await fetch("/api/studio/importar", { method: "POST", body: formulario, headers: { [CABECALHO_ACEITA]: JSON_GZIP } });
      } else {
        if (arquivo) {
          toast.info("Arquivo grande: enviando para a biblioteca da Prancheta antes de ler.");
          const guardado = await uploadOrgFile(arquivo, arquivo.name, { area: "prancheta", projectId: prancha.projectId });
          arquivoDaBiblioteca.current = { id: guardado.id, nome: guardado.name };
        }
        const daBiblioteca = arquivoDaBiblioteca.current;
        if (!daBiblioteca) throw new Error("Escolha o arquivo de novo.");
        resposta = await fetch("/api/studio/importar", {
          method: "POST", headers: { "Content-Type": "application/json", [CABECALHO_ACEITA]: JSON_GZIP },
          body: JSON.stringify({ fileId: daBiblioteca.id, ...(unidade ? { unidade } : {}) }),
        });
      }
      const corpo = await jsonDaResposta<Importado & { error?: string }>(resposta).catch(() => ({}) as Importado & { error?: string });
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

  // Aberto a partir da biblioteca ("Editar no Editor CAD"): importa na chegada.
  const importouNaAbertura = useRef(false);
  useEffect(() => {
    if (!importarDaBiblioteca || importouNaAbertura.current || !canEdit) return;
    importouNaAbertura.current = true;
    arquivoDaBiblioteca.current = importarDaBiblioteca;
    const relogio = window.setTimeout(() => { void importar(null, ""); }, 0);
    return () => window.clearTimeout(relogio);
    // importar lê o estado corrente; a importação da abertura acontece uma vez só.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importarDaBiblioteca, canEdit]);

  // A importação só entra no desenho depois que alguém confirma a unidade. Um arquivo
  // lido em metro quando era centímetro entra cem vezes maior, e nada na tela denuncia
  // isso antes de a cota ser medida.
  function aceitarImportacao() {
    if (!importado || !canEdit) return;
    try {
      const proximo = mergeCadImport(documento, importado);
      aplicar(proximo, true);
      definirVista(enquadrarElementos(elementosVisiveis(proximo)));
      toast.success(`${importado.elementos.length.toLocaleString("pt-BR")} elemento(s) em ${importado.camadas.length} camada(s) importados. Grave para guardar.`);
      definirImportado(null);
      dxfEscolhido.current = null;
      arquivoDaBiblioteca.current = null;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível importar."); }
  }


  async function salvar() {
    if (!canEdit || salvamentoEmCurso.current) return;
    salvamentoEmCurso.current = true;
    definirSalvando(true); definirConflito(false);
    try {
      // Comprimido: uma planta vinda de DWG passa do teto de 4,5 MB por pedido.
      const corpoJson = JSON.stringify({ documento, revisao, nome });
      const { body, headers } = corpoJson.length > 1_000_000
        ? await corpoComprimido({ documento, revisao, nome })
        : { body: corpoJson, headers: { "Content-Type": "application/json" } };
      const resposta = await fetch(`/api/studio/${prancha.id}`, { method: "PUT", headers, body });
      const corpo = await jsonDaResposta<{ prancha?: Prancha; error?: string; code?: string }>(resposta).catch(() => ({}) as { prancha?: Prancha; error?: string; code?: string });
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
  const realceCor = fundoEscuro ? "#e0b23a" : "#846100";
  const camadasPorId = useMemo(() => new Map(documento.camadas.map((camada) => [camada.id, camada])), [documento.camadas]);
  const selecionadosSet = useMemo(() => new Set(selecoes), [selecoes]);
  const contagemPorCamada = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const elemento of documento.elementos) contagem.set(elemento.camada, (contagem.get(elemento.camada) ?? 0) + 1);
    return contagem;
  }, [documento.elementos]);
  const passoMalha = documento.malhaMm * (vista.largura > 40000 ? 10 : vista.largura > 12000 ? 5 : 1);
  // Planta grande vai para o canvas; o SVG desenha só a seleção por cima dela.
  const modoCanvas = visiveis.length > LIMITE_SVG;
  // O desenho inteiro memorizado: mover o cursor, encaixar ou aproximar não o refaz.
  const desenho = useMemo(() => (modoCanvas ? visiveis.filter((elemento) => selecionadosSet.has(elemento.id)) : visiveis).map((elemento) => {
    const camada = camadasPorId.get(elemento.camada);
    return <DesenhoElemento key={elemento.id} elemento={elemento} selecionado={selecionadosSet.has(elemento.id)} realceCor={realceCor}
      cor={corNaTela(elemento.cor ?? camada?.cor ?? null, fundoEscuro)} tracejado={tracejadoPara(elemento.tipoLinha ?? camada?.tipoLinha, documento.escala)} />;
  }), [modoCanvas, visiveis, camadasPorId, selecionadosSet, fundoEscuro, realceCor, documento.escala]);

  // Tamanho da tela observado, não lido a cada movimento.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(([entrada]) => {
      larguraTela.current = entrada.contentRect.width;
      definirTamanhoTela({ largura: entrada.contentRect.width, altura: entrada.contentRect.height });
    });
    observador.observe(svg);
    return () => observador.disconnect();
  }, []);

  // Pinta o canvas no próximo quadro sempre que o desenho, a vista ou a aparência mudam.
  const [imagensProntas, definirImagensProntas] = useState(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!modoCanvas || !canvas) return;
    const quadro = requestAnimationFrame(() => desenharPrancha(canvas, {
      documento, visiveis, camadasPorId, vista: { ...vista, proporcao: 0.62 }, fundoEscuro, realceCor, passoMalha: grade ? passoMalha : 0,
      tracejadoDe: tracejadoPara, aoCarregarImagem: () => definirImagensProntas((n) => n + 1),
    }));
    return () => cancelAnimationFrame(quadro);
  }, [modoCanvas, documento, visiveis, camadasPorId, vista, fundoEscuro, realceCor, passoMalha, grade, tamanhoTela, imagensProntas]);
  const camadasFiltradas = useMemo(() => {
    const termo = filtroCamada.trim().toLowerCase();
    return termo ? documento.camadas.filter((camada) => camada.nome.toLowerCase().includes(termo)) : documento.camadas;
  }, [documento.camadas, filtroCamada]);

  function alternarFundo() {
    definirFundoEscuro((atual) => {
      try { window.localStorage.setItem("hoikos-cad-fundo", atual ? "claro" : "escuro"); } catch { /* preferência só desta visita */ }
      return !atual;
    });
  }

  /** Liga ou desliga várias camadas de uma vez (todas, as filtradas ou todas menos uma). */
  function visibilidadeEmLote(visivel: (camada: Camada) => boolean) {
    if (!canEdit) return;
    aplicar({ ...documento, camadas: documento.camadas.map((camada) => ({ ...camada, visivel: visivel(camada) })) });
    definirSelecoes([]);
  }

  function apagarCamadaVazia(id: string) {
    if (!canEdit || contagemPorCamada.get(id) || documento.camadas.length <= 1) return;
    aplicar({ ...documento, camadas: documento.camadas.filter((camada) => camada.id !== id) });
    if (camadaEscolhida === id) definirCamadaEscolhida("");
  }

  /** Chaves da barra de status; cada uma avisa na linha de comando, como no AutoCAD. */
  function alternarChave(tecla: string) {
    const chaves: Record<string, [string, boolean, (v: boolean) => void]> = {
      F3: ["Encaixe a objetos", osnap, definirOsnap], F7: ["Grade", grade, definirGrade], F8: ["Orto", orto, definirOrto],
      F9: ["Encaixe na malha", snapGrade, definirSnapGrade], F10: ["Polar", polar, definirPolar], F12: ["Entrada dinâmica", dinamica, definirDinamica],
    };
    const chave = chaves[tecla];
    if (!chave) return false;
    const [rotulo, valor, definir] = chave;
    definir(!valor);
    // Orto e polar não andam juntos: ligar um desliga o outro.
    if (tecla === "F8" && !valor) definirPolar(false);
    if (tecla === "F10" && !valor) definirOrto(false);
    registrar(`<${rotulo} ${valor ? "desligado" : "ligado"}>`);
    return true;
  }

  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      // Ctrl+S grava de qualquer lugar, inclusive com o cursor num campo.
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "s") { evento.preventDefault(); if (canEdit && sujo) void salvar(); return; }
      if (evento.key === "F2") { evento.preventDefault(); definirRegistroAberto((aberto) => !aberto); return; }
      if (/^F(3|7|8|9|10|12)$/.test(evento.key)) { evento.preventDefault(); alternarChave(evento.key); return; }
      const alvo = evento.target as HTMLElement | null;
      if (alvo && (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(alvo.tagName) || alvo.isContentEditable)
        && !(alvo.tagName === "BUTTON" && evento.key.length === 1 && evento.key !== " ")) return;
      if (evento.ctrlKey || evento.metaKey) {
        const letra = evento.key.toLowerCase();
        if (letra === "a") { evento.preventDefault(); definirSelecoes(visiveis.filter(e => !camadaBloqueada(documento, e.camada)).map(e => e.id)); return; }
        if (letra === "y") { evento.preventDefault(); refazer(); return; }
        if (letra === "z") { evento.preventDefault(); if (evento.shiftKey) refazer(); else desfazer(); }
        return;
      }
      if (evento.altKey) return;
      if (evento.key === "Escape") { evento.preventDefault(); escapar(); return; }
      if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        if (ferramenta === "comodo" && pendentes.length) { fecharComodo(); return; }
        if (ferramenta === "parede" && pendentes.length) { definirPendentes([]); return; }
        if (comando.trim()) { enviarComando(); return; }
        cmd().enter(); sincronizar();
        return;
      }
      if (evento.key === "Delete" && selecoes.length && canEdit && !cmd().ativo) { evento.preventDefault(); operarSelecao("E"); return; }
      if (evento.key === "Backspace") { evento.preventDefault(); definirComando((texto) => texto.slice(0, -1)); return; }
      // Digitar em qualquer lugar escreve na linha de comando, como no AutoCAD.
      if (evento.key.length === 1 && canEdit) {
        evento.preventDefault();
        definirComando((texto) => texto + evento.key);
        campoComando.current?.focus();
      }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  useEffect(() => {
    acaoRef.current = (acao: AcaoEditor) => {
      if (acao.tipo === "zoom-extensao") enquadrar();
      else if (acao.tipo === "zoom-anterior") {
        const anterior = vistasAnteriores.current.pop();
        if (anterior) definirVistaEstado(anterior); else registrar("Não há vista anterior.");
      } else if (acao.tipo === "zoom-fator") ampliar(1 / acao.fator);
      else if (acao.tipo === "zoom-janela") {
        const x1 = Math.min(acao.a.x, acao.b.x), x2 = Math.max(acao.a.x, acao.b.x), y1 = Math.min(acao.a.y, acao.b.y), y2 = Math.max(acao.a.y, acao.b.y);
        const largura = Math.max(x2 - x1, (y2 - y1) / 0.62) * 1.04;
        definirVista({ x: (x1 + x2) / 2 - largura / 2, y: (y1 + y2) / 2 - largura * 0.31, largura }, true);
      } else if (acao.tipo === "desfazer") desfazer();
      else if (acao.tipo === "refazer") refazer();
      else if (acao.tipo === "ferramenta") { definirFerramenta(acao.ferramenta as Ferramenta); definirPendentes([]); }
    };
  });

  // Milímetros de desenho por pixel de tela: marcadores, alças e cursor ficam do mesmo
  // tamanho na tela em qualquer zoom.
  const px = vista.largura / Math.max(1, tamanhoTela.largura || 1000);
  const previas = useMemo(() => (pedido?.previa && cursor ? pedido.previa(cursor) : []), [pedido, cursor]);
  const sugestoes = useMemo(() => (!nomeComando && comando.trim() && !/\s/.test(comando.trim()) && !pendentes.length ? sugerirComandos(comando, 6) : []), [comando, nomeComando, pendentes.length]);
  const listaRegistro = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    const lista = listaRegistro.current;
    if (lista) lista.scrollTop = lista.scrollHeight;
  }, [registro, registroAberto]);
  /** Ponto do desenho na tela, em pixels a partir do canto do SVG (que centraliza a vista). */
  function telaDe(ponto: { x: number; y: number }) {
    const { largura, altura } = tamanhoTela;
    if (!largura || !altura) return null;
    const alturaVista = vista.largura * 0.62;
    const escala = Math.min(largura / vista.largura, altura / alturaVista);
    return { x: (largura - vista.largura * escala) / 2 + (ponto.x - vista.x) * escala, y: (altura - alturaVista * escala) / 2 + (ponto.y - vista.y) * escala };
  }

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
              arquivoDaBiblioteca.current = null;
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
              if (arquivoDaBiblioteca.current) void importar(null, escolhida);
              else if (dxfEscolhido.current) void importar(dxfEscolhido.current, escolhida);
            }}>
            {Object.entries(UNIDADES_ROTULO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </NativeSelect>
        </div>
        <Button size="sm" onClick={aceitarImportacao} disabled={importando || !importado.elementos.length}>
          Colocar na prancha
        </Button>
        <Button variant="outline" size="sm" onClick={() => { definirImportado(null); dxfEscolhido.current = null; arquivoDaBiblioteca.current = null; }}>Descartar</Button>
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

    <div className="prancheta-area grid grid-cols-1 gap-4 xl:grid-cols-[13rem_minmax(0,1fr)_20rem]">
      <aside className="prancheta-ferramentas space-y-3">
        {([["Desenho", botoesDesenho], ["Modificar", botoesModificar]] as const).map(([titulo, botoes]) => <div key={titulo} className="space-y-1">
          <p className="eyebrow text-hoikos-600">{titulo}</p>
          <div className="grid grid-cols-6 gap-1 sm:grid-cols-9 xl:grid-cols-4">
            {botoes.map((item) => {
              const ativo = item.comando ? nomeComando === item.comando : !nomeComando && ferramenta === item.ferramenta;
              return <div key={item.id} className="relative">
                <button type="button"
                  onClick={() => escolherBotao(item)}
                  onPointerEnter={(evento) => { if (evento.pointerType === "mouse") aguardarAjuda(item.id); }}
                  onPointerMove={(evento) => { if (evento.pointerType === "mouse") aguardarAjuda(item.id); }}
                  onPointerLeave={esconderAjuda} onPointerDown={esconderAjuda}
                  aria-pressed={ativo} aria-label={`${item.rotulo} (${item.atalho})`}
                  aria-describedby={ajudaVisivel === item.id ? `ajuda-${item.id}` : undefined}
                  disabled={!canEdit && !["selecionar", "dist", "area"].includes(item.id)}
                  className="grid h-10 w-full place-items-center rounded-md border border-hoikos-200 bg-white text-hoikos-700 disabled:opacity-40 aria-pressed:border-hoikos-800 aria-pressed:bg-hoikos-800 aria-pressed:text-white">
                  <item.icone className="size-4" />
                </button>
                {ajudaVisivel === item.id && <div id={`ajuda-${item.id}`} role="tooltip"
                  className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-64 rounded-md border border-hoikos-200 bg-white p-3 text-left shadow-lg">
                  <p className="text-sm font-semibold text-hoikos-900">{item.rotulo} · {item.comando ? `comando ${item.atalho}` : item.atalho === "Esc" ? "tecla Esc" : `comando ${item.atalho}`}</p>
                  <p className="mt-1 text-xs leading-5 text-hoikos-700">{ajudaDoBotao(item)}</p>
                </div>}
              </div>;
            })}
          </div>
        </div>)}

        <Label htmlFor="camada-desenho">Camada de desenho</Label>
        <NativeSelect id="camada-desenho" value={camadaEscolhida} onChange={e => definirCamadaEscolhida(e.target.value)}>
          <option value="">Automática pela ferramenta</option>
          {documento.camadas.map(c => <option key={c.id} value={c.id} disabled={c.bloqueada || !c.visivel}>{c.nome}</option>)}
        </NativeSelect>
        {!nomeComando && ferramenta !== "selecionar" && <p className="text-xs text-hoikos-500">{instrucoes[ferramenta]}</p>}
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
          <p className="eyebrow text-hoikos-600">Encaixe a objetos (F3)</p>
          <div className="grid grid-cols-2 gap-1">
            {TIPOS_ENCAIXE.filter((tipo) => tipo !== "malha").map((tipo) => <button key={tipo} type="button"
              onClick={() => alternarEncaixe(tipo)} aria-pressed={ativosEncaixe.includes(tipo)}
              className="rounded-md border border-hoikos-200 bg-white px-2 py-1.5 text-xs text-hoikos-700 aria-pressed:border-hoikos-800 aria-pressed:bg-hoikos-800 aria-pressed:text-white">
              {encaixeLabels[tipo]}
            </button>)}
          </div>
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
            <Button variant="outline" size="sm" className="flex-1" onClick={alternarFundo} aria-pressed={fundoEscuro} aria-label={fundoEscuro ? "Fundo claro" : "Fundo escuro"} title={fundoEscuro ? "Fundo claro" : "Fundo escuro, como no AutoCAD"}>{fundoEscuro ? <Sun /> : <Moon />}</Button>
          </div>
        </div>
      </aside>

      <div className="prancheta-mesa self-start overflow-hidden rounded-md border border-hoikos-200 bg-white">
        <div className="relative">
        {modoCanvas && <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />}
        <svg ref={svgRef} role="application" aria-label={`Prancha ${nome}`}
          viewBox={`${vista.x} ${vista.y} ${vista.largura} ${vista.largura * 0.62}`}
          className={fullPage ? "w-full touch-none" : "h-[min(70svh,640px)] w-full touch-none"}
          style={{ ...(fullPage ? { height: "max(420px, calc(100svh - 18rem))" } : {}), background: modoCanvas ? "transparent" : fundoEscuro ? "#1f2227" : "#ffffff", position: "relative", cursor: cursor ? "none" : "default", ["--traco-min" as string]: `${vista.largura / 900}px` } as CSSProperties}
          onPointerDown={aoApontar} onPointerMove={aoMover} onPointerUp={aoSoltar}
          onPointerCancel={() => { const gesto = arrastando.current ?? verticeArrastado.current; if (gesto?.mudou) { docRef.current = gesto.documento; definirDocumento(gesto.documento); definirHistorico(h => h.slice(0, -1)); } arrastando.current = null; verticeArrastado.current = null; definirAlcaQuente(null); panorama.current = null; janelaRef.current = null; definirJanelaSelecao(null); definirPendentes([]); }}
          onPointerLeave={() => { definirCursor(null); definirEncaixeAtual(null); definirRastreio(null); }}
          onContextMenu={(evento) => evento.preventDefault()}>
          <defs>
            <pattern id="prancheta-malha-padrao" width={passoMalha} height={passoMalha} patternUnits="userSpaceOnUse">
              <path d={`M ${passoMalha} 0 L 0 0 0 ${passoMalha}`} fill="none" stroke={fundoEscuro ? "#4a4f57" : "#B5B19E"} strokeOpacity={0.5} strokeWidth={passoMalha / 60} />
            </pattern>
          </defs>
          {!modoCanvas && grade && <rect x={vista.x - vista.largura} y={vista.y - vista.largura} width={vista.largura * 3} height={vista.largura * 3} fill="url(#prancheta-malha-padrao)" />}
          {!modoCanvas && documento.fundo && <image href={documento.fundo.chave} x={0} y={0}
            width={documento.fundo.larguraMm} height={documento.fundo.alturaMm}
            opacity={documento.fundo.opacidade / 100} preserveAspectRatio="xMidYMid meet" />}
          <CamadaDesenho>{desenho}</CamadaDesenho>
          {/* Janela da esquerda para a direita: azul, contorno cheio, pega o que está inteiro
              dentro. Da direita para a esquerda: verde, tracejada, pega o que ela toca. */}
          {janelaSelecao && (() => {
            const cruzada = janelaSelecao.b.x < janelaSelecao.a.x;
            return <rect x={Math.min(janelaSelecao.a.x, janelaSelecao.b.x)} y={Math.min(janelaSelecao.a.y, janelaSelecao.b.y)}
              width={Math.abs(janelaSelecao.b.x - janelaSelecao.a.x)} height={Math.abs(janelaSelecao.b.y - janelaSelecao.a.y)}
              fill={cruzada ? "#22c55e" : "#3b82f6"} fillOpacity={0.12} stroke={cruzada ? "#16a34a" : "#2563eb"}
              strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray={cruzada ? "6 4" : undefined} />;
          })()}
          {previas.length > 0 && <path d={previas.map(caminhoDaPrevia).join(" ")} fill="none" stroke={realceCor} strokeWidth={1.5}
            vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />}
          {pedido?.base && cursor && !pedido.livre && (pedido.modo === "ponto" || pedido.modo === "valor") && <line x1={pedido.base.x} y1={pedido.base.y} x2={cursor.x} y2={cursor.y}
            stroke={realceCor} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />}
          {pendentes.length > 0 && <polyline
            points={[...pendentes, ...(cursor ? [cursor] : [])].map((ponto) => `${ponto.x},${ponto.y}`).join(" ")}
            fill="none" stroke={realceCor} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />}
          {/* Rastreamento polar: a linha pontilhada mostra a direção em que o ponto está preso. */}
          {rastreio && <line x1={rastreio.origem.x} y1={rastreio.origem.y}
            x2={rastreio.origem.x + Math.cos(rastreio.angulo * Math.PI / 180) * vista.largura * 3}
            y2={rastreio.origem.y - Math.sin(rastreio.angulo * Math.PI / 180) * vista.largura * 3}
            stroke="#16a34a" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 4" />}
          {/* Alças dos objetos selecionados: quadrados azuis; a quente fica vermelha. */}
          {canEdit && !pedido && comAlcas.flatMap((elemento) => verticesDe(elemento).map((vertice) => {
            const quente = alcaQuente?.id === elemento.id && alcaQuente.indice === vertice.indice;
            return <rect key={`${elemento.id}-${vertice.indice}`}
              x={vertice.ponto.x - px * 5} y={vertice.ponto.y - px * 5} width={px * 10} height={px * 10}
              fill={quente ? "#ef4444" : "#3b82f6"} stroke={fundoEscuro ? "#ffffff" : "#1e3a8a"} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
          }))}
          {/* Marcador do encaixe: cada tipo tem o seu desenho, como no AutoCAD. */}
          {encaixeAtual && encaixeAtual.tipo !== "malha" && cursor && <g>
            <path d={marcadorDoEncaixe(encaixeAtual.tipo, encaixeAtual.ponto, px * 7)} fill="none" stroke={fundoEscuro ? "#facc15" : "#c2410c"} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <text x={encaixeAtual.ponto.x + px * 11} y={encaixeAtual.ponto.y - px * 10} fontSize={px * 11} fontFamily="Arial, Helvetica, sans-serif"
              fill={fundoEscuro ? "#facc15" : "#7c2d12"} stroke={fundoEscuro ? "#1f2227" : "#ffffff"} strokeWidth={px * 3} style={{ paintOrder: "stroke" }}>{encaixeLabels[encaixeAtual.tipo]}</text>
          </g>}
          {/* Cursor em cruz; com a caixinha de seleção quando o clique escolhe objetos. */}
          {cursor && <g stroke={fundoEscuro ? "#e8e8e8" : "#303030"} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" pointerEvents="none">
            <line x1={cursor.x - px * 40} y1={cursor.y} x2={cursor.x + px * 40} y2={cursor.y} vectorEffect="non-scaling-stroke" />
            <line x1={cursor.x} y1={cursor.y - px * 40} x2={cursor.x} y2={cursor.y + px * 40} vectorEffect="non-scaling-stroke" />
            {(!pedido || pedido.modo === "selecao" || pedido.modo === "objeto") && ferramenta === "selecionar" && !alcaQuente
              && <rect x={cursor.x - px * 5} y={cursor.y - px * 5} width={px * 10} height={px * 10} vectorEffect="non-scaling-stroke" />}
          </g>}
        </svg>
        {/* Entrada dinâmica (F12): o prompt e o que se digita ao lado do cursor. */}
        {dinamica && cursor && (pedido || comando || rastreio) && (() => {
          const tela = telaDe(cursor);
          if (!tela) return null;
          const base = pedido?.base;
          const medida = base ? `${medidaMm(Math.hypot(cursor.x - base.x, cursor.y - base.y))} mm · ${medidaMm(((Math.atan2(-(cursor.y - base.y), cursor.x - base.x) * 180 / Math.PI) % 360 + 360) % 360)}°` : null;
          return <div aria-hidden="true" className="pointer-events-none absolute z-10 max-w-72 rounded border border-hoikos-300 bg-white/95 px-2 py-1 font-mono text-[11px] leading-4 text-hoikos-800 shadow"
            style={{ left: Math.min(tela.x + 18, Math.max(0, tamanhoTela.largura - 200)), top: Math.min(tela.y + 22, Math.max(0, tamanhoTela.altura - 60)) }}>
            {pedido && <p className="truncate">{textoDoPedido(pedido)}</p>}
            {rastreio && <p className="text-green-700">Polar: {medidaMm(rastreio.distancia)} &lt; {rastreio.angulo}°</p>}
            {medida && !rastreio && <p className="text-hoikos-600">{medida}</p>}
            {comando && <p className="mt-0.5 rounded bg-hoikos-100 px-1">{comando}</p>}
          </div>;
        })()}
        </div>
        {/* Barra de status: coordenadas e as chaves do AutoCAD. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hoikos-200 px-3 py-1.5 text-xs text-hoikos-500">
          <span className="font-mono tabular-nums">
            {cursor ? `${Number(cursor.x.toFixed(3))}, ${Number((-cursor.y).toFixed(3))}` : "Mova o cursor sobre a prancha"}
          </span>
          {pendentes.length > 0 && cursor && <span>{metros(comprimentoM(pendentes[pendentes.length - 1], cursor))}</span>}
          <div className="ml-auto flex flex-wrap gap-1">
            {([["F7", "Grade", grade], ["F9", "Malha", snapGrade], ["F8", "Orto", orto], ["F10", "Polar", polar], ["F3", "Encaixe", osnap], ["F12", "Dinâmica", dinamica]] as const).map(([tecla, rotulo, valor]) =>
              <button key={tecla} type="button" aria-pressed={valor} title={`${rotulo} (${tecla})`} onClick={() => alternarChave(tecla)}
                className="rounded border border-hoikos-200 px-1.5 py-0.5 font-medium text-hoikos-600 aria-pressed:border-hoikos-800 aria-pressed:bg-hoikos-800 aria-pressed:text-white">
                {rotulo}
              </button>)}
          </div>
        </div>
        {/* Linha de comando: histórico em cima, prompt e opções embaixo, como no AutoCAD. */}
        <section aria-label="Linha de comando CAD" className="border-t border-hoikos-200 bg-hoikos-50 font-mono text-xs">
          <ol ref={listaRegistro} aria-live="polite" className={`${registroAberto ? "max-h-64" : "max-h-[3.9rem]"} overflow-y-auto px-3 pt-1.5 leading-5 text-hoikos-600`}>
            {registro.slice(registroAberto ? -200 : -3).map((linha, indice) => <li key={`${registro.length}-${indice}`} className="break-words">{linha}</li>)}
          </ol>
          <form className="flex flex-wrap items-center gap-1.5 px-3 py-1.5" onSubmit={enviarComando}>
            <Label htmlFor="cad-command" className="max-w-full shrink-0 font-mono text-xs text-hoikos-900">{pedido ? textoDoPedido(pedido) : "Comando:"}</Label>
            {pedido?.opcoes?.map((opcao) => <Button key={opcao.chave} type="button" size="sm" variant="outline" className="h-7 px-2 font-mono text-xs"
              onClick={() => { registrar(`${textoDoPedido(pedido)} ${opcao.rotulo}`); cmd().responder({ tipo: "opcao", chave: opcao.chave }); sincronizar(); }}>{opcao.rotulo}</Button>)}
            <Input id="cad-command" ref={campoComando} value={comando} disabled={!canEdit} autoComplete="off" spellCheck={false}
              placeholder={pedido ? "" : "Digite um comando"} className="h-8 min-w-0 flex-1 basis-32 font-mono text-xs"
              onChange={(evento) => { definirComando(evento.target.value); indiceDigitado.current = -1; }}
              onKeyDown={(evento) => {
                if (evento.key === "Escape") { evento.preventDefault(); evento.stopPropagation(); escapar(); return; }
                // Espaço é Enter, menos quando o comando pede um texto.
                if (evento.key === " " && pedido?.modo !== "texto") { evento.preventDefault(); evento.stopPropagation(); enviarComando(); return; }
                if (evento.key === "Tab" && sugestoes.length) { evento.preventDefault(); definirComando(sugestoes[0].nome); return; }
                if ((evento.key === "ArrowUp" || evento.key === "ArrowDown") && linhasDigitadas.length) {
                  evento.preventDefault();
                  const total = linhasDigitadas.length;
                  const atual = indiceDigitado.current < 0 ? total : indiceDigitado.current;
                  const proximo = Math.max(0, Math.min(total, atual + (evento.key === "ArrowUp" ? -1 : 1)));
                  indiceDigitado.current = proximo;
                  definirComando(proximo === total ? "" : linhasDigitadas[proximo]);
                }
              }} />
            <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!canEdit}>Enter</Button>
            {nomeComando && <Button type="button" size="sm" variant="ghost" className="h-8" onClick={escapar}>Esc</Button>}
            <Button type="button" size="sm" variant="ghost" className="h-8" aria-pressed={registroAberto} onClick={() => definirRegistroAberto((aberto) => !aberto)}
              aria-label="Histórico de comandos (F2)" title="Histórico de comandos (F2)">F2</Button>
          </form>
          {sugestoes.length > 0 && <ul aria-label="Comandos sugeridos" className="flex flex-wrap gap-1 px-3 pb-1.5">
            {sugestoes.map((sugestao) => <li key={sugestao.nome}><button type="button" className="rounded border border-hoikos-200 bg-white px-1.5 py-0.5"
              onClick={() => { definirComando(""); iniciarComando(sugestao.nome); }}>
              {sugestao.nome}<span className="text-hoikos-500"> {sugestao.atalhos[0] ?? ""}</span>
            </button></li>)}
          </ul>}
          <details className="px-3 pb-2 font-sans">
            <summary className="cursor-pointer">Comandos e atalhos</summary>
            <div className="grid gap-1 pt-2 sm:grid-cols-2 lg:grid-cols-3">
              {COMANDOS.map((item) => <button key={item.nome} type="button" className="rounded border border-hoikos-200 bg-white p-2 text-left" onClick={() => iniciarComando(item.nome)} disabled={!canEdit}>
                <code>{item.nome}</code> <span className="text-hoikos-500">{item.atalhos.slice(0, 2).join(" · ")}</span>
                <span className="block pt-0.5 text-hoikos-700">{item.descricao}</span>
              </button>)}
            </div>
            <p className="pt-2 text-hoikos-600">
              Coordenadas em mm: x,y absoluto · @dx,dy relativo · distância&lt;ângulo · só a distância segue o cursor. END, MID, CEN, INT, PER e QUA forçam um encaixe no próximo ponto.
              Uma linha inteira também vale, como em script: {CAD_COMMANDS.slice(0, 4).map((item) => item.syntax).join(" · ")}.
            </p>
            <p className="pt-1 text-hoikos-600">Teclas: Enter ou Espaço confirmam e repetem o último comando · Esc cancela · F3 encaixe · F7 grade · F8 orto · F9 malha · F10 polar · F12 entrada dinâmica · botão do meio desloca, duplo clique nele enquadra.</p>
          </details>
        </section>
      </div>

      <aside className="prancheta-painel">
        <Tabs defaultValue="propriedades">
          <TabsList className="h-auto w-full flex-wrap">
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
              <p className="eyebrow text-hoikos-600">{rotuloDoTipo[selecionado.tipo]} · {camadasPorId.get(selecionado.camada)?.nome ?? "sem camada"}</p>
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
                <Label htmlFor="prop-alinhamento" className="text-xs">Alinhamento</Label>
                <NativeSelect id="prop-alinhamento" value={selecionado.ancoraH ?? "inicio"} disabled={!canEdit}
                  onChange={(evento) => trocar(selecionado.id, { ancoraH: evento.target.value === "inicio" ? undefined : evento.target.value } as Partial<Elemento>)}>
                  <option value="inicio">À esquerda do ponto</option><option value="meio">Centrado no ponto</option><option value="fim">À direita do ponto</option>
                </NativeSelect>
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
              {["traco", "arco", "parede", "texto", "hachura"].includes(selecionado.tipo) && <div className="grid grid-cols-[auto_1fr] items-center gap-2 border-t border-hoikos-200 pt-3">
                <Label htmlFor="prop-cor" className="text-xs">Cor</Label>
                <div className="flex items-center gap-2">
                  <input id="prop-cor" type="color" value={selecionado.cor ?? camadasPorId.get(selecionado.camada)?.cor ?? "#1c190f"} disabled={!canEdit}
                    onChange={(evento) => trocar(selecionado.id, { cor: evento.target.value } as Partial<Elemento>)} className="h-8 w-12 cursor-pointer rounded border" />
                  {selecionado.cor && canEdit && <Button size="sm" variant="ghost" onClick={() => trocar(selecionado.id, { cor: undefined } as Partial<Elemento>)}>Da camada</Button>}
                </div>
                {(selecionado.tipo === "traco" || selecionado.tipo === "arco") && <>
                  <Label htmlFor="prop-linha" className="text-xs">Linha</Label>
                  <NativeSelect id="prop-linha" value={selecionado.tipoLinha ?? ""} disabled={!canEdit}
                    onChange={(evento) => trocar(selecionado.id, { tipoLinha: evento.target.value || undefined } as Partial<Elemento>)}>
                    <option value="">Da camada</option>
                    {TIPOS_LINHA.map((tipo) => <option key={tipo} value={tipo}>{tipoLinhaLabels[tipo]}</option>)}
                  </NativeSelect>
                </>}
              </div>}
              {selecionado.tipo === "hachura" && <p className="text-xs text-hoikos-500">{selecionado.solida ? "Preenchimento sólido" : `Hachura${selecionado.padrao ? ` ${selecionado.padrao}` : ""}`} · {selecionado.aneis.length} contorno(s) · {metrosQuadrados(Math.abs(selecionado.aneis.reduce((soma, anel, i) => soma + (i === 0 ? 1 : -1) * areaM2(anel), 0)))}</p>}
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
            }}><Input aria-label="Nome da nova camada" maxLength={255} value={novaCamada} onChange={e => definirNovaCamada(e.target.value)} placeholder="Nova camada" /><Button type="submit" disabled={!novaCamada.trim() || documento.camadas.length >= LIMITE_CAMADAS}>Criar</Button></form>}

            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-hoikos-500" />
              <Input aria-label="Filtrar camadas pelo nome" value={filtroCamada} onChange={(e) => definirFiltroCamada(e.target.value)} placeholder={`Filtrar ${documento.camadas.length} camadas`} className="pl-8" />
            </div>
            <p className="text-xs text-hoikos-500">{documento.camadas.filter((c) => c.visivel).length} de {documento.camadas.length} visíveis{filtroCamada ? ` · ${camadasFiltradas.length} no filtro` : ""}</p>
            {canEdit && <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" onClick={() => visibilidadeEmLote(() => true)}><Eye />Mostrar todas</Button>
              <Button size="sm" variant="outline" onClick={() => visibilidadeEmLote(() => false)}><EyeOff />Esconder todas</Button>
              {filtroCamada && <Button size="sm" variant="outline" onClick={() => { const ids = new Set(camadasFiltradas.map((c) => c.id)); visibilidadeEmLote((c) => ids.has(c.id)); }}>Só as filtradas</Button>}
            </div>}

            <ul className="max-h-[60svh] space-y-1 overflow-y-auto pr-1">
              {camadasFiltradas.map((camada) => {
                const quantos = contagemPorCamada.get(camada.id) ?? 0;
                return <li key={camada.id} className="rounded-md border border-hoikos-200 bg-white px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="relative grid size-6 shrink-0 place-items-center" title="Cor da camada">
                      <span className="size-4 rounded-sm border border-hoikos-300" style={{ background: camada.cor ?? (fundoEscuro ? "#f2f0e8" : "#1C190F") }} />
                      <input type="color" aria-label={`Cor da camada ${camada.nome}`} value={camada.cor ?? "#1c190f"} disabled={!canEdit}
                        onChange={(e) => trocarCamada(camada.id, { cor: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
                    </label>
                    <div className="min-w-0 flex-1">
                      {canEdit ? <input aria-label={`Nome da camada ${camada.nome}`} defaultValue={camada.nome} maxLength={255}
                        onBlur={(e) => { const nome = e.target.value.trim(); if (nome && nome !== camada.nome) trocarCamada(camada.id, { nome }); else e.target.value = camada.nome; }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        className="w-full truncate rounded bg-transparent px-1 text-sm font-medium text-hoikos-800 focus:bg-hoikos-50 focus:outline-1" />
                        : <p className="truncate text-sm font-medium text-hoikos-800" title={camada.nome}>{camada.nome}</p>}
                      <p className="px-1 text-xs text-hoikos-500">{quantos.toLocaleString("pt-BR")} elemento{quantos === 1 ? "" : "s"}</p>
                    </div>
                    <button type="button" onClick={() => trocarCamada(camada.id, { visivel: !camada.visivel })}
                      aria-label={`${camada.visivel ? "Esconder" : "Mostrar"} ${camada.nome}`} aria-pressed={camada.visivel}
                      className="grid size-8 place-items-center rounded-md text-hoikos-600 hover:bg-hoikos-50">
                      {camada.visivel ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                    </button>
                    <button type="button" onClick={() => trocarCamada(camada.id, { bloqueada: !camada.bloqueada })}
                      aria-label={`${camada.bloqueada ? "Destravar" : "Travar"} ${camada.nome}`} aria-pressed={camada.bloqueada}
                      className="grid size-8 place-items-center rounded-md text-hoikos-600 hover:bg-hoikos-50">
                      {camada.bloqueada ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
                    </button>
                  </div>
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer px-1 text-hoikos-600">Mais opções</summary>
                    <div className="mt-2 grid gap-2">
                      <Label htmlFor={`linha-${camada.id}`} className="text-xs">Tipo de linha</Label>
                      <NativeSelect id={`linha-${camada.id}`} value={camada.tipoLinha ?? "continua"} disabled={!canEdit}
                        onChange={(e) => trocarCamada(camada.id, { tipoLinha: e.target.value === "continua" ? undefined : e.target.value as TipoLinha })}>
                        {TIPOS_LINHA.map((tipo) => <option key={tipo} value={tipo}>{tipoLinhaLabels[tipo]}</option>)}
                      </NativeSelect>
                      <Label htmlFor={`disciplina-${camada.id}`} className="text-xs">Disciplina</Label>
                      <NativeSelect id={`disciplina-${camada.id}`} value={camada.disciplina} disabled={!canEdit}
                        onChange={(e) => trocarCamada(camada.id, { disciplina: e.target.value as Camada["disciplina"] })}>
                        {DISCIPLINAS.map((d) => <option key={d} value={d}>{disciplinaLabels[d]}</option>)}
                      </NativeSelect>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" disabled={!quantos || !camada.visivel || camada.bloqueada}
                          onClick={() => { definirFerramenta("selecionar"); definirSelecoes(documento.elementos.filter((e) => e.camada === camada.id).map((e) => e.id)); }}>Selecionar tudo</Button>
                        <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => visibilidadeEmLote((c) => c.id === camada.id)}>Isolar</Button>
                        {canEdit && !camada.cor ? null : canEdit && <Button size="sm" variant="ghost" onClick={() => trocarCamada(camada.id, { cor: undefined })}>Cor de tinta</Button>}
                        {canEdit && !quantos && documento.camadas.length > 1 && <Button size="sm" variant="ghost" onClick={() => apagarCamadaVazia(camada.id)}><Trash2 />Apagar vazia</Button>}
                      </div>
                    </div>
                  </details>
                </li>;
              })}
            </ul>
            <p className="text-xs leading-5 text-hoikos-500">
              Esconder é visualização, não exclusão: a camada escondida sai da tela e do arquivo exportado, e continua contando no quantitativo.
              Camadas vindas do DWG trazem cor, tipo de linha e o estado que tinham no arquivo.
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
