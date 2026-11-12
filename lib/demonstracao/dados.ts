// DADOS FICTÍCIOS DA DEMONSTRAÇÃO PÚBLICA.
//
// Este arquivo é o único lugar do runtime onde existe dado inventado, e só a rota
// `/demonstracao` o importa. Ele nunca alimenta API, banco ou tela de empresa: a
// demonstração roda inteira na memória do navegador do visitante e some ao fechar a aba.
// A empresa, as pessoas e os valores abaixo não existem. `tests/demonstracao.test.mjs`
// garante que nenhum outro módulo importa daqui.

import { documentoSchema, documentoVazio, type Documento, type Elemento } from "@/lib/prancheta";

export const EMPRESA_EXEMPLO = "Escritório Modelo Arquitetura";

export type EtapaFunil = "contato" | "proposta" | "negociacao" | "fechado";
export const etapasFunil: { id: EtapaFunil; nome: string }[] = [
  { id: "contato", nome: "Primeiro contato" },
  { id: "proposta", nome: "Proposta enviada" },
  { id: "negociacao", nome: "Negociação" },
  { id: "fechado", nome: "Fechado" },
];

export type ProjetoExemplo = { id: string; codigo: string; nome: string; cliente: string; tipo: "Projeto" | "Obra"; etapa: string; avanco: number; entrega: string; orcadoCentavos: number; realizadoCentavos: number };
export const projetosExemplo: ProjetoExemplo[] = [
  { id: "p1", codigo: "PRJ-014", nome: "Casa Jardim das Acácias", cliente: "Família Exemplo Andrade", tipo: "Obra", etapa: "Alvenaria e instalações", avanco: 46, entrega: "2027-03-20", orcadoCentavos: 68_400_000, realizadoCentavos: 30_150_000 },
  { id: "p2", codigo: "PRJ-017", nome: "Apartamento Vista Parque", cliente: "Cliente Exemplo Moreira", tipo: "Projeto", etapa: "Projeto executivo", avanco: 72, entrega: "2026-12-18", orcadoCentavos: 4_200_000, realizadoCentavos: 2_940_000 },
  { id: "p3", codigo: "PRJ-019", nome: "Consultório Bem Viver", cliente: "Empresa Exemplo Saúde Ltda.", tipo: "Obra", etapa: "Acabamentos", avanco: 88, entrega: "2026-11-30", orcadoCentavos: 21_900_000, realizadoCentavos: 20_480_000 },
  { id: "p4", codigo: "PRJ-021", nome: "Loja Conceito Centro", cliente: "Empresa Exemplo Varejo Ltda.", tipo: "Projeto", etapa: "Estudo preliminar", avanco: 18, entrega: "2027-01-29", orcadoCentavos: 3_600_000, realizadoCentavos: 540_000 },
];

export type TarefaExemplo = { id: string; titulo: string; projeto: string; responsavel: string; prazo: string; atrasada: boolean; feita: boolean };
export const tarefasExemplo: TarefaExemplo[] = [
  { id: "t1", titulo: "Aprovar amostra do porcelanato com o cliente", projeto: "PRJ-019", responsavel: "Ana (exemplo)", prazo: "Ontem", atrasada: true, feita: false },
  { id: "t2", titulo: "Enviar revisão 3 do projeto elétrico", projeto: "PRJ-017", responsavel: "Bruno (exemplo)", prazo: "Hoje", atrasada: false, feita: false },
  { id: "t3", titulo: "Conferir medição da alvenaria do térreo", projeto: "PRJ-014", responsavel: "Carla (exemplo)", prazo: "Hoje", atrasada: false, feita: false },
  { id: "t4", titulo: "Cotar esquadrias com três fornecedores", projeto: "PRJ-014", responsavel: "Bruno (exemplo)", prazo: "Em 2 dias", atrasada: false, feita: false },
  { id: "t5", titulo: "Montar prancha de layout para a reunião", projeto: "PRJ-021", responsavel: "Ana (exemplo)", prazo: "Em 3 dias", atrasada: false, feita: false },
  { id: "t6", titulo: "Registrar diário de obra com fotos", projeto: "PRJ-019", responsavel: "Carla (exemplo)", prazo: "Feita", atrasada: false, feita: true },
];

export type OportunidadeExemplo = { id: string; nome: string; contato: string; valorCentavos: number; etapa: EtapaFunil };
export const oportunidadesExemplo: OportunidadeExemplo[] = [
  { id: "o1", nome: "Reforma de cobertura", contato: "Contato Exemplo 1", valorCentavos: 18_500_000, etapa: "contato" },
  { id: "o2", nome: "Projeto de interiores — escritório", contato: "Contato Exemplo 2", valorCentavos: 6_800_000, etapa: "proposta" },
  { id: "o3", nome: "Casa de campo 240 m²", contato: "Contato Exemplo 3", valorCentavos: 92_000_000, etapa: "negociacao" },
  { id: "o4", nome: "Retrofit de fachada", contato: "Contato Exemplo 4", valorCentavos: 31_000_000, etapa: "proposta" },
];

export type ItemOrcamentoExemplo = { id: string; descricao: string; unidade: string; quantidade: number; custoCentavos: number };
export const itensOrcamentoExemplo: ItemOrcamentoExemplo[] = [
  { id: "i1", descricao: "Alvenaria de vedação em bloco cerâmico", unidade: "m²", quantidade: 186, custoCentavos: 9_850 },
  { id: "i2", descricao: "Contrapiso em argamassa, 4 cm", unidade: "m²", quantidade: 142, custoCentavos: 4_620 },
  { id: "i3", descricao: "Porcelanato 80×80 assentado", unidade: "m²", quantidade: 118, custoCentavos: 18_900 },
  { id: "i4", descricao: "Ponto de tomada completo", unidade: "un", quantidade: 64, custoCentavos: 14_300 },
  { id: "i5", descricao: "Pintura acrílica, duas demãos", unidade: "m²", quantidade: 410, custoCentavos: 3_240 },
];
export const BDI_EXEMPLO = 25;

/** Total de venda do orçamento de exemplo: custo dos itens mais o BDI, em centavos. */
export function totalDoOrcamento(itens: ItemOrcamentoExemplo[], bdi: number) {
  const custo = itens.reduce((soma, item) => soma + Math.round(item.quantidade * item.custoCentavos), 0);
  return { custo, venda: Math.round(custo * (1 + bdi / 100)) };
}

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
