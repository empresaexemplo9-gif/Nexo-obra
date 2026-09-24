import type { ReactNode } from "react";

import { MADEIRA_TAMPO, type Forma, type Material } from "@/lib/layout-catalogo";

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


// Acabamentos vistos de cima. A cor-base de madeira e laca vem da peça (quem escolhe a
// cor do móvel escolhe o tom da madeira ou da laca); as pedras, o vidro e o metal têm cor
// própria. Os desenhos (veio, pontilhado, reflexo) ficam dentro da peça, sem clipPath,
// para a planta exportada não depender de identificadores.
const COR_MATERIAL: Record<Exclude<Material, "madeira" | "laca">, string> = {
  vidro: "#cfe6ee", marmore: "#f1eee9", granito: "#4a4744", quartzo: "#f4f2ee", metal: "#c3c7ca", concreto: "#a9a7a1",
};

export function corDoMaterial(material: Material | null | undefined, corBase: string) {
  if (!material || material === "madeira" || material === "laca") return corBase;
  return COR_MATERIAL[material];
}

function sorteio(semente: number) {
  let estado = Math.abs(Math.floor(semente)) % 2147483647 || 1;
  return () => { estado = (estado * 16807) % 2147483647; return (estado - 1) / 2147483646; };
}

/** Textura do acabamento dentro do retângulo (x, y, w, h). */
function Veios({ x, y, w, h, material, cor }: { x: number; y: number; w: number; h: number; material: Material; cor: string }) {
  if (w < 20 || h < 20) return null;
  const aleatorio = sorteio(w * 7 + h * 13);
  const itens: ReactNode[] = [];
  if (material === "madeira") {
    const aoLongo = w >= h, n = Math.max(2, Math.min(7, Math.round((aoLongo ? h : w) / 120)));
    for (let i = 1; i < n; i += 1) {
      const t = i / n + (aleatorio() - 0.5) * 0.08;
      itens.push(aoLongo
        ? <L key={i} x1={x + w * 0.04} y1={y + h * t} x2={x + w * (0.55 + aleatorio() * 0.41)} y2={y + h * t} stroke={tom(cor, 0.72)} />
        : <L key={i} x1={x + w * t} y1={y + h * 0.04} x2={x + w * t} y2={y + h * (0.55 + aleatorio() * 0.41)} stroke={tom(cor, 0.72)} />);
    }
  } else if (material === "marmore") {
    for (let i = 0; i < 3; i += 1) {
      const pontos = Array.from({ length: 5 }, (_, k) => [x + w * (k / 4), y + h * Math.min(0.95, Math.max(0.05, 0.2 + i * 0.3 + (aleatorio() - 0.5) * 0.35))]);
      itens.push(<polyline key={i} points={pontos.map((p) => p.join(",")).join(" ")} fill="none" stroke="#a9a49b" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />);
    }
  } else if (material === "granito" || material === "quartzo" || material === "concreto") {
    const n = Math.min(40, Math.max(6, Math.round((w * h) / 40_000)));
    const pinta = material === "granito" ? "#8d8780" : material === "quartzo" ? "#c9c4bb" : "#7f7d78";
    const r = Math.max(6, Math.min(w, h) * 0.012);
    for (let i = 0; i < n; i += 1) itens.push(<circle key={i} cx={x + r + aleatorio() * (w - 2 * r)} cy={y + r + aleatorio() * (h - 2 * r)} r={r} fill={pinta} />);
  } else if (material === "vidro") {
    itens.push(<L key="a" x1={x + w * 0.12} y1={y + h * 0.55} x2={x + w * 0.35} y2={y + h * 0.15} stroke="#ffffff" />);
    itens.push(<L key="b" x1={x + w * 0.2} y1={y + h * 0.7} x2={x + w * 0.45} y2={y + h * 0.25} stroke="#ffffff" />);
  } else if (material === "metal") {
    const n = Math.max(2, Math.min(6, Math.round(h / 150)));
    for (let i = 1; i < n; i += 1) itens.push(<L key={i} x1={x + w * 0.05} y1={y + (h * i) / n} x2={x + w * 0.95} y2={y + (h * i) / n} stroke="#e8eaeb" />);
  }
  return <g pointerEvents="none">{itens}</g>;
}

/** Superfície com acabamento: tampo de mesa, bancada, corpo de marcenaria. */
function Superficie({ x, y, w, h, material, cor, rx = 0 }: { x: number; y: number; w: number; h: number; material: Material | null | undefined; cor: string; rx?: number }) {
  const fundo = corDoMaterial(material, cor);
  return <g>
    <R x={x} y={y} w={w} h={h} rx={rx} fill={fundo} opacity={material === "vidro" ? 0.75 : undefined} />
    {material ? <Veios x={x + rx * 0.3} y={y + rx * 0.3} w={w - rx * 0.6} h={h - rx * 0.6} material={material} cor={fundo} /> : null}
  </g>;
}

/** Tampo redondo: o desenho do acabamento vai no quadrado inscrito. */
function SuperficieRedonda({ r, material, cor }: { r: number; material: Material | null | undefined; cor: string }) {
  const fundo = corDoMaterial(material, cor), lado = r * 1.3;
  return <g><circle cx={0} cy={0} r={Math.max(r, 1)} fill={fundo} stroke={TRACO} opacity={material === "vidro" ? 0.75 : undefined} vectorEffect="non-scaling-stroke" />
    {material ? <Veios x={-lado / 2} y={-lado / 2} w={lado} h={lado} material={material} cor={fundo} /> : null}</g>;
}

/** Hachura de alvenaria a 45°, calculada dentro do retângulo. */
function Hachura({ x, y, w, h, passo = 120, stroke = "#b9ae9c" }: { x: number; y: number; w: number; h: number; passo?: number; stroke?: string }) {
  const linhas: ReactNode[] = [];
  for (let k = passo; k < w + h; k += passo) {
    const x1 = x + Math.max(0, k - h), y1 = y + Math.min(h, k);
    const x2 = x + Math.min(w, k), y2 = y + Math.max(0, k - w);
    linhas.push(<L key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} />);
    if (linhas.length > 60) break;
  }
  return <g pointerEvents="none">{linhas}</g>;
}

function banquetaEm(x: number, y: number, cor: string, key: string) {
  return <g key={key}><C x={x} y={y} r={170} fill={tom(cor, 1.2)} /><C x={x} y={y} r={110} fill={cor} /></g>;
}

function cadeiraEm(x: number, y: number, giro: number, cor: string, key: string) {
  return <g key={key} transform={`translate(${x} ${y}) rotate(${giro})`}><R x={-225} y={-225} w={450} h={450} rx={60} fill={tom(cor, 1.25)} /><R x={-225} y={-250} w={450} h={70} rx={20} fill={tom(cor, 0.8)} /></g>;
}

export function SimboloItem({ forma, variante, w, d, cor, material }: { forma: Forma; variante?: string; w: number; d: number; cor: string; material?: Material | null }): ReactNode {
  const x0 = -w / 2, y0 = -d / 2;
  const escuro = tom(cor, 0.72), claro = tom(cor, 1.25);
  // Tampo de pedra ou madeira sobre corpo de outra cor: a madeira do tampo tem tom próprio.
  const baseTampo = material === "laca" ? cor : MADEIRA_TAMPO;
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
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={cor} /><L x1={x0} y1={y0 + d * 0.75} x2={x0 + w} y2={y0 + d * 0.75} /><C x={0} y={y0 + d * 0.88} r={20} fill={escuro} /></g>;
    case "guarda-roupa": case "armario": case "estante": {
      const portas = Math.max(1, Math.round(w / (forma === "estante" ? 400 : 500)));
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={forma === "armario" ? baseTampo : cor} />
        {Array.from({ length: portas - 1 }, (_, i) => <L key={i} x1={x0 + (i + 1) * w / portas} y1={y0} x2={x0 + (i + 1) * w / portas} y2={y0 + d} />)}
        {forma !== "estante" ? <L x1={x0} y1={y0 + d - 40} x2={x0 + w} y2={y0 + d - 40} /> : null}</g>;
    }
    case "armario-aereo":
      return <g><R x={x0} y={y0} w={w} h={d} fill={corDoMaterial(material, cor)} dash="60 40" opacity={0.55} /><L x1={x0} y1={y0} x2={x0 + w} y2={y0 + d} dash="60 40" /><L x1={x0 + w} y1={y0} x2={x0} y2={y0 + d} dash="60 40" /></g>;
    case "mesa": {
      const lugares = Number(variante ?? 4), porLado = Math.max(1, Math.floor(lugares / 2) - (lugares >= 6 ? 0 : 0));
      const lado = lugares >= 6 ? Math.floor((lugares - 2) / 2) : porLado;
      const cadeiras: ReactNode[] = [];
      for (let i = 0; i < lado; i += 1) {
        const x = x0 + (i + 0.5) * (w / lado);
        cadeiras.push(cadeiraEm(x, y0 - 230, 0, cor, `t${i}`), cadeiraEm(x, y0 + d + 230, 180, cor, `b${i}`));
      }
      if (lugares >= 6) cadeiras.push(cadeiraEm(x0 - 230, 0, 270, cor, "l"), cadeiraEm(x0 + w + 230, 0, 90, cor, "r"));
      return <g>{cadeiras}<Superficie x={x0} y={y0} w={w} h={d} rx={20} material={material} cor={cor} /></g>;
    }
    case "mesa-redonda": {
      const r = Math.min(w, d) / 2;
      return <g>{[0, 90, 180, 270].map((giro) => { const rad = (giro - 90) * Math.PI / 180; return cadeiraEm(Math.cos(rad) * (r + 230), Math.sin(rad) * (r + 230), giro, cor, String(giro)); })}<SuperficieRedonda r={r} material={material} cor={cor} /></g>;
    }
    case "mesa-centro":
      return w === d && w <= 700 ? <SuperficieRedonda r={w / 2} material={material} cor={cor} /> : <Superficie x={x0} y={y0} w={w} h={d} rx={60} material={material} cor={cor} />;
    case "cadeira":
      return <g><R x={x0} y={y0} w={w} h={d} rx={60} fill={claro} /><R x={x0} y={y0} w={w} h={d * 0.16} rx={20} fill={escuro} /></g>;
    case "rack-tv":
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={cor} /><R x={-w * 0.35} y={y0 + 40} w={w * 0.7} h={70} fill="#111111" /><R x={-60} y={y0 + 110} w={120} h={90} fill="#2a2a2a" /></g>;
    case "tapete":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} stroke="none" /><R x={x0 + 120} y={y0 + 120} w={w - 240} h={d - 240} fill="none" stroke={escuro} dash="40 30" /></g>;
    case "escrivaninha":
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={cor} /><R x={-260} y={y0 + 60} w={520} h={50} fill="#1c1c1c" /><R x={-200} y={y0 + d * 0.45} w={400} h={140} fill="#d9d9d9" /></g>;
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
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={baseTampo} /><R x={-400} y={y0 + 60} w={800} h={d - 140} rx={20} fill="#1d1d1d" />
        {[[-250, -0.22], [250, -0.22], [0, 0], [-250, 0.22], [250, 0.22]].map(([x, fy], i) => <C key={i} x={x} y={y0 + d / 2 - 10 + fy * d} r={i === 2 ? 110 : 80} fill="#3a3a3a" stroke="#777777" />)}</g>;
    case "bancada-pia": {
      const cubas = variante === "dupla" ? [-0.22 * w, 0.22 * w] : [0];
      const larguraCuba = Math.min(600, w / cubas.length - 150);
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={baseTampo} />
        {cubas.map((cx, i) => <g key={i}><R x={cx - larguraCuba / 2} y={y0 + 110} w={larguraCuba} h={d - 200} rx={60} fill="#c7cbcd" /><C x={cx} y={y0 + 60} r={30} fill="#9aa0a3" /></g>)}</g>;
    }
    case "micro-ondas":
      return <g><R x={x0} y={y0} w={w} h={d} rx={20} fill={cor} /><R x={x0 + 40} y={y0 + d - 90} w={w * 0.65} h={50} fill={VIDRO} /></g>;
    case "lava-loucas": case "tanque":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} />{forma === "tanque" ? <R x={x0 + 60} y={y0 + 80} w={w - 120} h={d - 140} rx={40} fill="#cfd3d4" /> : <L x1={x0} y1={y0 + d - 50} x2={x0 + w} y2={y0 + d - 50} />}</g>;
    case "maquina-lavar":
      return <g><R x={x0} y={y0} w={w} h={d} rx={20} fill={cor} /><C x={0} y={30} r={Math.min(w, d) * 0.33} fill="#c9d3d8" /><R x={x0 + 40} y={y0 + 30} w={w - 80} h={70} fill="#dddddd" /></g>;
    case "vaso":
      return <g><R x={x0} y={y0} w={w} h={d * 0.28} rx={30} fill={cor} /><ellipse cx={0} cy={y0 + d * 0.62} rx={w * 0.46} ry={d * 0.36} fill={cor} stroke={TRACO} vectorEffect="non-scaling-stroke" /><ellipse cx={0} cy={y0 + d * 0.64} rx={w * 0.3} ry={d * 0.24} fill="#dfe8ea" stroke={TRACO} vectorEffect="non-scaling-stroke" /></g>;
    case "lavatorio": {
      const cubas = variante === "dupla" ? [-0.25 * w, 0.25 * w] : [0];
      const rx = Math.min(w * 0.3, w / cubas.length * 0.3);
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={baseTampo} />
        {cubas.map((cx, i) => <g key={i}><ellipse cx={cx} cy={20} rx={rx} ry={d * 0.3} fill="#f7f7f5" stroke={TRACO} vectorEffect="non-scaling-stroke" /><C x={cx} y={y0 + 70} r={25} fill="#9aa0a3" /></g>)}</g>;
    }
    case "box":
      return <g><R x={x0} y={y0} w={w} h={d} fill={tom(cor, 1.3)} /><L x1={x0} y1={y0} x2={x0 + w} y2={y0 + d} stroke={tom(cor, 0.7)} /><L x1={x0 + w} y1={y0} x2={x0} y2={y0 + d} stroke={tom(cor, 0.7)} /><C x={0} y={0} r={50} fill="#9aa0a3" /><L x1={x0} y1={y0 + d} x2={x0 + w} y2={y0 + d} stroke={VIDRO} /></g>;
    case "banheira":
      return <g><R x={x0} y={y0} w={w} h={d} rx={120} fill={cor} /><R x={x0 + 70} y={y0 + 70} w={w - 140} h={d - 140} rx={160} fill="#bfe0ea" /></g>;
    case "carro": {
      const picape = variante === "picape";
      const van = variante === "van", esportivo = variante === "esportivo";
      const vidroF = y0 + d * (picape ? 0.62 : van ? 0.74 : esportivo ? 0.56 : 0.6), tetoF = y0 + d * (picape ? 0.44 : van ? 0.66 : esportivo ? 0.46 : 0.36);
      const tetoT = picape ? y0 + d * 0.36 : y0 + d * (variante === "hatch" || van ? 0.06 : esportivo ? 0.3 : 0.2);
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
      return <g><R x={x0} y={y0} w={w} h={d} fill="none" stroke="#f5f1e0" /><R x={x0 + 20} y={y0 + 20} w={w - 40} h={d - 40} fill="none" stroke="#c8c2ad" dash="120 80" />
        {variante === "2" ? <L x1={0} y1={y0 + 20} x2={0} y2={y0 + d - 20} stroke="#c8c2ad" dash="120 80" /> : null}</g>;
    case "wallbox":
      return <g><R x={x0} y={y0} w={w} h={d} rx={30} fill={cor} /><R x={x0 + w * 0.2} y={y0 + d - 30} w={w * 0.6} h={20} fill="#3fb37f" /></g>;
    case "bancada-ferramentas":
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={MADEIRA_TAMPO} /><R x={x0} y={y0} w={w} h={50} fill={cor} />
        {[0.2, 0.45, 0.7].map((t) => <R key={t} x={x0 + w * t} y={y0 + d * 0.35} w={w * 0.12} h={d * 0.2} rx={20} fill="#c0392b" />)}</g>;
    case "caixa-teto":
      return <g><C x={0} y={0} r={Math.min(w, d) / 2} fill={cor} stroke={TRACO} /><C x={0} y={0} r={Math.min(w, d) * 0.36} fill="none" />
        {[-0.2, 0, 0.2].map((t) => <L key={t} x1={-w * 0.3} y1={d * t} x2={w * 0.3} y2={d * t} stroke="#9aa0a3" />)}</g>;
    case "caixa-torre": case "subwoofer":
      return <g><Superficie x={x0} y={y0} w={w} h={d} rx={20} material={material} cor={cor} /><C x={0} y={y0 + d - 25} r={Math.min(w * 0.3, 90)} fill="#555555" /></g>;
    case "soundbar": case "receiver":
      return <g><R x={x0} y={y0} w={w} h={d} rx={forma === "soundbar" ? 40 : 10} fill={cor} />
        {forma === "soundbar" ? <L x1={x0 + 40} y1={y0 + d - 25} x2={x0 + w - 40} y2={y0 + d - 25} stroke="#666666" dash="20 15" /> : <C x={x0 + w * 0.75} y={y0 + d - 50} r={30} fill="#777777" />}</g>;
    case "projetor":
      return <g><R x={x0} y={y0} w={w} h={d} rx={40} fill={cor} dash="50 30" /><C x={x0 + w * 0.3} y={y0 + d - 60} r={60} fill="#2b3a44" />
        <P d={`M ${x0 + w * 0.3 - 60} ${y0 + d} L ${x0 + w * 0.3 - 400} ${y0 + d + 1400} M ${x0 + w * 0.3 + 60} ${y0 + d} L ${x0 + w * 0.3 + 400} ${y0 + d + 1400}`} fill="none" stroke="#c9a227" /></g>;
    case "tela-projecao":
      return <g><R x={x0} y={y0} w={w} h={Math.max(d, 40)} fill="#2b2b2b" /><R x={x0 + 60} y={y0 + d} w={w - 120} h={30} fill={cor} /></g>;
    case "poltrona-cinema": {
      const lugares = Math.max(1, Number(variante ?? 1)), vao = w / lugares;
      return <g>{Array.from({ length: lugares }, (_, i) => {
        const x = x0 + i * vao;
        return <g key={i}><R x={x} y={y0} w={vao} h={d} rx={60} fill={escuro} /><R x={x + vao * 0.16} y={y0 + d * 0.22} w={vao * 0.68} h={d * 0.5} rx={50} fill={claro} />
          <R x={x + vao * 0.16} y={y0 + d * 0.72} w={vao * 0.68} h={d * 0.26} rx={30} fill={tom(cor, 1.1)} dash="40 30" />
          <C x={x + vao * 0.08} y={y0 + d * 0.3} r={Math.min(vao * 0.05, 35)} fill="#222222" /></g>;
      })}</g>;
    }
    case "ar-split": case "ar-piso-teto":
      return <g><R x={x0} y={y0} w={w} h={d} rx={30} fill={cor} dash={forma === "ar-piso-teto" ? "50 30" : undefined} /><L x1={x0 + 40} y1={y0 + d - 40} x2={x0 + w - 40} y2={y0 + d - 40} stroke="#8fb7c6" />
        {[0.3, 0.55].map((t) => <P key={t} d={`M ${-w * 0.25} ${y0 + d + 150 + t * 600} Q 0 ${y0 + d + 60 + t * 600} ${w * 0.25} ${y0 + d + 150 + t * 600}`} fill="none" stroke="#8fb7c6" />)}</g>;
    case "ar-cassete":
      return <g><R x={x0} y={y0} w={w} h={d} rx={20} fill={cor} dash="50 30" /><R x={x0 + w * 0.3} y={y0 + d * 0.3} w={w * 0.4} h={d * 0.4} fill="#e2e4e5" />
        {[[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy], i) => <R key={i} x={dx ? (dx > 0 ? x0 + w * 0.78 : x0 + w * 0.12) : x0 + w * 0.3} y={dy ? (dy > 0 ? y0 + d * 0.78 : y0 + d * 0.12) : y0 + d * 0.3} w={dx ? w * 0.1 : w * 0.4} h={dy ? d * 0.1 : d * 0.4} fill="#8fb7c6" stroke="none" />)}</g>;
    case "ar-condensadora":
      return <g><R x={x0} y={y0} w={w} h={d} rx={20} fill={cor} /><C x={x0 + w * 0.38} y={0} r={Math.min(w * 0.3, d * 0.45)} fill="#cfd3d4" /><R x={x0 + w * 0.78} y={y0 + 40} w={w * 0.16} h={d - 80} fill={tom(cor, 0.85)} /></g>;
    case "cortina": {
      // Vista de cima: o tecido em ondas ao longo do trilho.
      const ondas = Math.max(4, Math.round(w / 150)), passo = w / ondas, amp = Math.max(20, d * 0.35);
      let caminho = `M ${x0} 0`;
      for (let i = 0; i < ondas; i += 1) caminho += ` q ${passo / 2} ${i % 2 ? -amp : amp} ${passo} 0`;
      return <g><L x1={x0} y1={y0} x2={x0 + w} y2={y0} stroke="#8a8378" />
        <path d={caminho} fill="none" stroke={variante === "voil" ? "#b8b2a6" : tom(cor, 0.7)} strokeWidth={variante === "blackout" ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" /></g>;
    }
    case "persiana":
      return <g><R x={x0} y={y0} w={w} h={d} fill={corDoMaterial(material, cor)} />
        {variante === "vertical" ? Array.from({ length: Math.max(3, Math.round(w / 100)) }, (_, i) => { const n = Math.max(3, Math.round(w / 100)); return <L key={i} x1={x0 + (i + 0.5) * w / n - 40} y1={y0 + d * 0.8} x2={x0 + (i + 0.5) * w / n + 40} y2={y0 + d * 0.2} />; })
          : <L x1={x0} y1={y0 + d / 2} x2={x0 + w} y2={y0 + d / 2} dash={variante === "horizontal" ? "30 20" : undefined} />}</g>;
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
    case "sofa-l": {
      // Assento principal ao fundo e chaise à direita, na profundidade toda.
      const fundo = Math.min(900, d), chaise = Math.min(900, w * 0.4), braco = 180, encosto = fundo * 0.24;
      const vao = (w - chaise - braco) / 2;
      return <g>
        <P d={`M ${x0} ${y0} H ${x0 + w} V ${y0 + d} H ${x0 + w - chaise} V ${y0 + fundo} H ${x0} Z`} fill={escuro} />
        {[0, 1].map((i) => <R key={i} x={x0 + braco + i * vao + 15} y={y0 + encosto} w={vao - 30} h={fundo - encosto - 40} rx={60} fill={claro} />)}
        <R x={x0 + w - chaise + 15} y={y0 + encosto} w={chaise - encosto - 30} h={d - encosto - 40} rx={60} fill={claro} />
      </g>;
    }
    case "puff":
      return <g><C x={0} y={0} r={Math.min(w, d) / 2} fill={cor} /><C x={0} y={0} r={Math.min(w, d) * 0.3} fill={claro} /></g>;
    case "banqueta":
      return <g><C x={0} y={0} r={Math.min(w, d) / 2} fill={tom(cor, 1.2)} /><C x={0} y={0} r={Math.min(w, d) * 0.32} fill={cor} /></g>;
    case "painel-tv":
      return <g><Superficie x={x0} y={y0} w={w} h={Math.max(d, 40)} material={material} cor={cor} /><R x={-w * 0.33} y={y0 + d} w={w * 0.66} h={60} fill="#111111" /></g>;
    case "aparador":
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={cor} />{[[x0 + 40, y0 + 40], [x0 + w - 80, y0 + 40], [x0 + 40, y0 + d - 80], [x0 + w - 80, y0 + d - 80]].map(([x, y], i) => <R key={i} x={x} y={y} w={40} h={40} fill={escuro} />)}</g>;
    case "comoda": {
      const gavetas = Math.max(1, Math.round(w / 500));
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={cor} />{Array.from({ length: gavetas - 1 }, (_, i) => <L key={i} x1={x0 + (i + 1) * w / gavetas} y1={y0 + d - 60} x2={x0 + (i + 1) * w / gavetas} y2={y0 + d} />)}<L x1={x0} y1={y0 + d - 40} x2={x0 + w} y2={y0 + d - 40} /></g>;
    }
    case "cristaleira":
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={cor} /><R x={x0 + 40} y={y0 + d - 70} w={w - 80} h={40} fill={VIDRO} opacity={0.7} /><L x1={0} y1={y0 + d - 70} x2={0} y2={y0 + d - 30} /></g>;
    case "adega":
      return <g><R x={x0} y={y0} w={w} h={d} rx={15} fill={cor} /><R x={x0 + 40} y={y0 + d - 70} w={w - 80} h={40} fill={VIDRO} />{Array.from({ length: 3 }, (_, i) => <C key={i} x={x0 + w * (i + 1) / 4} y={y0 + d * 0.4} r={Math.min(w, d) * 0.07} fill="#5b1a24" />)}</g>;
    case "beliche":
      return <g><R x={x0} y={y0} w={w} h={d} fill="#8a6a4f" /><R x={x0 + 40} y={y0 + 40} w={w - 80} h={d - 80} rx={30} fill="#f7f4ee" />
        <R x={x0 + 70} y={y0 + 90} w={w - 140} h={Math.min(360, d * 0.18)} rx={70} fill="#ffffff" /><R x={x0 + 40} y={y0 + d * 0.36} w={w - 80} h={d * 0.64 - 40} rx={30} fill={cor} />
        <R x={x0 + 60} y={y0 + 60} w={w - 120} h={d - 120} fill="none" dash="80 50" />
        <R x={x0 + w - 60} y={y0 + d * 0.62} w={60} h={d * 0.3} fill="#6b4f3a" />{[0.68, 0.76, 0.84].map((t) => <L key={t} x1={x0 + w - 60} y1={y0 + d * t} x2={x0 + w} y2={y0 + d * t} />)}</g>;
    case "penteadeira":
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={cor} /><R x={-w * 0.3} y={y0} w={w * 0.6} h={30} fill={VIDRO} />{banquetaEm(0, y0 + d + 220, "#d9c9b6", "b")}</g>;
    case "coifa":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} dash="60 40" opacity={0.6} /><R x={-w * 0.17} y={y0} w={w * 0.34} h={d * 0.5} fill={tom(cor, 0.85)} dash="60 40" /><L x1={x0} y1={y0 + d} x2={-w * 0.17} y2={y0 + d * 0.5} dash="40 30" /><L x1={x0 + w} y1={y0 + d} x2={w * 0.17} y2={y0 + d * 0.5} dash="40 30" /></g>;
    case "torre-quente":
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={cor} /><R x={x0 + 50} y={y0 + d - 80} w={w - 100} h={50} fill="#1d1d1d" /></g>;
    case "balcao": {
      const banquetas = Number(variante ?? 0);
      return <g>
        {Array.from({ length: banquetas }, (_, i) => banquetaEm(x0 + (i + 0.5) * w / banquetas, y0 + d + 200, "#3d3a36", `b${i}`))}
        <R x={x0 + 30} y={y0} w={w - 60} h={d - (banquetas ? 250 : 0)} fill={cor} />
        <Superficie x={x0} y={y0} w={w} h={d} material={material} cor={baseTampo} />
        {banquetas ? <L x1={x0} y1={y0 + d - 250} x2={x0 + w} y2={y0 + d - 250} dash="50 40" /> : null}
      </g>;
    }
    case "balcao-atendimento":
      return <g><Superficie x={x0} y={y0} w={w} h={d * 0.7} material={material} cor={MADEIRA_TAMPO} /><R x={x0} y={y0 + d * 0.7} w={w} h={d * 0.3} fill={cor} />
        <L x1={x0} y1={y0 + d * 0.7} x2={x0 + w} y2={y0 + d * 0.7} />{cadeiraEm(0, y0 + d * 0.3, 0, "#2f3133", "c")}</g>;
    case "hidro":
      return <g><R x={x0} y={y0} w={w} h={d} rx={120} fill={cor} /><C x={0} y={0} r={Math.min(w, d) * 0.4} fill="#bfe0ea" />{[0, 90, 180, 270].map((g) => { const a = g * Math.PI / 180, r = Math.min(w, d) * 0.33; return <C key={g} x={Math.cos(a) * r} y={Math.sin(a) * r} r={20} fill="#8fb7c6" />; })}</g>;
    case "banco-alvenaria":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><Hachura x={x0} y={y0} w={w} h={d} /><Superficie x={x0 + 20} y={y0 + 20} w={w - 40} h={d - 40} material={material} cor={MADEIRA_TAMPO} /></g>;
    case "sofa-alvenaria": {
      const encosto = Math.min(d * 0.28, 250), lugares = Math.max(1, Math.round(w / 700));
      const vao = (w - 300) / lugares;
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><Hachura x={x0} y={y0} w={w} h={encosto} />
        {Array.from({ length: lugares }, (_, i) => <R key={i} x={x0 + 150 + i * vao + 15} y={y0 + encosto + 20} w={vao - 30} h={d - encosto - 60} rx={50} fill="#cdbb9e" />)}</g>;
    }
    case "cama-alvenaria":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><Hachura x={x0} y={y0} w={w} h={d} />
        <R x={x0 + 50} y={y0 + 50} w={w - 100} h={d - 100} rx={40} fill="#f7f4ee" />
        {[0, 1].map((i) => <R key={i} x={x0 + 80 + i * (w - 160) / 2 + 20} y={y0 + 100} w={(w - 160) / 2 - 40} h={Math.min(360, d * 0.18)} rx={80} fill="#ffffff" />)}
        <R x={x0 + 50} y={y0 + d * 0.38} w={w - 100} h={d * 0.62 - 50} rx={30} fill="#b9a88f" /></g>;
    case "mureta":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><Hachura x={x0} y={y0} w={w} h={d} passo={80} />{material ? <R x={x0} y={y0} w={w} h={d} fill="none" stroke={tom(corDoMaterial(material, MADEIRA_TAMPO), 0.8)} /> : null}</g>;
    case "floreira": {
      const aleatorio = sorteio(w + d), mudas = Math.max(2, Math.round(w / 350));
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><R x={x0 + 80} y={y0 + 80} w={w - 160} h={d - 160} fill="#6b4a2b" />
        {Array.from({ length: mudas }, (_, i) => <C key={i} x={x0 + (i + 0.5) * w / mudas} y={(aleatorio() - 0.5) * d * 0.2} r={Math.min(d * 0.32, 180)} fill={tom("#5b8c51", 0.9 + aleatorio() * 0.3)} stroke={tom("#5b8c51", 0.6)} />)}</g>;
    }
    case "nicho": {
      const colunas = Math.max(1, Math.round(w / 500));
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><Hachura x={x0} y={y0} w={w} h={d * 0.35} />
        {Array.from({ length: colunas }, (_, i) => <R key={i} x={x0 + i * w / colunas + 60} y={y0 + d * 0.35} w={w / colunas - 120} h={d * 0.65} fill={tom(cor, 0.9)} />)}</g>;
    }
    case "lareira":
      return <g><R x={x0} y={y0} w={w} h={d} fill={cor} /><Hachura x={x0} y={y0} w={w} h={d * 0.55} />
        <R x={-w * 0.3} y={y0 + d * 0.15} w={w * 0.6} h={d * 0.55} fill="#2a2522" /><C x={0} y={y0 + d * 0.45} r={Math.min(w, d) * 0.12} fill="#e0772f" stroke="none" />
        <Superficie x={x0 - 80} y={y0 + d * 0.7} w={w + 160} h={d * 0.3 + 100} material={material} cor={MADEIRA_TAMPO} /></g>;
    case "bancada-churrasqueira": {
      const churrasqueira = Math.min(1000, w * 0.4);
      return <g><Superficie x={x0} y={y0} w={w} h={d} material={material} cor={MADEIRA_TAMPO} />
        <R x={x0} y={y0} w={churrasqueira} h={d} fill={cor} /><R x={x0 + 80} y={y0 + 80} w={churrasqueira - 160} h={d - 180} fill="#2a2a2a" />
        {Array.from({ length: 5 }, (_, i) => <L key={i} x1={x0 + 80 + (i + 1) * (churrasqueira - 160) / 6} y1={y0 + 80} x2={x0 + 80 + (i + 1) * (churrasqueira - 160) / 6} y2={y0 + d - 100} stroke="#777777" />)}
        <R x={x0 + churrasqueira + (w - churrasqueira) * 0.5 - 250} y={y0 + 110} w={500} h={d - 200} rx={50} fill="#c7cbcd" /><C x={x0 + churrasqueira + (w - churrasqueira) * 0.5} y={y0 + 60} r={30} fill="#9aa0a3" /></g>;
    }
    case "pergolado": {
      const vigas = Math.max(3, Math.round(w / 500));
      return <g opacity={0.8}><R x={x0} y={y0} w={w} h={d} fill="none" dash="100 60" />
        {Array.from({ length: vigas + 1 }, (_, i) => <R key={i} x={x0 + i * (w - 60) / vigas} y={y0 - 150} w={60} h={d + 300} fill={cor} />)}
        {[[x0, y0], [x0 + w - 150, y0], [x0, y0 + d - 150], [x0 + w - 150, y0 + d - 150]].map(([x, y], i) => <R key={`p${i}`} x={x} y={y} w={150} h={150} fill={tom(cor, 0.7)} />)}</g>;
    }
    case "mesa-guarda-sol": {
      const r = Math.min(w, d) / 2;
      return <g>{[0, 90, 180, 270].map((giro) => { const rad = (giro - 90) * Math.PI / 180; return cadeiraEm(Math.cos(rad) * (r + 230), Math.sin(rad) * (r + 230), giro, "#8a8378", String(giro)); })}
        <SuperficieRedonda r={r} material={material} cor={cor} />
        <circle cx={0} cy={0} r={r + 700} fill={cor} fillOpacity={0.25} stroke={TRACO} strokeDasharray="80 60" vectorEffect="non-scaling-stroke" />
        {Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return <L key={`v${i}`} x1={0} y1={0} x2={Math.cos(a) * (r + 700)} y2={Math.sin(a) * (r + 700)} dash="40 40" />; })}
        <C x={0} y={0} r={30} fill="#555555" /></g>;
    }
    default:
      return <R x={x0} y={y0} w={w} h={d} fill={cor} />;
  }
}
