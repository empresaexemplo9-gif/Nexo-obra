// DADOS FICTÍCIOS DA DEMONSTRAÇÃO PÚBLICA.
//
// A pasta `lib/demonstracao/` é o único lugar do runtime onde existe dado inventado, e só
// a rota `/demonstracao` o usa. Ele nunca alimenta API, banco ou tela de empresa: a
// demonstração roda inteira no navegador do visitante e some ao fechar a aba. Os
// cadastros fictícios estão em `respostas.json`; aqui fica o desenho de exemplo do CAD.
// `tests/demonstracao.test.mjs` garante que nenhum outro módulo importa desta pasta.

import { documentoSchema, documentoVazio, type Documento, type Elemento } from "@/lib/prancheta";

/**
 * Planta de exemplo do Editor CAD: sala, cozinha, quarto e banheiro, em milímetros, com
 * pontos elétricos, luminárias e cotas — cada disciplina na camada dela, para o
 * visitante ligar e desligar. Passa pelo mesmo esquema que valida uma prancha real.
 */
export function plantaDeExemplo(): Documento {
  const doc = documentoVazio();
  let n = 0;
  const id = () => `demo-${(n += 1)}`;
  const el: Elemento[] = [];
  const parede = (ax: number, ay: number, bx: number, by: number, espessuraMm = 150) => el.push({ id: id(), camada: "layout", tipo: "parede", a: { x: ax, y: ay }, b: { x: bx, y: by }, espessuraMm });
  const comodo = (x1: number, y1: number, x2: number, y2: number, nome: string) => el.push({ id: id(), camada: "layout", tipo: "comodo", nome, pontos: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }] });
  const abertura = (especie: "porta" | "janela", x: number, y: number, larguraMm: number, rotacaoGraus = 0) => el.push({ id: id(), camada: "layout", tipo: "abertura", especie, posicao: { x, y }, larguraMm, rotacaoGraus });
  const simbolo = (camada: "eletrico" | "luminotecnico", familia: string, x: number, y: number, rotacaoGraus = 0) => el.push({ id: id(), camada, tipo: "simbolo", familia, posicao: { x, y }, rotacaoGraus });
  const movel = (rotulo: string, x: number, y: number, larguraMm: number, alturaMm: number) => el.push({ id: id(), camada: "mobiliario", tipo: "mobilia", rotulo, posicao: { x, y }, larguraMm, alturaMm, rotacaoGraus: 0 });
  const cota = (ax: number, ay: number, bx: number, by: number, deslocamentoMm: number) => el.push({ id: id(), camada: "anotacao", tipo: "cota", a: { x: ax, y: ay }, b: { x: bx, y: by }, deslocamentoMm });

  comodo(0, 0, 5000, 4000, "Sala");
  comodo(5000, 0, 8000, 4000, "Cozinha");
  comodo(0, 4000, 4500, 7500, "Quarto");
  comodo(4500, 4000, 8000, 7500, "Banheiro e serviço");
  // Contorno e divisórias.
  parede(0, 0, 8000, 0); parede(8000, 0, 8000, 7500); parede(8000, 7500, 0, 7500); parede(0, 7500, 0, 0);
  parede(5000, 0, 5000, 4000, 120); parede(0, 4000, 8000, 4000, 120); parede(4500, 4000, 4500, 7500, 120);
  abertura("porta", 1200, 0, 900); abertura("janela", 3400, 0, 1800); abertura("janela", 6500, 0, 1200);
  abertura("porta", 2200, 4000, 800); abertura("porta", 6000, 4000, 700); abertura("janela", 2200, 7500, 1500);
  abertura("porta", 5000, 2000, 800, 90);

  movel("Sofá", 2500, 3300, 2200, 900); movel("Rack", 2500, 500, 1800, 450); movel("Mesa 4 lugares", 6500, 2600, 1200, 1200);
  movel("Bancada", 6500, 450, 2600, 600); movel("Cama casal", 2250, 6300, 1600, 2000); movel("Guarda-roupa", 500, 5600, 600, 2200);

  simbolo("eletrico", "tomada-baixa", 300, 1500); simbolo("eletrico", "tomada-baixa", 4700, 2800); simbolo("eletrico", "tv", 2500, 250);
  simbolo("eletrico", "tomada-media", 6000, 250); simbolo("eletrico", "tomada-media", 7200, 250); simbolo("eletrico", "interruptor-simples", 1900, 250);
  simbolo("eletrico", "tomada-baixa", 300, 6000); simbolo("eletrico", "interruptor-simples", 2900, 4250); simbolo("eletrico", "quadro", 7750, 5200, 90);
  simbolo("luminotecnico", "plafon", 2500, 2000); simbolo("luminotecnico", "pendente", 6500, 2600); simbolo("luminotecnico", "plafon", 2250, 5750);
  simbolo("luminotecnico", "spot", 5600, 5750); simbolo("luminotecnico", "spot", 7000, 5750);

  cota(0, 0, 8000, 0, -900); cota(0, 0, 0, 7500, 900);
  el.push({ id: id(), camada: "anotacao", tipo: "texto", posicao: { x: 0, y: -1800 }, texto: "PLANTA DE EXEMPLO — desenhe, mova e apague à vontade", alturaMm: 220, rotacaoGraus: 0 });

  return documentoSchema.parse({ ...doc, elementos: el });
}
