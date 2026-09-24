"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, Plus, Scan } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SimboloItem, tom } from "@/components/layout/simbolos-2d";
import { itemDoCatalogo } from "@/lib/layout-catalogo";
import {
  abrirNoPonto, adicionarParedes, areaM2, centroide, comodoRetangular, comprimentoDaParede, corDoPiso, itemNovo, limitesDoLayout,
  novoId, pisoLabels, pontoNaParede, type LayoutConteudo, type Parede, type Ponto, type TipoAbertura,
} from "@/lib/layout";

export type Ferramenta = "selecionar" | "parede" | "comodo" | TipoAbertura;
export type Selecao = { tipo: "item" | "parede" | "abertura" | "comodo"; id: string } | null;
export type PlantaRef = { centro: () => Ponto; svg: () => SVGSVGElement | null; enquadrar: () => void };

const GRADE = 50;
const IMA = 200;
const encaixe = (valor: number) => Math.round(valor / GRADE) * GRADE;

type Props = {
  doc: LayoutConteudo;
  alterar: (proximo: LayoutConteudo, opcoes?: { agrupar?: string }) => void;
  selecao: Selecao;
  selecionar: (selecao: Selecao) => void;
  ferramenta: Ferramenta;
  setFerramenta: (ferramenta: Ferramenta) => void;
  somenteLeitura: boolean;
  avisar: (mensagem: string) => void;
};

function cantosDaParede(parede: Parede) {
  const comprimento = comprimentoDaParede(parede) || 1;
  const nx = (-(parede.b.y - parede.a.y) / comprimento) * (parede.espessura / 2);
  const ny = ((parede.b.x - parede.a.x) / comprimento) * (parede.espessura / 2);
  return `${parede.a.x + nx},${parede.a.y + ny} ${parede.b.x + nx},${parede.b.y + ny} ${parede.b.x - nx},${parede.b.y - ny} ${parede.a.x - nx},${parede.a.y - ny}`;
}

function medida(mm: number) {
  return `${(mm / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

/** Ponta de parede mais próxima, para o ímã. */
function pontaProxima(doc: LayoutConteudo, alvo: Ponto, limite: number, ignorar?: string) {
  let melhor: Ponto | null = null, distancia = limite;
  for (const parede of doc.paredes) {
    if (parede.id === ignorar) continue;
    for (const ponta of [parede.a, parede.b]) {
      const d = Math.hypot(ponta.x - alvo.x, ponta.y - alvo.y);
      if (d < distancia) { distancia = d; melhor = ponta; }
    }
  }
  return melhor;
}

export const PlantaEditor = forwardRef<PlantaRef, Props>(function PlantaEditor({ doc, alterar, selecao, selecionar, ferramenta, setFerramenta, somenteLeitura, avisar }, ref) {
  const svg = useRef<SVGSVGElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState({ x: -2000, y: -2000, escala: 20 }); // escala: mm por pixel
  const [tamanho, setTamanho] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<Ponto | null>(null);
  const [inicioParede, setInicioParede] = useState<Ponto | null>(null);
  const [retangulo, setRetangulo] = useState<{ a: Ponto; b: Ponto } | null>(null);
  const arraste = useRef<
    | { tipo: "pan"; x: number; y: number; vx: number; vy: number }
    | { tipo: "item"; id: string; dx: number; dy: number; moveu: boolean }
    | { tipo: "ponta"; paredeId: string; ponta: "a" | "b"; original: Ponto }
    | null
  >(null);

  useEffect(() => {
    const alvo = caixa.current;
    if (!alvo) return;
    const observador = new ResizeObserver(() => setTamanho({ w: alvo.clientWidth, h: alvo.clientHeight }));
    observador.observe(alvo);
    return () => observador.disconnect();
  }, []);

  const enquadrar = useCallback(() => {
    const limites = limitesDoLayout(doc) ?? { minX: -3000, minY: -3000, maxX: 7000, maxY: 5000 };
    const w = limites.maxX - limites.minX + 2000, h = limites.maxY - limites.minY + 2000;
    const escala = Math.max(w / Math.max(tamanho.w, 1), h / Math.max(tamanho.h, 1), 2);
    setVista({ escala, x: (limites.minX + limites.maxX) / 2 - (tamanho.w * escala) / 2, y: (limites.minY + limites.maxY) / 2 - (tamanho.h * escala) / 2 });
  }, [doc, tamanho]);

  // Enquadra sozinho enquanto a pessoa não mexeu na vista: a área muda de tamanho ao abrir
  // (painéis, vista lado a lado) e o primeiro enquadre sairia com a medida errada.
  const interagiu = useRef(false);
  const enquadrarRef = useRef(enquadrar);
  useEffect(() => { enquadrarRef.current = enquadrar; }, [enquadrar]);
  useEffect(() => {
    if (interagiu.current || tamanho.w < 50) return;
    const timer = window.setTimeout(() => enquadrarRef.current(), 0);
    return () => window.clearTimeout(timer);
  }, [tamanho.w, tamanho.h]);

  useImperativeHandle(ref, () => ({
    centro: () => ({ x: encaixe(vista.x + (tamanho.w * vista.escala) / 2), y: encaixe(vista.y + (tamanho.h * vista.escala) / 2) }),
    svg: () => svg.current,
    enquadrar,
  }), [vista, tamanho, enquadrar]);

  function paraPlanta(evento: { clientX: number; clientY: number }): Ponto {
    const retang = svg.current!.getBoundingClientRect();
    return { x: vista.x + (evento.clientX - retang.left) * vista.escala, y: vista.y + (evento.clientY - retang.top) * vista.escala };
  }

  function zoom(fator: number, centro?: Ponto) {
    interagiu.current = true;
    setVista((atual) => {
      const escala = Math.min(200, Math.max(1, atual.escala * fator));
      const c = centro ?? { x: atual.x + (tamanho.w * atual.escala) / 2, y: atual.y + (tamanho.h * atual.escala) / 2 };
      return { escala, x: c.x - ((c.x - atual.x) * escala) / atual.escala, y: c.y - ((c.y - atual.y) * escala) / atual.escala };
    });
  }

  // Roda do mouse aproxima pelo ponto do cursor. Precisa ser não-passivo para impedir a rolagem da página.
  useEffect(() => {
    const alvo = svg.current;
    if (!alvo) return;
    const aoRolar = (evento: WheelEvent) => {
      evento.preventDefault();
      interagiu.current = true;
      const retang = alvo.getBoundingClientRect();
      setVista((atual) => {
        const c = { x: atual.x + (evento.clientX - retang.left) * atual.escala, y: atual.y + (evento.clientY - retang.top) * atual.escala };
        const escala = Math.min(200, Math.max(1, atual.escala * (evento.deltaY > 0 ? 1.15 : 1 / 1.15)));
        return { escala, x: c.x - ((c.x - atual.x) * escala) / atual.escala, y: c.y - ((c.y - atual.y) * escala) / atual.escala };
      });
    };
    alvo.addEventListener("wheel", aoRolar, { passive: false });
    return () => alvo.removeEventListener("wheel", aoRolar);
  }, []);

  /** Ponto da parede sendo desenhada: ímã na ponta, depois alinhamento a 0°/90°, depois grade. */
  function pontoDaParede(bruto: Ponto, origem: Ponto | null, livre: boolean) {
    const ima = pontaProxima(doc, bruto, IMA * Math.max(1, vista.escala / 10));
    if (ima) return { ...ima };
    let p = { x: encaixe(bruto.x), y: encaixe(bruto.y) };
    if (origem && !livre) {
      const dx = p.x - origem.x, dy = p.y - origem.y;
      p = Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: origem.y } : { x: origem.x, y: p.y };
    }
    return p;
  }

  function aoPressionar(evento: ReactPointerEvent<SVGSVGElement>) {
    if (evento.button === 2) { setInicioParede(null); setRetangulo(null); return; }
    const p = paraPlanta(evento);
    const alvo = (evento.target as Element).closest("[data-tipo]") as HTMLElement | null;
    const tipo = alvo?.dataset.tipo, id = alvo?.dataset.id;
    svg.current?.focus({ preventScroll: true });

    if (!somenteLeitura && ferramenta === "parede") {
      const ponto = pontoDaParede(p, inicioParede, evento.shiftKey);
      if (!inicioParede) { setInicioParede(ponto); return; }
      if (Math.hypot(ponto.x - inicioParede.x, ponto.y - inicioParede.y) < 100) { setInicioParede(null); return; }
      const proximo = structuredClone(doc);
      adicionarParedes(proximo, [{ id: novoId("pa"), a: inicioParede, b: ponto, espessura: 150, altura: 2800 }]);
      alterar(proximo);
      // Continua do fim: paredes em sequência sem clicar duas vezes no mesmo canto.
      setInicioParede(ponto);
      return;
    }
    if (!somenteLeitura && ferramenta === "comodo") {
      const ponto = { x: encaixe(p.x), y: encaixe(p.y) };
      setRetangulo({ a: ponto, b: ponto });
      (evento.currentTarget as Element).setPointerCapture(evento.pointerId);
      return;
    }
    if (!somenteLeitura && ["porta", "janela", "portao", "vao"].includes(ferramenta)) {
      const abertura = abrirNoPonto(doc, p, ferramenta as TipoAbertura);
      if (!abertura) { avisar("Clique sobre uma parede."); return; }
      const proximo = structuredClone(doc);
      proximo.aberturas.push(abertura);
      alterar(proximo);
      selecionar({ tipo: "abertura", id: abertura.id });
      return;
    }

    // Selecionar e mover
    if (tipo === "ponta" && id && !somenteLeitura) {
      const [paredeId, ponta] = id.split(":") as [string, "a" | "b"];
      const parede = doc.paredes.find((item) => item.id === paredeId);
      if (parede) arraste.current = { tipo: "ponta", paredeId, ponta, original: { ...parede[ponta] } };
      (evento.currentTarget as Element).setPointerCapture(evento.pointerId);
      return;
    }
    if (tipo === "item" && id) {
      selecionar({ tipo: "item", id });
      const item = doc.itens.find((i) => i.id === id);
      if (item && !somenteLeitura) {
        arraste.current = { tipo: "item", id, dx: p.x - item.x, dy: p.y - item.y, moveu: false };
        (evento.currentTarget as Element).setPointerCapture(evento.pointerId);
      }
      return;
    }
    if ((tipo === "parede" || tipo === "abertura" || tipo === "comodo") && id) {
      selecionar({ tipo, id });
      if (tipo === "comodo") {
        arraste.current = { tipo: "pan", x: evento.clientX, y: evento.clientY, vx: vista.x, vy: vista.y };
        (evento.currentTarget as Element).setPointerCapture(evento.pointerId);
      }
      return;
    }
    selecionar(null);
    arraste.current = { tipo: "pan", x: evento.clientX, y: evento.clientY, vx: vista.x, vy: vista.y };
    (evento.currentTarget as Element).setPointerCapture(evento.pointerId);
  }

  function aoMover(evento: ReactPointerEvent<SVGSVGElement>) {
    const p = paraPlanta(evento);
    if (ferramenta === "parede") setCursor(pontoDaParede(p, inicioParede, evento.shiftKey));
    else setCursor({ x: encaixe(p.x), y: encaixe(p.y) });
    if (retangulo) { setRetangulo({ a: retangulo.a, b: { x: encaixe(p.x), y: encaixe(p.y) } }); return; }
    const atual = arraste.current;
    if (!atual) return;
    if (atual.tipo === "pan") {
      interagiu.current = true;
      setVista((v) => ({ ...v, x: atual.vx - (evento.clientX - atual.x) * v.escala, y: atual.vy - (evento.clientY - atual.y) * v.escala }));
    } else if (atual.tipo === "item") {
      const proximo = structuredClone(doc);
      const item = proximo.itens.find((i) => i.id === atual.id);
      if (!item) return;
      const x = encaixe(p.x - atual.dx), y = encaixe(p.y - atual.dy);
      if (x === item.x && y === item.y) return;
      item.x = x; item.y = y; atual.moveu = true;
      alterar(proximo, { agrupar: `mover:${atual.id}` });
    } else if (atual.tipo === "ponta") {
      const destino = pontoDaParede(p, null, true);
      const proximo = structuredClone(doc);
      // A ponta arrasta junto tudo o que estava no mesmo canto: paredes e cantos dos cômodos.
      for (const parede of proximo.paredes) for (const lado of ["a", "b"] as const) {
        if (Math.hypot(parede[lado].x - atual.original.x, parede[lado].y - atual.original.y) < 1) parede[lado] = { ...destino };
      }
      for (const comodo of proximo.comodos) comodo.pontos = comodo.pontos.map((pt) => Math.hypot(pt.x - atual.original.x, pt.y - atual.original.y) < 1 ? { ...destino } : pt);
      atual.original = { ...destino };
      // Aberturas que ficaram maiores que a parede encurtada são ajustadas para caber.
      for (const abertura of proximo.aberturas) {
        const parede = proximo.paredes.find((pa) => pa.id === abertura.paredeId);
        if (!parede) continue;
        const comprimento = comprimentoDaParede(parede);
        abertura.largura = Math.min(abertura.largura, Math.max(300, comprimento));
        abertura.posicao = Math.min(Math.max(abertura.posicao, abertura.largura / 2), Math.max(abertura.largura / 2, comprimento - abertura.largura / 2));
      }
      proximo.aberturas = proximo.aberturas.filter((abertura) => {
        const parede = proximo.paredes.find((pa) => pa.id === abertura.paredeId);
        return parede && comprimentoDaParede(parede) >= abertura.largura;
      });
      alterar(proximo, { agrupar: `ponta:${atual.paredeId}` });
    }
  }

  function aoSoltar() {
    if (retangulo) {
      const { a, b } = retangulo;
      setRetangulo(null);
      if (Math.abs(b.x - a.x) >= 500 && Math.abs(b.y - a.y) >= 500) {
        const proximo = structuredClone(doc);
        const novo = comodoRetangular(a.x, a.y, b.x, b.y, { nome: `Cômodo ${proximo.comodos.length + 1}` });
        adicionarParedes(proximo, novo.paredes);
        proximo.comodos.push(novo.comodo);
        alterar(proximo);
        selecionar({ tipo: "comodo", id: novo.comodo.id });
      } else avisar("Arraste um retângulo de pelo menos 0,5 × 0,5 m.");
    }
    arraste.current = null;
  }

  function aoSoltarArquivo(evento: React.DragEvent<SVGSVGElement>) {
    const catalogo = evento.dataTransfer.getData("application/x-hoikos-item");
    if (!catalogo || somenteLeitura) return;
    evento.preventDefault();
    const p = paraPlanta(evento);
    const proximo = structuredClone(doc);
    const item = itemNovo(catalogo, encaixe(p.x), encaixe(p.y));
    proximo.itens.push(item);
    alterar(proximo);
    selecionar({ tipo: "item", id: item.id });
    setFerramenta("selecionar");
  }

  const px = vista.escala; // 1 pixel de tela em mm
  const viewBox = `${vista.x} ${vista.y} ${tamanho.w * vista.escala} ${tamanho.h * vista.escala}`;
  const paredeSelecionada = selecao?.tipo === "parede" ? doc.paredes.find((p) => p.id === selecao.id) : null;
  const grade = useMemo(() => {
    const passo = vista.escala > 40 ? 5000 : vista.escala > 12 ? 1000 : 500;
    return passo;
  }, [vista.escala]);

  return <div className="relative h-full min-h-0 flex-1" ref={caixa}>
    <svg ref={svg} viewBox={viewBox} width="100%" height="100%" tabIndex={0} role="application" aria-label="Planta do layout. Use a barra de ferramentas para desenhar; Delete apaga, R gira e as setas movem o item selecionado."
      className={`block touch-none select-none bg-[#f7f5ef] outline-none ${ferramenta === "selecionar" ? "cursor-default" : "cursor-crosshair"}`}
      onPointerDown={aoPressionar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar} onPointerLeave={() => setCursor(null)}
      onDoubleClick={() => setInicioParede(null)} onContextMenu={(evento) => { evento.preventDefault(); setInicioParede(null); }}
      onDragOver={(evento) => { if (evento.dataTransfer.types.includes("application/x-hoikos-item")) evento.preventDefault(); }} onDrop={aoSoltarArquivo}>
      <defs>
        <pattern id="grade" width={grade} height={grade} patternUnits="userSpaceOnUse"><path d={`M ${grade} 0 L 0 0 0 ${grade}`} fill="none" stroke="#e3ded2" vectorEffect="non-scaling-stroke" /></pattern>
        <pattern id="piso-madeira" width={1200} height={150} patternUnits="userSpaceOnUse"><rect width={1200} height={150} fill={corDoPiso.madeira} /><path d="M 0 0 H 1200 M 700 0 V 150" stroke={tom(corDoPiso.madeira, 0.8)} vectorEffect="non-scaling-stroke" /></pattern>
        <pattern id="piso-deck" width={1000} height={140} patternUnits="userSpaceOnUse"><rect width={1000} height={140} fill={corDoPiso.deck} /><path d="M 0 0 H 1000" stroke={tom(corDoPiso.deck, 0.7)} vectorEffect="non-scaling-stroke" /></pattern>
        {(["porcelanato", "ceramica", "pedra"] as const).map((piso) => { const lado = piso === "porcelanato" ? 600 : piso === "ceramica" ? 300 : 400; return <pattern key={piso} id={`piso-${piso}`} width={lado} height={lado} patternUnits="userSpaceOnUse"><rect width={lado} height={lado} fill={corDoPiso[piso]} /><path d={`M ${lado} 0 L 0 0 0 ${lado}`} fill="none" stroke={tom(corDoPiso[piso], 0.85)} vectorEffect="non-scaling-stroke" /></pattern>; })}
      </defs>
      <rect data-overlay="grade" x={vista.x} y={vista.y} width={tamanho.w * vista.escala} height={tamanho.h * vista.escala} fill="url(#grade)" />

      {doc.comodos.map((comodo) => {
        const selecionado = selecao?.tipo === "comodo" && selecao.id === comodo.id;
        const preenchimento = ["madeira", "deck", "porcelanato", "ceramica", "pedra"].includes(comodo.piso) ? `url(#piso-${comodo.piso})` : corDoPiso[comodo.piso];
        return <polygon key={comodo.id} data-tipo="comodo" data-id={comodo.id} points={comodo.pontos.map((p) => `${p.x},${p.y}`).join(" ")} fill={preenchimento}
          stroke={selecionado ? "#c98a1b" : "none"} strokeWidth={selecionado ? 3 : 0} vectorEffect="non-scaling-stroke" />;
      })}

      {doc.itens.map((item) => {
        const base = itemDoCatalogo(item.catalogo);
        if (!base) return null;
        const selecionado = selecao?.tipo === "item" && selecao.id === item.id;
        const abaixo = ["tapete", "vaga", "piscina"].includes(base.forma);
        if (!abaixo) return null;
        return <g key={item.id} data-tipo="item" data-id={item.id} transform={`translate(${item.x} ${item.y}) rotate(${item.rotacao})`} style={{ cursor: somenteLeitura ? "default" : "move" }}>
          <SimboloItem forma={base.forma} variante={base.variante} w={item.largura} d={item.profundidade} cor={item.cor} />
          {selecionado ? <rect data-overlay="sel" x={-item.largura / 2 - 40} y={-item.profundidade / 2 - 40} width={item.largura + 80} height={item.profundidade + 80} fill="none" stroke="#c98a1b" strokeDasharray="8 5" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
        </g>;
      })}

      {doc.paredes.map((parede) => {
        const selecionada = selecao?.tipo === "parede" && selecao.id === parede.id;
        return <polygon key={parede.id} data-tipo="parede" data-id={parede.id} points={cantosDaParede(parede)} fill={selecionada ? "#7a5a2b" : "#3d3a36"} stroke="#3d3a36" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
      })}

      {doc.aberturas.map((abertura) => {
        const parede = doc.paredes.find((p) => p.id === abertura.paredeId);
        if (!parede) return null;
        const comprimento = comprimentoDaParede(parede) || 1;
        const ux = (parede.b.x - parede.a.x) / comprimento, uy = (parede.b.y - parede.a.y) / comprimento;
        const centro = pontoNaParede(parede, abertura.posicao);
        const angulo = (Math.atan2(uy, ux) * 180) / Math.PI;
        const w = abertura.largura, t = parede.espessura;
        const selecionada = selecao?.tipo === "abertura" && selecao.id === abertura.id;
        const lado = abertura.inverter ? -1 : 1;
        return <g key={abertura.id} data-tipo="abertura" data-id={abertura.id} transform={`translate(${centro.x} ${centro.y}) rotate(${angulo})`}>
          <rect x={-w / 2} y={-t / 2 - 5} width={w} height={t + 10} fill="#f7f5ef" stroke="none" />
          {abertura.tipo === "porta" ? <>
            <line x1={-w / 2} y1={0} x2={-w / 2} y2={lado * w} stroke="#3d3a36" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <path d={`M ${-w / 2} ${lado * w} A ${w} ${w} 0 0 ${lado > 0 ? 0 : 1} ${w / 2} 0`} fill="none" stroke="#8c8577" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          </> : abertura.tipo === "janela" ? <>
            <rect x={-w / 2} y={-t / 2} width={w} height={t} fill="#ffffff" stroke="#3d3a36" vectorEffect="non-scaling-stroke" />
            <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke="#5f93aa" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </> : abertura.tipo === "portao" ? <>
            <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke="#3d3a36" strokeDasharray="12 6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </> : null}
          <rect x={-w / 2} y={-t / 2 - 5} width={w} height={t + 10} fill="transparent" stroke={selecionada ? "#c98a1b" : "none"} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </g>;
      })}

      {doc.itens.map((item) => {
        const base = itemDoCatalogo(item.catalogo);
        if (!base || ["tapete", "vaga", "piscina"].includes(base.forma)) return null;
        const selecionado = selecao?.tipo === "item" && selecao.id === item.id;
        return <g key={item.id} data-tipo="item" data-id={item.id} transform={`translate(${item.x} ${item.y}) rotate(${item.rotacao})`} style={{ cursor: somenteLeitura ? "default" : "move" }}>
          <SimboloItem forma={base.forma} variante={base.variante} w={item.largura} d={item.profundidade} cor={item.cor} />
          {selecionado ? <rect data-overlay="sel" x={-item.largura / 2 - 40} y={-item.profundidade / 2 - 40} width={item.largura + 80} height={item.profundidade + 80} fill="none" stroke="#c98a1b" strokeDasharray="8 5" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
        </g>;
      })}

      {doc.comodos.map((comodo) => {
        const c = centroide(comodo.pontos);
        const fonte = Math.max(90, 13 * px);
        // Rótulo só onde cabe: afastado, cômodo pequeno fica sem texto em vez de embolar.
        const largura = Math.max(...comodo.pontos.map((p) => p.x)) - Math.min(...comodo.pontos.map((p) => p.x));
        const altura = Math.max(...comodo.pontos.map((p) => p.y)) - Math.min(...comodo.pontos.map((p) => p.y));
        const cabeNome = largura > fonte * 0.62 * Math.max(comodo.nome.length, 4) && altura > fonte * 1.5;
        const cabeArea = largura > fonte * 0.55 * 20 && altura > fonte * 3;
        // Escondido só na tela; a planta exportada, maior, mostra todos (ver exportar.ts).
        return <g key={`r-${comodo.id}`} pointerEvents="none" data-rotulo="" visibility={cabeNome ? undefined : "hidden"}>
          {comodo.nome ? <text x={c.x} y={c.y} textAnchor="middle" fontSize={fonte} fontWeight={600} fill="#2d2a25" stroke="#f7f5ef" strokeWidth={fonte * 0.18} paintOrder="stroke">{comodo.nome}</text> : null}
          <text data-rotulo-area="" visibility={cabeArea ? undefined : "hidden"} x={c.x} y={c.y + fonte * 1.25} textAnchor="middle" fontSize={fonte * 0.85} fill="#4d473d" stroke="#f7f5ef" strokeWidth={fonte * 0.15} paintOrder="stroke">{areaM2(comodo.pontos).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m² · {pisoLabels[comodo.piso]}</text>
        </g>;
      })}

      {paredeSelecionada && !somenteLeitura ? <g data-overlay="sel">
        {(["a", "b"] as const).map((ponta) => <circle key={ponta} data-tipo="ponta" data-id={`${paredeSelecionada.id}:${ponta}`} cx={paredeSelecionada[ponta].x} cy={paredeSelecionada[ponta].y} r={9 * px} fill="#ffffff" stroke="#c98a1b" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: "grab" }} />)}
        <text x={(paredeSelecionada.a.x + paredeSelecionada.b.x) / 2} y={(paredeSelecionada.a.y + paredeSelecionada.b.y) / 2 - 16 * px} textAnchor="middle" fontSize={13 * px} fill="#7a5a2b" pointerEvents="none">{medida(comprimentoDaParede(paredeSelecionada))}</text>
      </g> : null}

      {ferramenta === "parede" && inicioParede && cursor ? <g data-overlay="sel" pointerEvents="none">
        <line x1={inicioParede.x} y1={inicioParede.y} x2={cursor.x} y2={cursor.y} stroke="#c98a1b" strokeWidth={150} strokeOpacity={0.45} />
        <text x={(inicioParede.x + cursor.x) / 2} y={(inicioParede.y + cursor.y) / 2 - 14 * px} textAnchor="middle" fontSize={13 * px} fill="#7a5a2b">{medida(Math.hypot(cursor.x - inicioParede.x, cursor.y - inicioParede.y))}</text>
      </g> : null}
      {ferramenta === "parede" && cursor ? <circle data-overlay="sel" cx={cursor.x} cy={cursor.y} r={5 * px} fill="#c98a1b" pointerEvents="none" /> : null}
      {retangulo ? <g data-overlay="sel" pointerEvents="none">
        <rect x={Math.min(retangulo.a.x, retangulo.b.x)} y={Math.min(retangulo.a.y, retangulo.b.y)} width={Math.abs(retangulo.b.x - retangulo.a.x)} height={Math.abs(retangulo.b.y - retangulo.a.y)} fill="#c98a1b" fillOpacity={0.12} stroke="#c98a1b" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <text x={(retangulo.a.x + retangulo.b.x) / 2} y={(retangulo.a.y + retangulo.b.y) / 2} textAnchor="middle" fontSize={13 * px} fill="#7a5a2b">{medida(Math.abs(retangulo.b.x - retangulo.a.x))} × {medida(Math.abs(retangulo.b.y - retangulo.a.y))}</text>
      </g> : null}
    </svg>
    <div className="absolute bottom-2 right-2 flex gap-1 rounded-md bg-white/90 p-1 shadow">
      <Button size="icon" variant="ghost" className="size-8" onClick={() => zoom(1 / 1.3)} aria-label="Aproximar"><Plus /></Button>
      <Button size="icon" variant="ghost" className="size-8" onClick={() => zoom(1.3)} aria-label="Afastar"><Minus /></Button>
      <Button size="icon" variant="ghost" className="size-8" onClick={enquadrar} aria-label="Enquadrar tudo"><Scan /></Button>
    </div>
    {ferramenta === "parede" ? <p className="pointer-events-none absolute left-2 top-2 rounded bg-white/90 px-2 py-1 text-xs text-hoikos-700 shadow">{inicioParede ? "Clique para o próximo canto · duplo clique ou Esc termina · Shift desliga o esquadro" : "Clique no primeiro canto da parede"}</p> : null}
    {ferramenta === "comodo" ? <p className="pointer-events-none absolute left-2 top-2 rounded bg-white/90 px-2 py-1 text-xs text-hoikos-700 shadow">Arraste um retângulo: paredes e piso saem juntos</p> : null}
    {["porta", "janela", "portao", "vao"].includes(ferramenta) ? <p className="pointer-events-none absolute left-2 top-2 rounded bg-white/90 px-2 py-1 text-xs text-hoikos-700 shadow">Clique sobre uma parede</p> : null}
  </div>;
});
