"use client";

import { corNaTela } from "@/lib/cad-cores";
import { areaM2, comprimentoM, glifoDoSimbolo, limitesEmCache, pontosDoArco, type Camada, type Documento, type Elemento } from "@/lib/prancheta";

// Desenho da prancha em canvas, para plantas grandes.
//
// Com dezenas de milhares de elementos (um DWG importado), o SVG vira dezenas de milhares
// de nós: cada zoom reestilizava todos, cada movimento do mouse reconciliava todos, e o
// editor travava. Aqui o desenho é pintado de uma vez, só o que aparece na tela, com os
// traços da mesma cor e espessura agrupados num caminho só. Seleção, cursor, alças e
// prévias continuam no SVG por cima — são poucos e precisam ser interativos.

export type VistaCanvas = { x: number; y: number; largura: number; proporcao: number };

const caixaDe = limitesEmCache;

const imagens = new Map<string, HTMLImageElement | null>();
function imagem(url: string, aoCarregar: () => void) {
  if (imagens.has(url)) { const pronta = imagens.get(url); return pronta?.complete && pronta.naturalWidth ? pronta : null; }
  const nova = new Image();
  imagens.set(url, nova);
  nova.onload = aoCarregar;
  nova.onerror = () => imagens.set(url, null);
  nova.src = url;
  return null;
}

const tracejadoEmNumeros = new Map<string, number[]>();
function tracos(texto: string | undefined) {
  if (!texto) return [];
  let lista = tracejadoEmNumeros.get(texto);
  if (!lista) { lista = texto.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0); tracejadoEmNumeros.set(texto, lista); }
  return lista;
}

export type OpcoesCanvas = {
  documento: Documento;
  visiveis: Elemento[];
  camadasPorId: Map<string, Camada>;
  vista: VistaCanvas;
  fundoEscuro: boolean;
  realceCor: string;
  passoMalha: number;
  tracejadoDe: (tipo: Camada["tipoLinha"], escala: number) => string | undefined;
  aoCarregarImagem: () => void;
};

export function desenharPrancha(canvas: HTMLCanvasElement, opcoes: OpcoesCanvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const razao = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * razao) || canvas.height !== Math.round(H * razao)) {
    canvas.width = Math.round(W * razao); canvas.height = Math.round(H * razao);
  }
  const { vista, fundoEscuro, documento } = opcoes;
  // O mesmo enquadramento do SVG (viewBox com "meet"): escala única, desenho centrado.
  const vw = vista.largura, vh = vista.largura * vista.proporcao;
  const s = Math.min(W / vw, H / vh);
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  const px = 1 / s; // um pixel de tela em milímetros do desenho
  const x1 = vista.x - ox / s, y1 = vista.y - oy / s, x2 = x1 + W / s, y2 = y1 + H / s;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = fundoEscuro ? "#1f2227" : "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(razao * s, 0, 0, razao * s, razao * (ox - vista.x * s), razao * (oy - vista.y * s));

  // Malha
  const passo = opcoes.passoMalha;
  if (passo > 0 && (x2 - x1) / passo < 400 && (y2 - y1) / passo < 400) {
    ctx.beginPath();
    for (let x = Math.floor(x1 / passo) * passo; x <= x2; x += passo) { ctx.moveTo(x, y1); ctx.lineTo(x, y2); }
    for (let y = Math.floor(y1 / passo) * passo; y <= y2; y += passo) { ctx.moveTo(x1, y); ctx.lineTo(x2, y); }
    ctx.strokeStyle = fundoEscuro ? "rgba(74,79,87,0.5)" : "rgba(181,177,158,0.5)";
    ctx.lineWidth = px;
    ctx.stroke();
  }

  if (documento.fundo) {
    const fundo = imagem(documento.fundo.chave, opcoes.aoCarregarImagem);
    if (fundo) { ctx.globalAlpha = documento.fundo.opacidade / 100; ctx.drawImage(fundo, 0, 0, documento.fundo.larguraMm, documento.fundo.alturaMm); ctx.globalAlpha = 1; }
  }

  // Traços da mesma aparência seguidos viram um caminho só: um stroke para centenas de linhas.
  let lote: { cor: string; largura: number; tracejado: string; tampa: CanvasLineCap } | null = null;
  const fecharLote = () => {
    if (!lote) return;
    ctx.strokeStyle = lote.cor; ctx.lineWidth = lote.largura; ctx.setLineDash(tracos(lote.tracejado));
    ctx.lineCap = lote.tampa; ctx.lineJoin = "round";
    ctx.stroke();
    ctx.setLineDash([]);
    lote = null;
  };
  const noLote = (cor: string, largura: number, tracejado: string, tampa: CanvasLineCap) => {
    if (!lote || lote.cor !== cor || lote.largura !== largura || lote.tracejado !== tracejado || lote.tampa !== tampa) {
      fecharLote();
      lote = { cor, largura, tracejado, tampa };
      ctx.beginPath();
    }
  };
  const texto = (conteudo: string, x: number, y: number, altura: number, cor: string, alinhamento: CanvasTextAlign = "center", base: CanvasTextBaseline = "alphabetic") => {
    if (altura / px < 2) return; // ilegível nesta distância: não vale o custo
    ctx.font = `${altura}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = cor; ctx.textAlign = alinhamento; ctx.textBaseline = base;
    ctx.fillText(conteudo, x, y);
  };
  const girado = (posicao: { x: number; y: number }, graus: number, desenhar: () => void) => {
    ctx.save();
    if (graus) { ctx.translate(posicao.x, posicao.y); ctx.rotate(graus * Math.PI / 180); ctx.translate(-posicao.x, -posicao.y); }
    desenhar();
    ctx.restore();
  };

  for (const elemento of opcoes.visiveis) {
    const c = caixaDe(elemento);
    if (c.x2 < x1 || c.x1 > x2 || c.y2 < y1 || c.y1 > y2) continue;
    const camada = opcoes.camadasPorId.get(elemento.camada);
    const cor = corNaTela(elemento.cor ?? camada?.cor ?? null, fundoEscuro);
    if (elemento.tipo === "traco" || elemento.tipo === "arco") {
      const tracejado = opcoes.tracejadoDe(elemento.tipoLinha ?? camada?.tipoLinha, documento.escala) ?? "";
      noLote(cor, Math.max(elemento.espessuraMm, px), tracejado, "round");
      const pontos = elemento.tipo === "arco" ? pontosDoArco(elemento) : elemento.pontos;
      ctx.moveTo(pontos[0].x, pontos[0].y);
      for (let i = 1; i < pontos.length; i += 1) ctx.lineTo(pontos[i].x, pontos[i].y);
      continue;
    }
    if (elemento.tipo === "parede") {
      noLote(cor, Math.max(elemento.espessuraMm, px), "", "square");
      ctx.moveTo(elemento.a.x, elemento.a.y); ctx.lineTo(elemento.b.x, elemento.b.y);
      continue;
    }
    fecharLote();
    switch (elemento.tipo) {
      case "hachura": {
        const caminho = new Path2D();
        for (const anel of elemento.aneis) {
          caminho.moveTo(anel[0].x, anel[0].y);
          for (let i = 1; i < anel.length; i += 1) caminho.lineTo(anel[i].x, anel[i].y);
          caminho.closePath();
        }
        ctx.globalAlpha = elemento.solida ? 1 : 0.28;
        ctx.fillStyle = cor;
        ctx.fill(caminho, "evenodd");
        ctx.globalAlpha = 1;
        break;
      }
      case "texto":
        girado(elemento.posicao, elemento.rotacaoGraus, () => texto(elemento.texto, elemento.posicao.x, elemento.posicao.y, elemento.alturaMm, cor,
          elemento.ancoraH === "meio" ? "center" : elemento.ancoraH === "fim" ? "end" : "start",
          elemento.ancoraV === "meio" ? "middle" : elemento.ancoraV === "topo" ? "hanging" : "alphabetic"));
        break;
      case "comodo": {
        ctx.beginPath();
        elemento.pontos.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = "rgba(181,177,158,0.18)"; ctx.fill();
        ctx.strokeStyle = opcoes.realceCor; ctx.lineWidth = Math.max(20, px); ctx.stroke();
        if (elemento.nome) {
          const centro = elemento.pontos.reduce((soma, p) => ({ x: soma.x + p.x / elemento.pontos.length, y: soma.y + p.y / elemento.pontos.length }), { x: 0, y: 0 });
          texto(elemento.nome, centro.x, centro.y, 220, cor);
          texto(`${areaM2(elemento.pontos).toFixed(2).replace(".", ",")} m²`, centro.x, centro.y + 260, 170, opcoes.realceCor);
        }
        break;
      }
      case "abertura":
        girado(elemento.posicao, elemento.rotacaoGraus, () => {
          const meia = elemento.larguraMm / 2, p = elemento.posicao;
          ctx.strokeStyle = cor;
          if (elemento.especie === "porta") {
            ctx.lineWidth = Math.max(40, px);
            ctx.stroke(new Path2D(`M ${p.x - meia} ${p.y} l ${elemento.larguraMm} 0 m ${-elemento.larguraMm} 0 a ${elemento.larguraMm} ${elemento.larguraMm} 0 0 1 ${elemento.larguraMm} ${elemento.larguraMm}`));
          } else {
            ctx.lineWidth = Math.max(elemento.especie === "janela" ? 60 : 40, px);
            if (elemento.especie === "passagem") ctx.setLineDash([180, 120]);
            ctx.beginPath(); ctx.moveTo(p.x - meia, p.y); ctx.lineTo(p.x + meia, p.y); ctx.stroke();
            ctx.setLineDash([]);
          }
        });
        break;
      case "simbolo":
        girado(elemento.posicao, elemento.rotacaoGraus, () => {
          const glifo = glifoDoSimbolo(elemento.familia);
          ctx.translate(elemento.posicao.x, elemento.posicao.y);
          const caminho = new Path2D(glifo.d);
          if (glifo.preenchido) { ctx.fillStyle = opcoes.realceCor; ctx.fill(caminho); }
          ctx.strokeStyle = opcoes.realceCor; ctx.lineWidth = Math.max(35, px); ctx.stroke(caminho);
        });
        break;
      case "mobilia":
        girado(elemento.posicao, elemento.rotacaoGraus, () => {
          const x = elemento.posicao.x - elemento.larguraMm / 2, y = elemento.posicao.y - elemento.alturaMm / 2;
          ctx.beginPath(); ctx.roundRect(x, y, elemento.larguraMm, elemento.alturaMm, 40);
          ctx.globalAlpha = 0.9; ctx.fillStyle = "#F4F2E9"; ctx.fill(); ctx.globalAlpha = 1;
          ctx.strokeStyle = cor; ctx.lineWidth = Math.max(25, px); ctx.stroke();
          texto(elemento.rotulo, elemento.posicao.x, elemento.posicao.y + 60, 150, "#38301B");
        });
        break;
      case "imagem":
        girado(elemento.posicao, elemento.rotacaoGraus, () => {
          const figura = imagem(elemento.chave, opcoes.aoCarregarImagem);
          const x = elemento.posicao.x - elemento.larguraMm / 2, y = elemento.posicao.y - elemento.alturaMm / 2;
          if (!figura) { ctx.strokeStyle = cor; ctx.lineWidth = px; ctx.strokeRect(x, y, elemento.larguraMm, elemento.alturaMm); return; }
          // "slice": cobre a caixa inteira, cortando o excesso da imagem, como no SVG.
          const escala = Math.max(elemento.larguraMm / figura.naturalWidth, elemento.alturaMm / figura.naturalHeight);
          const sw = elemento.larguraMm / escala, sh = elemento.alturaMm / escala;
          ctx.drawImage(figura, (figura.naturalWidth - sw) / 2, (figura.naturalHeight - sh) / 2, sw, sh, x, y, elemento.larguraMm, elemento.alturaMm);
        });
        break;
      case "cota": {
        const d = elemento.deslocamentoMm;
        ctx.beginPath();
        ctx.moveTo(elemento.a.x, elemento.a.y + d); ctx.lineTo(elemento.b.x, elemento.b.y + d);
        ctx.moveTo(elemento.a.x, elemento.a.y); ctx.lineTo(elemento.a.x, elemento.a.y + d);
        ctx.moveTo(elemento.b.x, elemento.b.y); ctx.lineTo(elemento.b.x, elemento.b.y + d);
        ctx.strokeStyle = opcoes.realceCor; ctx.lineWidth = Math.max(18, px); ctx.stroke();
        texto(`${comprimentoM(elemento.a, elemento.b).toFixed(2).replace(".", ",")} m`, (elemento.a.x + elemento.b.x) / 2, (elemento.a.y + elemento.b.y) / 2 + d - 80, 180, opcoes.realceCor);
        break;
      }
    }
  }
  fecharLote();
}
