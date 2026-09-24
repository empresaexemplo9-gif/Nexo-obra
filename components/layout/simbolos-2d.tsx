import type { ReactNode } from "react";

import type { Forma } from "@/lib/layout-catalogo";

// Símbolos da planta humanizada, vistos de cima e na medida do item. Coordenadas locais
// em milímetro com o centro na origem; o fundo do item fica em −Y e a frente em +Y.
// Traço de espessura fixa na tela (non-scaling-stroke), como numa planta impressa.

export function tom(hex: string, fator: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  const canal = (c: number) => Math.max(0, Math.min(255, Math.round(fator >= 1 ? c + (255 - c) * (fator - 1) : c * fator)));
  return `#${[canal(n >> 16), canal((n >> 8) & 255), canal(n & 255)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const TRACO = "#3b342b";
const VIDRO = "#6f8795";
const PNEU = "#1d1d1d";

function R({ x, y, w, h, fill, rx = 0, stroke = TRACO, dash, opacity }: { x: number; y: number; w: number; h: number; fill: string; rx?: number; stroke?: string; dash?: string; opacity?: number }) {
  return <rect x={x} y={y} width={Math.max(w, 1)} height={Math.max(h, 1)} rx={rx} fill={fill} stroke={stroke} strokeDasharray={dash} opacity={opacity} vectorEffect="non-scaling-stroke" />;
}
function C({ x, y, r, fill, stroke = TRACO }: { x: number; y: number; r: number; fill: string; stroke?: string }) {
  return <circle cx={x} cy={y} r={Math.max(r, 1)} fill={fill} stroke={stroke} vectorEffect="non-scaling-stroke" />;
}
function L({ x1, y1, x2, y2, stroke = TRACO, dash }: { x1: number; y1: number; x2: number; y2: number; stroke?: string; dash?: string }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />;
}
function P({ d, fill, stroke = TRACO }: { d: string; fill: string; stroke?: string }) {
  return <path d={d} fill={fill} stroke={stroke} vectorEffect="non-scaling-stroke" />;
}

function cadeiraEm(x: number, y: number, giro: number, cor: string, key: string) {
  return <g key={key} transform={`translate(${x} ${y}) rotate(${giro})`}><R x={-225} y={-225} w={450} h={450} rx={60} fill={tom(cor, 1.25)} /><R x={-225} y={-250} w={450} h={70} rx={20} fill={tom(cor, 0.8)} /></g>;
}

export function SimboloItem({ forma, variante, w, d, cor }: { forma: Forma; variante?: string; w: number; d: number; cor: string }): ReactNode {
  const x0 = -w / 2, y0 = -d / 2;
  const escuro = tom(cor, 0.72), claro = tom(cor, 1.25);
  switch (forma) {
    case "sofa": case "poltrona": {
      const lugares = forma === "poltrona" ? 1 : Number(variante ?? 3);
      const braco = Math.min(w * 0.12, 200), encosto = d * 0.24;
      const vao = (w - 2 * braco) / lugares;
      return <g>
        <R x={x0} y={y0} w={w} h={d} rx={80} fill={escuro} />
        {Array.from({ length: lugares }, (_, i) => <R key={i} x={x0 + braco + i * vao + 15} y={y0 + encosto} w={vao - 30} h={d - encosto - 40} rx={60} fill={claro} />)}
      </g>;
    }
    case "cama": {
      const travesseiros = variante === "solteiro" ? 1 : 2;
      const larguraT = (w - 120 - (travesseiros - 1) * 60) / travesseiros;
      return <g>
        <R x={x0} y={y0} w={w} h={d} rx={30} fill="#8a6a4f" />
        <R x={x0 + 40} y={y0 + 80} w={w - 80} h={d - 120} rx={40} fill="#f7f4ee" />
        {Array.from({ length: travesseiros }, (_, i) => <R key={i} x={x0 + 60 + i * (larguraT + 60)} y={y0 + 130} w={larguraT} h={Math.min(380, d * 0.2)} rx={80} fill="#ffffff" />)}
        <R x={x0 + 40} y={y0 + d * 0.38} w={w - 80} h={d * 0.62 - 40} rx={30} fill={cor} />
        <L x1={x0 + 40} y1={y0 + d * 0.38 + 140} x2={x0 + w - 40} y2={y0 + d * 0.38 + 140} />
      </g>;
    }
    case "berco":
      return <g><R x={x0} y={y0} w={w} h={d} fill="#ffffff" /><R x={x0 + 50} y={y0 + 50} w={w - 100} h={d - 100} fill={cor} />
        {Array.from({ length: 9 }, (_, i) => <L key={i} x1={x0} y1={y0 + (i + 1) * d / 10} x2={x0 + 50} y2={y0 + (i + 1) * d / 10} />)}</g>;
    case "criado":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><L x1={x0} y1={y0 + d * 0.75} x2={x0 + w} y2={y0 + d * 0.75} /><C x={0} y={y0 + d * 0.88} r={20} fill={escuro} /></g>;
    case "guarda-roupa": case "armario": case "estante": {
      const portas = Math.max(1, Math.round(w / (forma === "estante" ? 400 : 500)));
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} />
        {Array.from({ length: portas - 1 }, (_, i) => <L key={i} x1={x0 + (i + 1) * w / portas} y1={y0} x2={x0 + (i + 1) * w / portas} y2={y0 + d} />)}
        {forma !== "estante" ? <L x1={x0} y1={y0 + d - 40} x2={x0 + w} y2={y0 + d - 40} /> : null}</g>;
    }
    case "armario-aereo":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} dash="60 40" opacity={0.55} /><L x1={x0} y1={y0} x2={x0 + w} y2={y0 + d} dash="60 40" /><L x1={x0 + w} y1={y0} x2={x0} y2={y0 + d} dash="60 40" /></g>;
    case "mesa": {
      const lugares = Number(variante ?? 4), porLado = Math.max(1, Math.floor(lugares / 2) - (lugares >= 6 ? 0 : 0));
      const lado = lugares >= 6 ? Math.floor((lugares - 2) / 2) : porLado;
      const cadeiras: ReactNode[] = [];
      for (let i = 0; i < lado; i += 1) {
        const x = x0 + (i + 0.5) * (w / lado);
        cadeiras.push(cadeiraEm(x, y0 - 230, 0, cor, `t${i}`), cadeiraEm(x, y0 + d + 230, 180, cor, `b${i}`));
      }
      if (lugares >= 6) cadeiras.push(cadeiraEm(x0 - 230, 0, 270, cor, "l"), cadeiraEm(x0 + w + 230, 0, 90, cor, "r"));
      return <g>{cadeiras}<R x={x0} y={y0} w={w} h={d} rx={20} fill={cor} /><R x={x0 + 40} y={y0 + 40} w={w - 80} h={d - 80} rx={15} fill={claro} stroke="none" /></g>;
    }
    case "mesa-redonda": {
      const r = Math.min(w, d) / 2;
      return <g>{[0, 90, 180, 270].map((giro) => { const rad = (giro - 90) * Math.PI / 180; return cadeiraEm(Math.cos(rad) * (r + 230), Math.sin(rad) * (r + 230), giro, cor, String(giro)); })}<C x={0} y={0} r={r} fill={cor} /><C x={0} y={0} r={r - 40} fill={claro} stroke="none" /></g>;
    }
    case "mesa-centro":
      return <g><R x={x0} y={y0} w={w} h={d} rx={60} fill={cor} /><R x={x0 + 50} y={y0 + 50} w={w - 100} h={d - 100} rx={40} fill={claro} /></g>;
    case "cadeira":
      return <g><R x={x0} y={y0} w={w} h={d} rx={60} fill={claro} /><R x={x0} y={y0} w={w} h={d * 0.16} rx={20} fill={escuro} /></g>;
    case "rack-tv":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><R x={-w * 0.35} y={y0 + 40} w={w * 0.7} h={70} fill="#111111" /><R x={-60} y={y0 + 110} w={120} h={90} fill="#2a2a2a" /></g>;
    case "tapete":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} stroke="none" /><R x={x0 + 120} y={y0 + 120} w={w - 240} h={d - 240} fill="none" stroke={escuro} dash="40 30" /></g>;
    case "escrivaninha":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><R x={-260} y={y0 + 60} w={520} h={50} fill="#1c1c1c" /><R x={-200} y={y0 + d * 0.45} w={400} h={140} fill="#d9d9d9" /></g>;
    case "cadeira-escritorio":
      return <g><C x={0} y={0} r={Math.min(w, d) / 2} fill={tom(cor, 1.6)} /><C x={0} y={40} r={Math.min(w, d) * 0.34} fill={cor} /><R x={-w * 0.32} y={y0 + 20} w={w * 0.64} h={110} rx={50} fill={escuro} /></g>;
    case "geladeira":
      return <g><R x={x0} y={y0} w={w} h={d} rx={20} fill={cor} /><L x1={x0} y1={y0 + d - 60} x2={x0 + w} y2={y0 + d - 60} />
        {variante === "side" ? <L x1={0} y1={y0} x2={0} y2={y0 + d} /> : null}<R x={x0 + w * 0.15} y={y0 + d - 50} w={w * 0.7} h={25} fill={tom(cor, 0.6)} /></g>;
    case "fogao": {
      const bocas = Number(variante ?? 4), colunas = bocas === 6 ? 3 : 2;
      const r = Math.min(w / colunas, (d - 120) / 2) * 0.3;
      return <g><R x={x0} y={y0} w={w} h={d} rx={20} fill={cor} /><R x={x0 + 30} y={y0 + 30} w={w - 60} h={d - 150} fill="#2b2b2b" />
        {Array.from({ length: bocas }, (_, i) => <C key={i} x={x0 + 30 + (w - 60) * ((i % colunas) + 0.5) / colunas} y={y0 + 30 + (d - 150) * (Math.floor(i / colunas) + 0.5) / 2} r={r} fill="#555555" stroke="#888888" />)}
        {Array.from({ length: bocas }, (_, i) => <C key={`k${i}`} x={x0 + w * (i + 0.5) / bocas} y={y0 + d - 60} r={22} fill="#999999" />)}</g>;
    }
    case "cooktop":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><R x={-400} y={y0 + 60} w={800} h={d - 140} rx={20} fill="#1d1d1d" />
        {[[-250, -0.22], [250, -0.22], [0, 0], [-250, 0.22], [250, 0.22]].map(([x, fy], i) => <C key={i} x={x} y={y0 + d / 2 - 10 + fy * d} r={i === 2 ? 110 : 80} fill="#3a3a3a" stroke="#777777" />)}</g>;
    case "bancada-pia":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><R x={-300} y={y0 + 110} w={600} h={d - 200} rx={60} fill="#c7cbcd" /><C x={0} y={y0 + 60} r={30} fill="#9aa0a3" /></g>;
    case "micro-ondas":
      return <g><R x={x0} y={y0} w={w} h={d} rx={20} fill={cor} /><R x={x0 + 40} y={y0 + d - 90} w={w * 0.65} h={50} fill={VIDRO} /></g>;
    case "lava-loucas": case "tanque":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} />{forma === "tanque" ? <R x={x0 + 60} y={y0 + 80} w={w - 120} h={d - 140} rx={40} fill="#cfd3d4" /> : <L x1={x0} y1={y0 + d - 50} x2={x0 + w} y2={y0 + d - 50} />}</g>;
    case "maquina-lavar":
      return <g><R x={x0} y={y0} w={w} h={d} rx={20} fill={cor} /><C x={0} y={30} r={Math.min(w, d) * 0.33} fill="#c9d3d8" /><R x={x0 + 40} y={y0 + 30} w={w - 80} h={70} fill="#dddddd" /></g>;
    case "vaso":
      return <g><R x={x0} y={y0} w={w} h={d * 0.28} rx={30} fill={cor} /><ellipse cx={0} cy={y0 + d * 0.62} rx={w * 0.46} ry={d * 0.36} fill={cor} stroke={TRACO} vectorEffect="non-scaling-stroke" /><ellipse cx={0} cy={y0 + d * 0.64} rx={w * 0.3} ry={d * 0.24} fill="#dfe8ea" stroke={TRACO} vectorEffect="non-scaling-stroke" /></g>;
    case "lavatorio":
      return <g><R x={x0} y={y0} w={w} h={d} fill={tom("#8a6a4f", 1.1)} /><ellipse cx={0} cy={20} rx={w * 0.3} ry={d * 0.3} fill={cor} stroke={TRACO} vectorEffect="non-scaling-stroke" /><C x={0} y={y0 + 70} r={25} fill="#9aa0a3" /></g>;
    case "box":
      return <g><R x={x0} y={y0} w={w} h={d} fill={tom(cor, 1.3)} /><L x1={x0} y1={y0} x2={x0 + w} y2={y0 + d} stroke={tom(cor, 0.7)} /><L x1={x0 + w} y1={y0} x2={x0} y2={y0 + d} stroke={tom(cor, 0.7)} /><C x={0} y={0} r={50} fill="#9aa0a3" /><L x1={x0} y1={y0 + d} x2={x0 + w} y2={y0 + d} stroke={VIDRO} /></g>;
    case "banheira":
      return <g><R x={x0} y={y0} w={w} h={d} rx={120} fill={cor} /><R x={x0 + 70} y={y0 + 70} w={w - 140} h={d - 140} rx={160} fill="#bfe0ea" /></g>;
    case "carro": {
      const picape = variante === "picape";
      const vidroF = y0 + d * (picape ? 0.62 : 0.6), tetoF = y0 + d * (picape ? 0.44 : 0.36);
      const tetoT = picape ? y0 + d * 0.36 : y0 + d * (variante === "hatch" ? 0.12 : 0.2);
      return <g>
        {[[x0 - 30, y0 + d * 0.13], [x0 + w - 150, y0 + d * 0.13], [x0 - 30, y0 + d * 0.72], [x0 + w - 150, y0 + d * 0.72]].map(([x, y], i) => <R key={i} x={x} y={y} w={180} h={d * 0.15} rx={40} fill={PNEU} stroke="none" />)}
        <R x={x0} y={y0} w={w} h={d} rx={w * 0.22} fill={cor} />
        <P d={`M ${x0 + w * 0.14} ${vidroF} L ${x0 + w * 0.86} ${vidroF} L ${x0 + w * 0.8} ${tetoF} L ${x0 + w * 0.2} ${tetoF} Z`} fill={VIDRO} />
        <R x={x0 + w * 0.2} y={tetoT} w={w * 0.6} h={tetoF - tetoT} rx={60} fill={tom(cor, 0.88)} />
        {picape ? <><R x={x0 + w * 0.08} y={y0 + 80} w={w * 0.84} h={d * 0.26} rx={30} fill={tom(cor, 0.6)} /><L x1={x0 + w * 0.08} y1={y0 + d * 0.2} x2={x0 + w * 0.92} y2={y0 + d * 0.2} /></>
          : <P d={`M ${x0 + w * 0.2} ${tetoT} L ${x0 + w * 0.8} ${tetoT} L ${x0 + w * 0.84} ${tetoT - d * 0.07} L ${x0 + w * 0.16} ${tetoT - d * 0.07} Z`} fill={VIDRO} />}
        <R x={x0 - 90} y={vidroF - 60} w={100} h={140} rx={30} fill={cor} /><R x={x0 + w - 10} y={vidroF - 60} w={100} h={140} rx={30} fill={cor} />
        <R x={x0 + w * 0.1} y={y0 + d - 50} w={w * 0.22} h={40} rx={15} fill="#fff4c2" /><R x={x0 + w * 0.68} y={y0 + d - 50} w={w * 0.22} h={40} rx={15} fill="#fff4c2" />
      </g>;
    }
    case "moto":
      return <g><R x={-w * 0.12} y={y0} w={w * 0.24} h={d * 0.24} rx={60} fill={PNEU} stroke="none" /><R x={-w * 0.12} y={y0 + d * 0.76} w={w * 0.24} h={d * 0.24} rx={60} fill={PNEU} stroke="none" />
        <R x={-w * 0.2} y={y0 + d * 0.18} w={w * 0.4} h={d * 0.6} rx={120} fill={cor} /><R x={-w * 0.14} y={y0 + d * 0.3} w={w * 0.28} h={d * 0.28} rx={80} fill="#3a3a3a" />
        <L x1={x0} y1={y0 + d * 0.74} x2={x0 + w} y2={y0 + d * 0.74} /></g>;
    case "bicicleta":
      return <g><ellipse cx={0} cy={y0 + d * 0.2} rx={30} ry={d * 0.2} fill="none" stroke={PNEU} vectorEffect="non-scaling-stroke" /><ellipse cx={0} cy={y0 + d * 0.8} rx={30} ry={d * 0.2} fill="none" stroke={PNEU} vectorEffect="non-scaling-stroke" />
        <L x1={0} y1={y0 + d * 0.2} x2={0} y2={y0 + d * 0.8} stroke={cor} /><L x1={x0} y1={y0 + d * 0.78} x2={x0 + w} y2={y0 + d * 0.78} stroke={cor} /><R x={-50} y={y0 + d * 0.35} w={100} h={180} rx={40} fill="#222222" /></g>;
    case "vaga":
      return <g><R x={x0} y={y0} w={w} h={d} fill="none" stroke="#f5f1e0" /><R x={x0 + 20} y={y0 + 20} w={w - 40} h={d - 40} fill="none" stroke="#c8c2ad" dash="120 80" /></g>;
    case "arvore": {
      const r = Math.min(w, d) / 2;
      return <g opacity={0.92}>{[[0, 0, 1], [-0.35, -0.3, 0.6], [0.4, -0.2, 0.55], [0.3, 0.38, 0.6], [-0.38, 0.3, 0.55]].map(([x, y, k], i) => <C key={i} x={x * r} y={y * r} r={r * k} fill={i === 0 ? cor : tom(cor, 1 + i * 0.05)} stroke={tom(cor, 0.6)} />)}<C x={0} y={0} r={r * 0.12} fill="#6b4a2b" /></g>;
    }
    case "planta":
      return <g><C x={0} y={0} r={Math.min(w, d) / 2} fill="#8d6e53" /><C x={0} y={0} r={Math.min(w, d) * 0.42} fill={cor} /><C x={-w * 0.1} y={-d * 0.1} r={Math.min(w, d) * 0.18} fill={tom(cor, 1.25)} /></g>;
    case "piscina":
      return <g><R x={x0} y={y0} w={w} h={d} rx={200} fill="#ded6c6" /><R x={x0 + 250} y={y0 + 250} w={w - 500} h={d - 500} rx={140} fill={cor} /><R x={x0 + 450} y={y0 + 450} w={w - 900} h={d - 900} rx={100} fill={tom(cor, 1.2)} stroke="none" /></g>;
    case "espreguicadeira":
      return <g><R x={x0} y={y0} w={w} h={d} rx={60} fill={cor} /><R x={x0 + 40} y={y0 + 40} w={w - 80} h={d * 0.32} rx={40} fill={tom(cor, 0.85)} />
        {Array.from({ length: 6 }, (_, i) => <L key={i} x1={x0 + 40} y1={y0 + d * 0.4 + i * d * 0.09} x2={x0 + w - 40} y2={y0 + d * 0.4 + i * d * 0.09} stroke={tom(cor, 0.7)} />)}</g>;
    case "churrasqueira":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><R x={x0 + 80} y={y0 + 80} w={w - 160} h={d - 180} fill="#2a2a2a" />{Array.from({ length: 6 }, (_, i) => <L key={i} x1={x0 + 80 + (i + 1) * (w - 160) / 7} y1={y0 + 80} x2={x0 + 80 + (i + 1) * (w - 160) / 7} y2={y0 + d - 100} stroke="#777777" />)}</g>;
    default:
      return <R x={x0} y={y0} w={w} h={d} fill={cor} />;
  }
}
