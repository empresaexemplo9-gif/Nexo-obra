import type * as THREE_NS from "three";

import { itemDoCatalogo, type ItemCatalogo } from "@/lib/layout-catalogo";
import { corDoPiso, pedacosDaParede, type Abertura, type ItemLayout, type LayoutConteudo, type Parede, type Piso } from "@/lib/layout";

// Prévia 3D do layout, montada com primitivas do three.js na medida de cada item.
//
// Não há modelo 3D de terceiros: cada móvel, eletrodoméstico e veículo é construído aqui
// com caixas, cilindros e perfis extrudados. É uma noção de volume e proporção para a
// proposta — o que a tela diz ao cliente —, não um render fotorrealista.
//
// Unidade no 3D: metro. Planta (x, y) em mm → mundo (x/1000, altura, y/1000).

type Three = typeof THREE_NS;
type Group = THREE_NS.Group;

const m = (mm: number) => mm / 1000;

function tom(hex: string, fator: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  const canal = (c: number) => Math.max(0, Math.min(255, Math.round(fator >= 1 ? c + (255 - c) * (fator - 1) : c * fator)));
  return (canal(n >> 16) << 16) | (canal((n >> 8) & 255) << 8) | canal(n & 255);
}

class Construtor {
  private materiais = new Map<string, THREE_NS.Material>();
  constructor(readonly three: Three) {}

  mat(cor: number | string, opcoes: { rugosidade?: number; metal?: number; opacidade?: number; brilho?: number } = {}) {
    const chave = `${cor}|${opcoes.rugosidade ?? 0.75}|${opcoes.metal ?? 0}|${opcoes.opacidade ?? 1}|${opcoes.brilho ?? 0}`;
    let material = this.materiais.get(chave);
    if (!material) {
      material = new this.three.MeshStandardMaterial({
        color: new this.three.Color(cor), roughness: opcoes.rugosidade ?? 0.75, metalness: opcoes.metal ?? 0,
        transparent: (opcoes.opacidade ?? 1) < 1, opacity: opcoes.opacidade ?? 1,
        emissive: opcoes.brilho ? new this.three.Color(cor) : undefined, emissiveIntensity: opcoes.brilho ?? 0,
      });
      this.materiais.set(chave, material);
    }
    return material;
  }

  /** Caixa com a base em `y`. */
  caixa(g: Group, w: number, h: number, d: number, material: THREE_NS.Material, x: number, y: number, z: number, sombra = true) {
    const malha = new this.three.Mesh(new this.three.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)), material);
    malha.position.set(x, y + h / 2, z);
    malha.castShadow = sombra; malha.receiveShadow = true;
    g.add(malha);
    return malha;
  }

  cilindro(g: Group, r: number, h: number, material: THREE_NS.Material, x: number, y: number, z: number, deitado?: "x" | "z", rTopo?: number) {
    const malha = new this.three.Mesh(new this.three.CylinderGeometry(rTopo ?? r, r, h, 28), material);
    if (deitado === "x") malha.rotation.z = Math.PI / 2;
    if (deitado === "z") malha.rotation.x = Math.PI / 2;
    malha.position.set(x, deitado ? y : y + h / 2, z);
    malha.castShadow = true; malha.receiveShadow = true;
    g.add(malha);
    return malha;
  }

  esfera(g: Group, r: number, material: THREE_NS.Material, x: number, y: number, z: number, achatar = 1) {
    const malha = new this.three.Mesh(new this.three.IcosahedronGeometry(r, 2), material);
    malha.scale.y = achatar; malha.position.set(x, y, z); malha.castShadow = true;
    g.add(malha);
    return malha;
  }

  /** Perfil lateral (z, y) extrudado ao longo de X, centrado. */
  perfil(g: Group, pontos: Array<[number, number]>, largura: number, material: THREE_NS.Material, chanfro = 0.03) {
    const forma = new this.three.Shape(pontos.map(([z, y]) => new this.three.Vector2(z, y)));
    const geometria = new this.three.ExtrudeGeometry(forma, { depth: largura - 2 * chanfro, bevelEnabled: chanfro > 0, bevelSize: chanfro, bevelThickness: chanfro, bevelSegments: 3 });
    geometria.translate(0, 0, -(largura - 2 * chanfro) / 2);
    const malha = new this.three.Mesh(geometria, material);
    malha.rotation.y = -Math.PI / 2; // o eixo do perfil (x da forma) vira o comprimento (z do item)
    malha.castShadow = true; malha.receiveShadow = true;
    g.add(malha);
    return malha;
  }
}

function cadeira(c: Construtor, g: Group, cor: string, x: number, z: number, giro: number) {
  const cadeiraG = new c.three.Group();
  const madeira = c.mat(tom(cor, 0.8)), estofado = c.mat(tom(cor, 1.3));
  for (const [dx, dz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) c.caixa(cadeiraG, 0.035, 0.43, 0.035, madeira, dx, 0, dz);
  c.caixa(cadeiraG, 0.44, 0.05, 0.44, estofado, 0, 0.43, 0);
  c.caixa(cadeiraG, 0.44, 0.45, 0.04, madeira, 0, 0.48, -0.2);
  cadeiraG.position.set(x, 0, z); cadeiraG.rotation.y = giro;
  g.add(cadeiraG);
}

function carro(c: Construtor, g: Group, w: number, h: number, d: number, cor: string, variante: string) {
  const pintura = c.mat(cor, { rugosidade: 0.35, metal: 0.4 });
  const vidro = c.mat(0x2d3c46, { rugosidade: 0.1, metal: 0.3, opacidade: 0.85 });
  const borracha = c.mat(0x151515, { rugosidade: 0.9 });
  const aro = c.mat(0xb8bcc0, { rugosidade: 0.3, metal: 0.8 });
  const r = Math.min(0.36, h * 0.22);
  const L = d / 2;
  // Corpo até a linha da cintura, com a frente em +z.
  const cintura = h * (variante === "suv" || variante === "picape" ? 0.58 : 0.52);
  c.perfil(g, [[-L, r * 0.55], [-L, cintura * 0.92], [-L + 0.08, cintura], [L - 0.25, cintura], [L - 0.02, cintura * 0.78], [L, r * 0.6], [L - 0.1, r * 0.35], [-L + 0.1, r * 0.35]], w, pintura);
  // Cabine: vidro com teto pintado por cima.
  const [tras, frente] = variante === "hatch" ? [-L + 0.25, L * 0.45] : variante === "suv" ? [-L + 0.15, L * 0.42] : variante === "picape" ? [-L * 0.1, L * 0.45] : [-L * 0.55, L * 0.4];
  const topo = h - 0.04;
  const tetoTras = tras + (variante === "seda" ? 0.35 : 0.1), tetoFrente = frente - (h * 0.45);
  c.perfil(g, [[tras, cintura], [frente, cintura], [tetoFrente, topo - 0.05], [tetoTras, topo - 0.05]], w * 0.86, vidro, 0.02);
  c.perfil(g, [[tetoTras - 0.02, topo - 0.06], [tetoFrente + 0.02, topo - 0.06], [tetoFrente, topo], [tetoTras, topo]], w * 0.84, pintura, 0.01);
  if (variante === "picape") {
    const cacamba = c.mat(tom(cor, 0.5), { rugosidade: 0.8 });
    c.caixa(g, w * 0.88, 0.02, (tras + L) - 0.2, cacamba, 0, cintura - 0.02, (-L + tras) / 2 + 0.05);
    for (const lado of [-1, 1]) c.caixa(g, 0.05, 0.25, (tras + L) - 0.2, pintura, lado * w * 0.44, cintura, (-L + tras) / 2 + 0.05);
  }
  for (const [x, z] of [[-w / 2 + 0.12, L * 0.62], [w / 2 - 0.12, L * 0.62], [-w / 2 + 0.12, -L * 0.62], [w / 2 - 0.12, -L * 0.62]]) {
    c.cilindro(g, r, 0.22, borracha, x, r, z, "x");
    c.cilindro(g, r * 0.6, 0.23, aro, x, r, z, "x");
  }
  const farol = c.mat(0xfff6d6, { brilho: 0.6 }), lanterna = c.mat(0xc0271f, { brilho: 0.4 });
  for (const lado of [-1, 1]) {
    c.caixa(g, w * 0.2, 0.08, 0.03, farol, lado * w * 0.32, cintura * 0.72, L - 0.01);
    c.caixa(g, w * 0.2, 0.07, 0.03, lanterna, lado * w * 0.32, cintura * 0.78, -L + 0.01);
  }
}

function modeloDoItem(c: Construtor, item: ItemLayout, base: ItemCatalogo): Group {
  const g = new c.three.Group();
  const w = m(item.largura), d = m(item.profundidade), h = m(item.altura);
  const cor = item.cor;
  const corpo = c.mat(cor), escuro = c.mat(tom(cor, 0.7)), claro = c.mat(tom(cor, 1.25));
  const branco = c.mat(0xf4f4f2, { rugosidade: 0.3 }), inox = c.mat(0xbfc3c6, { rugosidade: 0.3, metal: 0.7 });
  const preto = c.mat(0x1c1c1c, { rugosidade: 0.4 }), madeira = c.mat(0x8a6a4f);
  const vidro = c.mat(0xbfe3ee, { rugosidade: 0.05, opacidade: 0.35 });
  const y0 = base.elevacao ? m(base.elevacao) : 0;
  switch (base.forma) {
    case "sofa": case "poltrona": {
      const braco = Math.min(w * 0.12, 0.2), encosto = d * 0.24;
      c.caixa(g, w, 0.18, d, escuro, 0, 0.05, 0);
      c.caixa(g, w - 2 * braco, 0.2, d - encosto, claro, 0, 0.23, encosto / 2);
      c.caixa(g, w, h - 0.05, encosto, corpo, 0, 0.05, -d / 2 + encosto / 2);
      for (const lado of [-1, 1]) c.caixa(g, braco, h * 0.72, d, corpo, lado * (w / 2 - braco / 2), 0.05, 0);
      for (const lado of [-1, 1]) c.caixa(g, 0.04, 0.05, 0.04, preto, lado * (w / 2 - 0.08), 0, d / 2 - 0.08);
      break;
    }
    case "cama": {
      c.caixa(g, w, 0.3, d, madeira, 0, 0, 0);
      c.caixa(g, w - 0.06, 0.24, d - 0.08, branco, 0, 0.3, 0.02);
      c.caixa(g, w, 1.0, 0.06, madeira, 0, 0, -d / 2 + 0.03);
      const travesseiros = base.variante === "solteiro" ? 1 : 2;
      for (let i = 0; i < travesseiros; i += 1) {
        const largura = (w - 0.2) / travesseiros - 0.05;
        c.caixa(g, largura, 0.12, 0.38, branco, -w / 2 + 0.1 + largura / 2 + i * (largura + 0.1), 0.54, -d / 2 + 0.3);
      }
      c.caixa(g, w - 0.02, 0.05, d * 0.6, corpo, 0, 0.53, d * 0.2);
      break;
    }
    case "berco":
      c.caixa(g, w, 0.35, d, branco, 0, 0.3, 0);
      for (let i = 0; i <= 10; i += 1) for (const lado of [-1, 1]) c.caixa(g, 0.02, h - 0.3, 0.02, branco, lado * (w / 2 - 0.02), 0.3, -d / 2 + (i * d) / 10);
      c.caixa(g, w - 0.06, 0.12, d - 0.06, corpo, 0, 0.62, 0);
      break;
    case "criado": case "guarda-roupa": case "armario": case "armario-aereo": case "estante": {
      c.caixa(g, w, h, d, corpo, 0, y0, 0);
      const portas = Math.max(1, Math.round(w / (base.forma === "criado" ? 1 : 0.5)));
      const junta = c.mat(tom(cor, 0.55));
      if (base.forma === "estante") {
        for (let i = 1; i < 5; i += 1) c.caixa(g, w - 0.04, 0.02, d - 0.02, escuro, 0, y0 + (h * i) / 5, 0.01);
      } else {
        for (let i = 1; i < portas; i += 1) c.caixa(g, 0.006, h - 0.02, 0.01, junta, -w / 2 + (i * w) / portas, y0 + 0.01, d / 2);
        for (let i = 0; i < portas; i += 1) c.caixa(g, 0.015, Math.min(0.25, h * 0.3), 0.02, inox, -w / 2 + ((i + 0.5) * w) / portas + (i % 2 ? -0.1 : 0.1) * Math.min(1, w / portas), y0 + h * (base.forma === "armario-aereo" ? 0.15 : 0.5), d / 2 + 0.01);
        if (base.forma === "criado") c.caixa(g, w - 0.02, 0.006, 0.01, junta, 0, y0 + h * 0.7, d / 2);
      }
      if (base.forma === "armario") c.caixa(g, w + 0.02, 0.03, d + 0.02, c.mat(0x3d3a36, { rugosidade: 0.3 }), 0, h - 0.03, 0);
      break;
    }
    case "mesa": case "mesa-redonda": case "mesa-centro": case "escrivaninha": {
      const redonda = base.forma === "mesa-redonda";
      if (redonda) c.cilindro(g, w / 2, 0.04, corpo, 0, h - 0.04, 0); else c.caixa(g, w, 0.04, d, corpo, 0, h - 0.04, 0);
      const pernas = redonda ? [[0, 0]] : [[-w / 2 + 0.06, -d / 2 + 0.06], [w / 2 - 0.06, -d / 2 + 0.06], [-w / 2 + 0.06, d / 2 - 0.06], [w / 2 - 0.06, d / 2 - 0.06]];
      for (const [x, z] of pernas) c.caixa(g, redonda ? 0.08 : 0.05, h - 0.04, redonda ? 0.08 : 0.05, escuro, x, 0, z);
      if (base.forma === "mesa") {
        const lugares = Number(base.variante ?? 4), lado = lugares >= 6 ? Math.floor((lugares - 2) / 2) : Math.floor(lugares / 2);
        for (let i = 0; i < lado; i += 1) {
          const x = -w / 2 + ((i + 0.5) * w) / lado;
          cadeira(c, g, cor, x, -d / 2 - 0.23, 0); cadeira(c, g, cor, x, d / 2 + 0.23, Math.PI);
        }
        if (lugares >= 6) { cadeira(c, g, cor, -w / 2 - 0.23, 0, Math.PI / 2); cadeira(c, g, cor, w / 2 + 0.23, 0, -Math.PI / 2); }
      }
      if (redonda) for (let i = 0; i < 4; i += 1) { const a = (i * Math.PI) / 2; cadeira(c, g, cor, Math.sin(a) * (w / 2 + 0.23), Math.cos(a) * (w / 2 + 0.23), a + Math.PI); }
      if (base.forma === "escrivaninha") { c.caixa(g, 0.55, 0.32, 0.03, preto, 0, h + 0.1, -d / 2 + 0.12); c.caixa(g, 0.06, 0.1, 0.06, preto, 0, h, -d / 2 + 0.12); }
      break;
    }
    case "cadeira": cadeira(c, g, cor, 0, 0, 0); break;
    case "cadeira-escritorio":
      c.cilindro(g, 0.3, 0.04, preto, 0, 0.04, 0); c.cilindro(g, 0.03, 0.4, inox, 0, 0.05, 0);
      c.caixa(g, 0.5, 0.08, 0.48, corpo, 0, 0.45, 0.02); c.caixa(g, 0.46, 0.55, 0.06, corpo, 0, 0.55, -0.22);
      break;
    case "rack-tv":
      c.caixa(g, w, 0.45, d, corpo, 0, 0.05, 0);
      c.caixa(g, w * 0.68, w * 0.68 * 0.5625, 0.04, preto, 0, 0.62, -d / 2 + 0.08);
      break;
    case "tapete": c.caixa(g, w, 0.01, d, corpo, 0, 0, 0, false); break;
    case "geladeira":
      c.caixa(g, w, h, d, c.mat(cor, { rugosidade: 0.3, metal: 0.5 }), 0, 0, 0);
      if (base.variante === "side") c.caixa(g, 0.006, h - 0.02, 0.01, preto, 0, 0.01, d / 2);
      else c.caixa(g, w - 0.01, 0.006, 0.01, preto, 0, h * 0.68, d / 2);
      for (const x of base.variante === "side" ? [-0.04, 0.04] : [w / 2 - 0.06]) c.caixa(g, 0.02, h * 0.4, 0.03, inox, x, h * 0.25, d / 2 + 0.015);
      break;
    case "fogao": case "cooktop": {
      const cooktop = base.forma === "cooktop";
      c.caixa(g, w, h - 0.03, d, cooktop ? c.mat(cor) : c.mat(cor, { rugosidade: 0.35, metal: 0.4 }), 0, 0, 0);
      c.caixa(g, cooktop ? Math.min(0.8, w - 0.1) : w, 0.03, d - (cooktop ? 0.1 : 0), preto, 0, h - 0.03, 0);
      const bocas = cooktop ? 5 : Number(base.variante ?? 4), colunas = bocas === 6 ? 3 : 2;
      for (let i = 0; i < Math.min(bocas, 6); i += 1) {
        const col = i % colunas, lin = Math.floor(i / colunas);
        c.cilindro(g, 0.07, 0.012, c.mat(0x444444), -((cooktop ? 0.7 : w) / 2) + ((col + 0.5) * (cooktop ? 0.7 : w)) / colunas, h, -d / 4 + lin * (d / 2));
      }
      if (!cooktop) c.caixa(g, w * 0.8, h * 0.4, 0.01, c.mat(0x223038, { rugosidade: 0.1, opacidade: 0.9 }), 0, h * 0.2, d / 2 + 0.005);
      break;
    }
    case "bancada-pia":
      c.caixa(g, w, h - 0.04, d, corpo, 0, 0, 0);
      c.caixa(g, w + 0.02, 0.04, d + 0.02, c.mat(0x3d3a36, { rugosidade: 0.25 }), 0, h - 0.04, 0);
      c.caixa(g, 0.55, 0.01, d - 0.2, inox, 0, h + 0.001, 0.02);
      c.cilindro(g, 0.015, 0.3, inox, 0, h, -d / 2 + 0.08); c.caixa(g, 0.03, 0.03, 0.18, inox, 0, h + 0.28, -d / 2 + 0.16);
      break;
    case "micro-ondas":
      c.caixa(g, w, h, d, corpo, 0, y0, 0); c.caixa(g, w * 0.62, h * 0.7, 0.01, c.mat(0x2b3a44, { rugosidade: 0.1 }), -w * 0.12, y0 + h * 0.15, d / 2 + 0.005);
      break;
    case "lava-loucas": case "maquina-lavar": case "tanque":
      c.caixa(g, w, h, d, c.mat(cor, { rugosidade: 0.4, metal: base.forma === "lava-loucas" ? 0.5 : 0.1 }), 0, 0, 0);
      if (base.forma === "maquina-lavar") { c.cilindro(g, Math.min(w, h) * 0.3, 0.03, c.mat(0x9fb7c2, { rugosidade: 0.1, opacidade: 0.8 }), 0, h * 0.45, d / 2, "z"); c.caixa(g, w, 0.1, 0.02, c.mat(0xdddddd), 0, h - 0.12, d / 2); }
      if (base.forma === "tanque") c.caixa(g, w - 0.1, 0.02, d - 0.12, c.mat(0xbcc1c3), 0, h - 0.01, 0);
      if (base.forma === "lava-loucas") c.caixa(g, w, 0.08, 0.02, preto, 0, h - 0.1, d / 2);
      break;
    case "vaso": {
      const louca = c.mat(cor, { rugosidade: 0.2 });
      c.caixa(g, w * 0.95, 0.4, 0.18, louca, 0, 0.38, -d / 2 + 0.09);
      const bacia = c.cilindro(g, w * 0.36, 0.4, louca, 0, 0, d * 0.05, undefined, w * 0.46);
      bacia.scale.z = 1.35;
      c.cilindro(g, w * 0.47, 0.03, louca, 0, 0.4, d * 0.05).scale.z = 1.35;
      break;
    }
    case "lavatorio":
      c.caixa(g, w, h - 0.05, d, madeira, 0, 0, 0);
      c.caixa(g, w, 0.05, d, c.mat(cor, { rugosidade: 0.2 }), 0, h - 0.05, 0);
      c.cilindro(g, 0.2, 0.12, c.mat(cor, { rugosidade: 0.15 }), 0, h, 0.02).scale.z = 0.7;
      c.cilindro(g, 0.015, 0.25, inox, 0, h, -d / 2 + 0.06);
      break;
    case "box":
      c.caixa(g, w, 0.05, d, c.mat(0xe9e9e6), 0, 0, 0);
      c.caixa(g, 0.01, h, d, vidro, -w / 2, 0, 0, false); c.caixa(g, w, h, 0.01, vidro, 0, 0, d / 2, false);
      c.cilindro(g, 0.1, 0.02, inox, 0, 2.05, -d / 2 + 0.25);
      break;
    case "banheira":
      c.caixa(g, w, h, d, c.mat(cor, { rugosidade: 0.2 }), 0, 0, 0);
      c.caixa(g, w - 0.14, 0.01, d - 0.14, c.mat(0x9fd3e4, { rugosidade: 0.05, opacidade: 0.8 }), 0, h - 0.05, 0);
      break;
    case "carro": carro(c, g, w, h, d, cor, base.variante ?? "seda"); break;
    case "moto": {
      const pneu = c.mat(0x151515);
      for (const z of [d / 2 - 0.32, -d / 2 + 0.32]) { const roda = new c.three.Mesh(new c.three.TorusGeometry(0.28, 0.06, 12, 32), pneu); roda.rotation.y = Math.PI / 2; roda.position.set(0, 0.34, z); roda.castShadow = true; g.add(roda); }
      c.caixa(g, 0.28, 0.35, d * 0.5, corpo, 0, 0.45, 0);
      c.caixa(g, 0.26, 0.08, d * 0.3, preto, 0, 0.8, -d * 0.08);
      c.cilindro(g, 0.015, w, inox, 0, 1.0, d / 2 - 0.45, "x");
      break;
    }
    case "bicicleta": {
      const pneu = c.mat(0x151515), quadro = c.mat(cor, { rugosidade: 0.4, metal: 0.4 });
      for (const z of [d / 2 - 0.34, -d / 2 + 0.34]) { const roda = new c.three.Mesh(new c.three.TorusGeometry(0.33, 0.02, 8, 36), pneu); roda.rotation.y = Math.PI / 2; roda.position.set(0, 0.35, z); g.add(roda); }
      const barra = c.caixa(g, 0.03, 0.03, d * 0.62, quadro, 0, 0.62, 0); barra.rotation.x = 0.08;
      c.cilindro(g, 0.015, 0.5, quadro, 0, 0.35, -0.1); c.caixa(g, 0.1, 0.04, 0.22, preto, 0, 0.87, -0.12);
      c.cilindro(g, 0.012, w, quadro, 0, 0.95, d / 2 - 0.4, "x");
      break;
    }
    case "vaga": {
      const faixa = c.mat(0xf6f3e6, { rugosidade: 0.9 });
      c.caixa(g, 0.1, 0.004, d, faixa, -w / 2 + 0.05, 0.004, 0, false); c.caixa(g, 0.1, 0.004, d, faixa, w / 2 - 0.05, 0.004, 0, false);
      c.caixa(g, w, 0.004, 0.1, faixa, 0, 0.004, -d / 2 + 0.05, false);
      break;
    }
    case "arvore": {
      c.cilindro(g, Math.min(0.18, w * 0.06), h * 0.45, c.mat(0x6b4a2b), 0, 0, 0, undefined, Math.min(0.12, w * 0.04));
      const copa = c.mat(cor, { rugosidade: 0.9 }), copa2 = c.mat(tom(cor, 1.15), { rugosidade: 0.9 });
      c.esfera(g, w * 0.42, copa, 0, h * 0.65, 0, 0.8);
      c.esfera(g, w * 0.28, copa2, w * 0.22, h * 0.72, -w * 0.12, 0.85);
      c.esfera(g, w * 0.26, copa2, -w * 0.2, h * 0.58, w * 0.15, 0.85);
      break;
    }
    case "planta":
      c.cilindro(g, w * 0.35, h * 0.35, c.mat(0x8d6e53), 0, 0, 0, undefined, w * 0.45);
      c.esfera(g, w * 0.5, c.mat(cor, { rugosidade: 0.9 }), 0, h * 0.65, 0, 1.1);
      break;
    case "piscina": {
      const borda = c.mat(0xded6c6, { rugosidade: 0.9 });
      c.caixa(g, w - 0.5, 0.01, d - 0.5, c.mat(cor, { rugosidade: 0.05, metal: 0.1, opacidade: 0.9 }), 0, 0.005, 0, false);
      for (const [bw, bd, x, z] of [[w, 0.25, 0, -d / 2 + 0.125], [w, 0.25, 0, d / 2 - 0.125], [0.25, d, -w / 2 + 0.125, 0], [0.25, d, w / 2 - 0.125, 0]]) c.caixa(g, bw, 0.04, bd, borda, x, 0, z, false);
      break;
    }
    case "espreguicadeira": {
      c.caixa(g, w, 0.28, d * 0.65, corpo, 0, 0.1, d * 0.17);
      const encosto = c.caixa(g, w, 0.05, d * 0.36, escuro, 0, 0.45, -d / 2 + d * 0.16);
      encosto.rotation.x = -0.6;
      break;
    }
    case "churrasqueira":
      c.caixa(g, w, 0.9, d, corpo, 0, 0, 0);
      c.caixa(g, w * 0.8, 0.35, d * 0.85, preto, 0, 0.9, 0);
      c.caixa(g, w * 0.9, 0.5, d * 0.9, corpo, 0, 1.25, 0);
      c.caixa(g, w * 0.35, h - 1.75, d * 0.4, corpo, 0, 1.75, -d * 0.2);
      break;
    default:
      c.caixa(g, w, h, d, corpo, 0, y0, 0);
  }
  g.position.set(m(item.x), 0, m(item.y));
  g.rotation.y = (-item.rotacao * Math.PI) / 180;
  return g;
}

const texturas = new Map<Piso, THREE_NS.CanvasTexture>();

/** Textura desenhada no navegador: réguas de madeira, placas de porcelanato, grama… */
function texturaDoPiso(three: Three, piso: Piso) {
  const pronta = texturas.get(piso);
  if (pronta) return pronta;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const base = corDoPiso[piso];
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  const ruido = (intensidade: number, pontos: number) => {
    for (let i = 0; i < pontos; i += 1) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${Math.random() * intensidade})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  };
  let tamanho = 1; // metros cobertos pela textura
  if (piso === "madeira" || piso === "deck") {
    tamanho = 1.2;
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = `rgba(0,0,0,${0.04 + (i % 3) * 0.04})`; ctx.fillRect(0, i * 32, 256, 32);
      ctx.fillStyle = "rgba(40,25,10,0.5)"; ctx.fillRect(0, i * 32, 256, 1.5);
      ctx.fillRect(((i * 97) % 256), i * 32, 1.5, 32);
    }
    ruido(0.08, 900);
  } else if (piso === "porcelanato" || piso === "ceramica" || piso === "pedra") {
    tamanho = piso === "porcelanato" ? 1.8 : piso === "ceramica" ? 0.9 : 1.2;
    ruido(0.05, 1500);
    ctx.strokeStyle = "rgba(90,80,70,0.35)"; ctx.lineWidth = 2;
    const n = piso === "pedra" ? 3 : 3;
    for (let i = 0; i <= n; i += 1) { ctx.beginPath(); ctx.moveTo(0, (i * 256) / n); ctx.lineTo(256, (i * 256) / n); ctx.stroke(); ctx.beginPath(); ctx.moveTo((i * 256) / n, 0); ctx.lineTo((i * 256) / n, 256); ctx.stroke(); }
  } else if (piso === "grama") {
    tamanho = 2; ruido(0.25, 6000);
  } else {
    tamanho = 2; ruido(0.1, 3000);
  }
  const textura = new three.CanvasTexture(canvas);
  textura.wrapS = textura.wrapT = three.RepeatWrapping;
  textura.repeat.set(1 / tamanho, 1 / tamanho);
  textura.colorSpace = three.SRGBColorSpace;
  texturas.set(piso, textura);
  return textura;
}

function levantarParede(c: Construtor, g: Group, parede: Parede, aberturas: Abertura[], material: THREE_NS.Material) {
  const dx = parede.b.x - parede.a.x, dy = parede.b.y - parede.a.y;
  const comprimento = Math.hypot(dx, dy);
  if (comprimento < 1) return;
  const ux = dx / comprimento, uy = dy / comprimento;
  const angulo = -Math.atan2(dy, dx);
  const t = m(parede.espessura);
  for (const pedaco of pedacosDaParede(parede, aberturas)) {
    // A ponta que encosta no canto avança meia espessura: sem isso, o canto externo fica vazado.
    const ini = pedaco.inicio === 0 ? -parede.espessura / 2 : pedaco.inicio;
    const fim = Math.abs(pedaco.fim - comprimento) < 0.5 ? comprimento + parede.espessura / 2 : pedaco.fim;
    const meio = (ini + fim) / 2;
    const malha = c.caixa(g, m(fim - ini), m(pedaco.topo - pedaco.base), t, material, m(parede.a.x + ux * meio), m(pedaco.base), m(parede.a.y + uy * meio));
    malha.rotation.y = angulo;
  }
  const porta = c.mat(0x9a7456), aluminio = c.mat(0x4a4d50, { rugosidade: 0.4, metal: 0.6 });
  const vidro = c.mat(0xa9d4e2, { rugosidade: 0.05, opacidade: 0.35 });
  for (const abertura of aberturas.filter((a) => a.paredeId === parede.id)) {
    const cx = m(parede.a.x + ux * abertura.posicao), cz = m(parede.a.y + uy * abertura.posicao);
    const w = m(abertura.largura), h = m(abertura.altura), base = m(abertura.peitoril);
    const peca = (largura: number, altura: number, profundidade: number, material: THREE_NS.Material, y: number, deslocamento = 0) => {
      const malha = c.caixa(g, largura, altura, profundidade, material, cx + ux * deslocamento, y, cz + uy * deslocamento, material !== vidro);
      malha.rotation.y = angulo;
      return malha;
    };
    if (abertura.tipo === "porta") {
      peca(w - 0.04, h - 0.02, 0.04, porta, 0);
      const puxador = c.caixa(g, 0.12, 0.02, t + 0.06, aluminio, cx + ux * (w / 2 - 0.12) * (abertura.inverter ? -1 : 1), 1.0, cz + uy * (w / 2 - 0.12) * (abertura.inverter ? -1 : 1));
      puxador.rotation.y = angulo;
    } else if (abertura.tipo === "janela") {
      peca(w, h, 0.012, vidro, base);
      peca(w, 0.04, t * 0.6, aluminio, base); peca(w, 0.04, t * 0.6, aluminio, base + h - 0.04);
      peca(0.04, h, t * 0.6, aluminio, base, -w / 2 + 0.02); peca(0.04, h, t * 0.6, aluminio, base, w / 2 - 0.02); peca(0.03, h, t * 0.5, aluminio, base);
    } else if (abertura.tipo === "portao") {
      peca(w, h, 0.05, c.mat(0xcfd2d4, { rugosidade: 0.5, metal: 0.3 }), 0);
      for (let i = 1; i < 8; i += 1) peca(w, 0.01, 0.06, c.mat(0x9da1a4), (h * i) / 8);
    }
  }
}

export function montarCena(three: Three, doc: LayoutConteudo) {
  const c = new Construtor(three);
  const g = new three.Group();
  const parede = c.mat(0xf1ede4, { rugosidade: 0.9 });
  for (const comodo of doc.comodos) {
    const forma = new three.Shape(comodo.pontos.map((p) => new three.Vector2(m(p.x), -m(p.y))));
    const malha = new three.Mesh(new three.ShapeGeometry(forma), new three.MeshStandardMaterial({ map: texturaDoPiso(three, comodo.piso), roughness: comodo.piso === "porcelanato" ? 0.35 : 0.85 }));
    malha.rotation.x = -Math.PI / 2; malha.position.y = 0.012; malha.receiveShadow = true;
    g.add(malha);
  }
  for (const item of doc.paredes) levantarParede(c, g, item, doc.aberturas, parede);
  for (const item of doc.itens) {
    const base = itemDoCatalogo(item.catalogo);
    if (base) g.add(modeloDoItem(c, item, base));
  }
  return g;
}
