import { Documento, Elemento, areaM2, elementosVisiveis, perimetroM } from "@/lib/prancheta";

// Parâmetros de cálculo da plataforma.
//
// ## Dois grupos, que se comportam de forma diferente
//
// 1. NORMATIVO — regra de norma técnica. Muda quando a ABNT revisa a norma, o que leva
//    anos. A NBR 5410 é de 2004; a NBR 9050, de 2020. Fica escrito aqui, com o item exato
//    da norma, e uma rotina confere periodicamente se a fonte publicou revisão.
//
// 2. ECONÔMICO — preço, índice, encargo. Muda todo mês. NADA disso é escrito aqui: vem da
//    ingestão real do SINAPI, que já existe em `lib/server/sinapi-sync.ts`. Preço de
//    memória num orçamento é o pior tipo de erro, porque tem cara de informação.
//
// Este arquivo é só o grupo 1. É o que permite a plataforma RACIOCINAR sobre o desenho:
// contar quantas tomadas a sala precisa, conferir se a porta passa cadeira de rodas,
// dizer que falta ponto de luz — tudo derivado da geometria, sem ninguém digitar nada.
//
// Cada parâmetro carrega o item da norma. Sem isso ele vira número mágico, e número
// mágico num orçamento ninguém consegue defender na frente do cliente.

export type Fonte = {
  id: string;
  nome: string;
  /** Página oficial que publica a norma e o seu estado de vigência. */
  url: string;
  /** Revisão em vigor quando estes parâmetros foram escritos. */
  revisao: string;
  /** Com que frequência esta fonte costuma mudar — orienta o intervalo da conferência. */
  ritmo: "anos" | "anual" | "mensal";
};

export const FONTES: Fonte[] = [
  {
    id: "nbr-5410",
    nome: "ABNT NBR 5410 — Instalações elétricas de baixa tensão",
    url: "https://www.abntcatalogo.com.br/pnm.aspx?Q=WjJRcmJHUlFhbTVGUFE9PQ==",
    revisao: "2004 (Versão Corrigida 2008)",
    ritmo: "anos",
  },
  {
    id: "nbr-9050",
    nome: "ABNT NBR 9050 — Acessibilidade a edificações, mobiliário, espaços e equipamentos urbanos",
    url: "https://www.abntcatalogo.com.br/norma.aspx?ID=449128",
    revisao: "2020 (3ª edição)",
    ritmo: "anos",
  },
];

export type Parametro = {
  id: string;
  fonteId: string;
  /** Item da norma, para quem quiser conferir. */
  item: string;
  descricao: string;
  valor: number;
  unidade: "mm" | "m" | "m2" | "VA" | "pontos";
};

// ## NBR 5410:2004 — item 9.5.2, previsão de carga em unidades residenciais
//
// Os valores abaixo são mínimos da norma. A plataforma usa como PISO: desenhar mais do
// que o mínimo é projeto, desenhar menos é não conformidade.

export const PARAMETROS: Parametro[] = [
  { id: "eletrico.area-comodo-pequeno", fonteId: "nbr-5410", item: "9.5.2.2.1 a)", descricao: "Área até a qual basta um ponto de tomada", valor: 6, unidade: "m2" },
  { id: "eletrico.perimetro-por-tomada", fonteId: "nbr-5410", item: "9.5.2.2.1 b)", descricao: "Perímetro por ponto de tomada em cômodo comum", valor: 5, unidade: "m" },
  { id: "eletrico.perimetro-por-tomada-molhada", fonteId: "nbr-5410", item: "9.5.2.2.1 c)", descricao: "Perímetro por ponto de tomada em cozinha, copa e área de serviço", valor: 3.5, unidade: "m" },
  { id: "eletrico.tomadas-minimas-bancada", fonteId: "nbr-5410", item: "9.5.2.2.1 c)", descricao: "Tomadas mínimas acima de bancada com 30 cm ou mais", valor: 2, unidade: "pontos" },
  { id: "eletrico.afastamento-box", fonteId: "nbr-5410", item: "9.5.2.2.1 d)", descricao: "Afastamento mínimo da tomada do banheiro em relação ao box", valor: 600, unidade: "mm" },
  { id: "eletrico.va-ponto-molhado", fonteId: "nbr-5410", item: "9.5.2.2.2 a)", descricao: "Potência dos três primeiros pontos em área molhada", valor: 600, unidade: "VA" },
  { id: "eletrico.va-ponto-comum", fonteId: "nbr-5410", item: "9.5.2.2.2 b)", descricao: "Potência por ponto de tomada nos demais cômodos", valor: 100, unidade: "VA" },
  { id: "iluminacao.va-base", fonteId: "nbr-5410", item: "9.5.2.1.2", descricao: "Carga de iluminação para os primeiros 6 m²", valor: 100, unidade: "VA" },
  { id: "iluminacao.va-adicional", fonteId: "nbr-5410", item: "9.5.2.1.2", descricao: "Acréscimo de carga a cada 4 m² inteiros excedentes", valor: 60, unidade: "VA" },
  { id: "iluminacao.area-adicional", fonteId: "nbr-5410", item: "9.5.2.1.2", descricao: "Passo de área para o acréscimo de iluminação", valor: 4, unidade: "m2" },

  { id: "acessibilidade.vao-porta", fonteId: "nbr-9050", item: "6.11.2.3", descricao: "Vão livre mínimo de porta", valor: 800, unidade: "mm" },
  { id: "acessibilidade.giro-360", fonteId: "nbr-9050", item: "6.12.3", descricao: "Diâmetro do círculo para rotação de 360°", valor: 1500, unidade: "mm" },
  { id: "acessibilidade.modulo-referencia-largura", fonteId: "nbr-9050", item: "6.12.1", descricao: "Largura do módulo de referência (cadeira de rodas)", valor: 800, unidade: "mm" },
  { id: "acessibilidade.modulo-referencia-comprimento", fonteId: "nbr-9050", item: "6.12.1", descricao: "Comprimento do módulo de referência", valor: 1200, unidade: "mm" },
  { id: "acessibilidade.faixa-curta", fonteId: "nbr-9050", item: "6.12.2", descricao: "Largura livre para deslocamento em linha reta até 4,00 m", valor: 900, unidade: "mm" },
  { id: "acessibilidade.faixa-media", fonteId: "nbr-9050", item: "6.12.2", descricao: "Largura livre para deslocamento em linha reta até 10,00 m", valor: 1200, unidade: "mm" },
  { id: "acessibilidade.faixa-longa", fonteId: "nbr-9050", item: "6.12.2", descricao: "Largura livre para deslocamento em linha reta acima de 10,00 m", valor: 1500, unidade: "mm" },
];

export const parametro = (id: string) => PARAMETROS.find((item) => item.id === id)!;
const valor = (id: string) => parametro(id).valor;

// ## Classificação do cômodo pelo nome
//
// A norma trata cozinha, copa, área de serviço e banheiro diferente do resto. O nome que
// a pessoa escreveu no cômodo é o que temos, e é o que ela usaria para explicar o desenho
// a outra pessoa. Quando o nome não diz nada, o cômodo é tratado como comum — a regra
// mais permissiva —, e isso é DITO, para ninguém confiar numa conferência que não houve.

export type EspecieComodo = "molhado" | "banheiro" | "comum" | "indefinido";

export function especieDoComodo(nome: string): EspecieComodo {
  const limpo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!limpo) return "indefinido";
  if (/(banheiro|lavabo|wc|sanitario|toalete|banho)/.test(limpo)) return "banheiro";
  if (/(cozinha|copa|area de servico|lavanderia|servico|despensa|churrasqueira|gourmet)/.test(limpo)) return "molhado";
  return "comum";
}

/** Ponto dentro do polígono, pelo número de cruzamentos. É o que permite dizer a que
 *  cômodo cada tomada pertence sem ninguém precisar amarrar uma coisa na outra. */
export function dentroDoPoligono(ponto: { x: number; y: number }, pontos: { x: number; y: number }[]): boolean {
  let dentro = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i, i += 1) {
    const um = pontos[i];
    const outro = pontos[j];
    const cruza = (um.y > ponto.y) !== (outro.y > ponto.y)
      && ponto.x < (outro.x - um.x) * (ponto.y - um.y) / (outro.y - um.y) + um.x;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

export type ExigenciaComodo = {
  nome: string;
  especie: EspecieComodo;
  areaM2: number;
  perimetroM: number;
  tomadasMinimas: number;
  pontosDeLuzMinimos: number;
  cargaIluminacaoVa: number;
  cargaTomadasVa: number;
};

/** O que a norma exige de um cômodo, derivado da área e do perímetro desenhados. */
export function exigenciaDoComodo(nome: string, area: number, perimetro: number): ExigenciaComodo {
  const especie = especieDoComodo(nome);

  // Tomadas: um ponto até 6 m²; acima disso, um a cada 5 m de perímetro OU FRAÇÃO — e a
  // fração conta, por isso é `ceil`. Em área molhada o passo é 3,5 m.
  const molhado = especie === "molhado";
  let tomadas: number;
  if (especie === "banheiro") {
    tomadas = 1; // 9.5.2.2.1 d): pelo menos um ponto junto ao lavatório.
  } else if (molhado) {
    tomadas = Math.max(1, Math.ceil(perimetro / valor("eletrico.perimetro-por-tomada-molhada")));
  } else if (area <= valor("eletrico.area-comodo-pequeno")) {
    tomadas = 1;
  } else {
    tomadas = Math.max(1, Math.ceil(perimetro / valor("eletrico.perimetro-por-tomada")));
  }

  // Carga: 600 VA nos três primeiros pontos de área molhada e banheiro, 100 VA no resto.
  const areaMolhada = molhado || especie === "banheiro";
  const cargaTomadas = areaMolhada
    ? Math.min(3, tomadas) * valor("eletrico.va-ponto-molhado") + Math.max(0, tomadas - 3) * valor("eletrico.va-ponto-comum")
    : tomadas * valor("eletrico.va-ponto-comum");

  // Iluminação: 100 VA nos primeiros 6 m², mais 60 VA a cada 4 m² INTEIROS excedentes —
  // inteiros, por isso é `floor`. Trocar por `ceil` inflaria o quadro de cargas.
  const excedente = Math.max(0, area - valor("eletrico.area-comodo-pequeno"));
  const cargaIluminacao = valor("iluminacao.va-base")
    + Math.floor(excedente / valor("iluminacao.area-adicional")) * valor("iluminacao.va-adicional");

  return {
    nome: nome || "Sem nome",
    especie,
    areaM2: Math.round(area * 100) / 100,
    perimetroM: Math.round(perimetro * 100) / 100,
    tomadasMinimas: tomadas,
    pontosDeLuzMinimos: 1, // 9.5.2.1.1: pelo menos um ponto de luz no teto por cômodo.
    cargaIluminacaoVa: cargaIluminacao,
    cargaTomadasVa: cargaTomadas,
  };
}

export type Achado = {
  severidade: "falta" | "atencao" | "informacao";
  parametroId: string;
  item: string;
  comodo?: string;
  mensagem: string;
};

export type Conferencia = {
  comodos: (ExigenciaComodo & { tomadasDesenhadas: number; pontosDeLuzDesenhados: number })[];
  achados: Achado[];
  cargaTotalVa: number;
};

const FAMILIAS_TOMADA = new Set(["tomada-baixa", "tomada-media", "tomada-alta"]);
const FAMILIAS_LUZ = new Set(["plafon", "spot", "pendente", "arandela", "fita-led", "sanca"]);

/**
 * Confere o desenho contra a norma.
 *
 * Só olha o que está desenhado: cômodo que não virou polígono não existe para a
 * conferência, e isso é dito em vez de a tela devolver "tudo certo" sobre nada.
 *
 * Nenhum achado altera o desenho. A conferência aponta; quem decide é quem projeta —
 * norma tem exceção, e uma ferramenta que "corrige" sozinha destrói projeto.
 */
export function conferir(documento: Documento): Conferencia {
  const visiveis = elementosVisiveis(documento);
  const comodos = visiveis.filter((elemento): elemento is Extract<Elemento, { tipo: "comodo" }> => elemento.tipo === "comodo");
  const simbolos = visiveis.filter((elemento): elemento is Extract<Elemento, { tipo: "simbolo" }> => elemento.tipo === "simbolo");
  const aberturas = visiveis.filter((elemento): elemento is Extract<Elemento, { tipo: "abertura" }> => elemento.tipo === "abertura");

  const achados: Achado[] = [];
  const linhas: Conferencia["comodos"] = [];

  if (!comodos.length) {
    achados.push({
      severidade: "informacao",
      parametroId: "eletrico.perimetro-por-tomada",
      item: "9.5.2",
      mensagem: "Nenhum cômodo desenhado. A conferência elétrica sai da área e do perímetro do cômodo — desenhe os cômodos para que ela valha alguma coisa.",
    });
  }

  for (const comodo of comodos) {
    const area = areaM2(comodo.pontos);
    const perimetro = perimetroM(comodo.pontos);
    const exigencia = exigenciaDoComodo(comodo.nome, area, perimetro);
    const dentro = simbolos.filter((simbolo) => dentroDoPoligono(simbolo.posicao, comodo.pontos));
    const tomadas = dentro.filter((simbolo) => FAMILIAS_TOMADA.has(simbolo.familia)).length;
    const luzes = dentro.filter((simbolo) => FAMILIAS_LUZ.has(simbolo.familia)).length;
    linhas.push({ ...exigencia, tomadasDesenhadas: tomadas, pontosDeLuzDesenhados: luzes });

    if (exigencia.especie === "indefinido") {
      achados.push({
        severidade: "atencao",
        parametroId: "eletrico.perimetro-por-tomada",
        item: "9.5.2.2.1",
        comodo: exigencia.nome,
        mensagem: "Cômodo sem nome: foi conferido como cômodo comum. Cozinha, copa, área de serviço e banheiro têm regra própria — nomeie o cômodo para a conferência valer.",
      });
    }
    if (tomadas < exigencia.tomadasMinimas) {
      achados.push({
        severidade: "falta",
        parametroId: exigencia.especie === "molhado" ? "eletrico.perimetro-por-tomada-molhada" : "eletrico.perimetro-por-tomada",
        item: "9.5.2.2.1",
        comodo: exigencia.nome,
        mensagem: `${exigencia.tomadasMinimas} ponto(s) de tomada no mínimo; ${tomadas} desenhado(s). Com ${exigencia.perimetroM.toFixed(2).replace(".", ",")} m de perímetro.`,
      });
    }
    if (luzes < exigencia.pontosDeLuzMinimos) {
      achados.push({
        severidade: "falta",
        parametroId: "iluminacao.va-base",
        item: "9.5.2.1.1",
        comodo: exigencia.nome,
        mensagem: "Falta o ponto de luz no teto, comandado por interruptor de parede.",
      });
    }
    if (exigencia.especie === "molhado" && tomadas < valor("eletrico.tomadas-minimas-bancada")) {
      achados.push({
        severidade: "atencao",
        parametroId: "eletrico.tomadas-minimas-bancada",
        item: "9.5.2.2.1 c)",
        comodo: exigencia.nome,
        mensagem: "Bancada com 30 cm ou mais exige pelo menos duas tomadas acima dela. Confira se há bancada neste cômodo.",
      });
    }
  }

  for (const abertura of aberturas) {
    if (abertura.especie !== "porta") continue;
    if (abertura.larguraMm < valor("acessibilidade.vao-porta")) {
      achados.push({
        severidade: "falta",
        parametroId: "acessibilidade.vao-porta",
        item: "6.11.2.3",
        mensagem: `Porta com ${abertura.larguraMm} mm de vão. A NBR 9050 exige ${valor("acessibilidade.vao-porta")} mm livres — e o vão LIVRE é menor que a largura nominal da folha, então confira a medida real.`,
      });
    }
  }

  const cargaTotal = linhas.reduce((soma, linha) => soma + linha.cargaIluminacaoVa + linha.cargaTomadasVa, 0);
  return { comodos: linhas, achados, cargaTotalVa: cargaTotal };
}
