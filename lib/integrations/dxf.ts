import { Camada, Disciplina, Elemento, elementoSchema } from "@/lib/prancheta";

// Leitor de DXF escrito do zero, sem dependência.
//
// ## Por que DXF e não DWG
//
// DWG é formato proprietário, binário e sem especificação publicada pela Autodesk. O que
// existe é engenharia reversa, e um leitor escrito de memória erraria em silêncio — o
// pior defeito possível aqui, porque uma planta lida torto só aparece na obra. DXF é o
// contrário: é texto, é documentado, e todo programa de CAD exporta. Então o leitor é
// deste, e o DWG recebe uma resposta que diz a versão do arquivo e o que fazer.
//
// ## Como o DXF é
//
// O arquivo é uma sequência de PARES de linhas: um código de grupo inteiro e o valor.
// `0` abre uma entidade, `8` nomeia a camada, `10/20/30` são coordenadas. É só isso —
// toda a complexidade está em saber o que cada código significa em cada entidade.
//
// ## O que este leitor promete e o que não promete
//
// Ele traz GEOMETRIA, não semântica. Uma linha no DXF não diz se é parede, eixo ou
// hachura; inventar "parede" a partir de linha seria fabricar informação que o arquivo
// não tem. Então tudo entra como traço, na camada correspondente à do arquivo, e quem
// desenha decide o que virar o quê. O que o leitor não souber ler, ele declara.

export const UNIDADES = {
  mm: 1, cm: 10, m: 1000, polegada: 25.4, pe: 304.8,
} as const;
export type Unidade = keyof typeof UNIDADES;

export const unidadeLabels: Record<Unidade, string> = {
  mm: "Milímetro", cm: "Centímetro", m: "Metro", polegada: "Polegada", pe: "Pé",
};

// $INSUNITS do cabeçalho do DXF. Os que não estão aqui não aparecem em planta de
// arquitetura, e chutar um deles seria pior do que perguntar.
const INSUNITS: Record<number, Unidade> = {
  1: "polegada", 2: "pe", 4: "mm", 5: "cm", 6: "m",
};

const LIMITE_ELEMENTOS = 6000;
const LIMITE_PONTOS = 2000;
const MAX_MM = 2_000_000_000;

export type Par = { codigo: number; valor: string };

/** Separa o arquivo em pares código/valor. É a única função que conhece o formato de
 *  linha; tudo depois disso trabalha em cima dos pares. */
export function pares(texto: string): Par[] {
  const linhas = texto.split(/\r\n|\r|\n/);
  const saida: Par[] = [];
  let i = 0;
  // Linha que não é um código anda UMA, não duas: assim o leitor volta ao passo certo
  // depois de uma linha estranha, em vez de trocar código por valor até o fim do arquivo.
  while (i + 1 < linhas.length) {
    const bruto = linhas[i].trim();
    if (!/^-?\d+$/.test(bruto)) { i += 1; continue; }
    saida.push({ codigo: Number.parseInt(bruto, 10), valor: linhas[i + 1] ?? "" });
    i += 2;
  }
  return saida;
}

type Entidade = { tipo: string; pares: Par[] };

const numeroDe = (entidade: Entidade, codigo: number, padrao: number) => {
  const encontrado = entidade.pares.find((par) => par.codigo === codigo);
  const valor = encontrado ? Number.parseFloat(encontrado.valor) : NaN;
  return Number.isFinite(valor) ? valor : padrao;
};
const textoDe = (entidade: Entidade, codigo: number, padrao = "") =>
  entidade.pares.find((par) => par.codigo === codigo)?.valor ?? padrao;

/** Vértices de uma entidade, na ordem em que os códigos 10 e 20 aparecem. Ler todos os
 *  10 primeiro e depois todos os 20 embaralharia o polígono em qualquer arquivo real. */
function vertices(entidade: Entidade): { x: number; y: number }[] {
  const pontos: { x: number; y: number }[] = [];
  let atual: { x: number; y: number } | null = null;
  for (const par of entidade.pares) {
    if (par.codigo === 10) {
      if (atual) pontos.push(atual);
      atual = { x: Number.parseFloat(par.valor) || 0, y: 0 };
    } else if (par.codigo === 20 && atual) {
      atual.y = Number.parseFloat(par.valor) || 0;
    }
  }
  if (atual) pontos.push(atual);
  return pontos;
}

/** Arco e círculo viram segmentos. O passo é escolhido pela flecha: com 1 mm de desvio
 *  máximo, a curva impressa não se distingue de uma curva de verdade, e o arquivo não
 *  incha com mil pontos por circunferência. */
function arco(centro: { x: number; y: number }, raio: number, grausInicio: number, grausFim: number, escala: number) {
  const raioMm = Math.abs(raio) * escala;
  if (raioMm <= 0) return [];
  const passos = Math.min(180, Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - 1 / raioMm))))));
  // Varredura zero significa circunferência inteira: é assim que CIRCLE chega aqui.
  const bruto = ((grausFim - grausInicio) % 360 + 360) % 360;
  const varredura = bruto === 0 ? 360 : bruto;
  const quantos = Math.max(2, Math.ceil(passos * varredura / 360));
  const pontos: { x: number; y: number }[] = [];
  for (let i = 0; i <= quantos; i += 1) {
    const angulo = (grausInicio + varredura * i / quantos) * Math.PI / 180;
    pontos.push({ x: centro.x + raio * Math.cos(angulo), y: centro.y + raio * Math.sin(angulo) });
  }
  return pontos;
}

// Nome de camada do CAD costuma dizer a disciplina: A-PAREDE, ELE-TOMADAS, ILU-TETO.
// O palpite adianta o trabalho e fica visível no painel de camadas, onde é corrigido em
// um clique — diferente de um palpite escondido, que ninguém descobre que existe.
function disciplinaPeloNome(nome: string): Disciplina {
  const limpo = nome.toLowerCase();
  if (/(elet|elét|tomad|interrup|energia|forca|força|quadro)/.test(limpo)) return "eletrico";
  if (/(lumin|ilumin|luz|spot|teto|forro)/.test(limpo)) return "luminotecnico";
  if (/(mobil|movel|móvel|moveis|móveis|interior|layout-mob)/.test(limpo)) return "mobiliario";
  if (/(cota|dim|texto|text|anota|legenda|carimbo|eixo)/.test(limpo)) return "anotacao";
  return "layout";
}

const identificador = (nome: string, usados: Set<string>) => {
  const base = `dxf-${nome.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "camada"}`.slice(0, 56);
  let candidato = base;
  let n = 2;
  while (usados.has(candidato)) { candidato = `${base}-${n}`; n += 1; }
  usados.add(candidato);
  return candidato;
};

export type Importacao = {
  camadas: Camada[];
  elementos: Elemento[];
  /** Unidade que foi de fato usada na conversão, e se ela veio do arquivo ou de fora. */
  unidade: Unidade;
  unidadeDeclarada: boolean;
  /** Tudo que o leitor não trouxe, dito com nome. Um arquivo que perde metade das
   *  entidades em silêncio é pior do que um arquivo que não abre. */
  avisos: string[];
  ignorados: Record<string, number>;
  truncado: boolean;
};

export class DxfInvalido extends Error {}

/**
 * Lê um DXF em texto e devolve camadas e elementos já em milímetros inteiros.
 *
 * O eixo Y é invertido: no DXF ele cresce para cima e aqui para baixo. Sem essa inversão
 * a planta entra espelhada — e espelhada é o tipo de erro que passa despercebido até
 * alguém executar a obra pelo desenho.
 */
export function lerDxf(texto: string, opcoes: { unidade?: Unidade } = {}): Importacao {
  if (texto.startsWith("AutoCAD Binary DXF")) {
    throw new DxfInvalido("Este é um DXF binário. Exporte de novo como DXF ASCII (opção “DXF R12/2013 ASCII”).");
  }
  const lista = pares(texto);
  if (!lista.length) throw new DxfInvalido("O arquivo não tem pares de código DXF. Confirme que é mesmo um DXF em texto.");

  // Cabeçalho: unidade declarada pelo arquivo.
  let unidadeDoArquivo: Unidade | null = null;
  for (let i = 0; i < lista.length - 1; i += 1) {
    if (lista[i].codigo === 9 && lista[i].valor.trim() === "$INSUNITS") {
      const seguinte = lista.slice(i + 1, i + 4).find((par) => par.codigo === 70);
      const codigo = seguinte ? Number.parseInt(seguinte.valor.trim(), 10) : NaN;
      unidadeDoArquivo = INSUNITS[codigo] ?? null;
      break;
    }
  }
  const unidade = opcoes.unidade ?? unidadeDoArquivo ?? "mm";
  const escala = UNIDADES[unidade];

  // Entidades por seção. BLOCKS guarda os desenhos reaproveitados; ENTITIES é o desenho.
  const blocos = new Map<string, Entidade[]>();
  const entidades: Entidade[] = [];
  let secao = "";
  let blocoAtual: { nome: string; base: { x: number; y: number }; itens: Entidade[] } | null = null;
  let atual: Entidade | null = null;

  const guardar = () => {
    if (!atual) return;
    if (blocoAtual) blocoAtual.itens.push(atual);
    else if (secao === "ENTITIES") entidades.push(atual);
    atual = null;
  };

  for (let i = 0; i < lista.length; i += 1) {
    const par = lista[i];
    if (par.codigo !== 0) { atual?.pares.push(par); continue; }
    const marca = par.valor.trim().toUpperCase();
    guardar();
    if (marca === "SECTION") {
      secao = lista.slice(i + 1, i + 4).find((seguinte) => seguinte.codigo === 2)?.valor.trim().toUpperCase() ?? "";
      continue;
    }
    if (marca === "ENDSEC") { secao = ""; blocoAtual = null; continue; }
    if (marca === "EOF") break;
    if (marca === "BLOCK") {
      const cabecalho: Entidade = { tipo: "BLOCK", pares: [] };
      for (let j = i + 1; j < lista.length && lista[j].codigo !== 0; j += 1) cabecalho.pares.push(lista[j]);
      blocoAtual = {
        nome: textoDe(cabecalho, 2, "").trim(),
        base: { x: numeroDe(cabecalho, 10, 0), y: numeroDe(cabecalho, 20, 0) },
        itens: [],
      };
      continue;
    }
    if (marca === "ENDBLK") {
      if (blocoAtual) {
        // A base do bloco é a origem dele; guardá-la aqui evita repetir a subtração em
        // cada INSERT que o use.
        for (const item of blocoAtual.itens) {
          item.pares.push({ codigo: -1, valor: String(blocoAtual.base.x) });
          item.pares.push({ codigo: -2, valor: String(blocoAtual.base.y) });
        }
        blocos.set(blocoAtual.nome, blocoAtual.itens);
      }
      blocoAtual = null;
      continue;
    }
    atual = { tipo: marca, pares: [] };
  }
  guardar();

  const camadas: Camada[] = [];
  const idsUsados = new Set<string>();
  const porNome = new Map<string, string>();
  const camadaDe = (nome: string): string => {
    const limpo = (nome || "0").trim() || "0";
    const existente = porNome.get(limpo);
    if (existente) return existente;
    if (camadas.length >= 50) return porNome.get("0") ?? camadaDe("0");
    const id = identificador(limpo, idsUsados);
    porNome.set(limpo, id);
    camadas.push({ id, nome: limpo.slice(0, 60), disciplina: disciplinaPeloNome(limpo), visivel: true, bloqueada: false });
    return id;
  };

  const elementos: Elemento[] = [];
  const ignorados: Record<string, number> = {};
  const avisos: string[] = [];
  let truncado = false;
  let sequencia = 0;
  const proximoId = () => `dxf-${(sequencia += 1).toString(36)}`;

  const mm = (valor: number) => {
    const convertido = Math.round(valor * escala);
    const limitado = Math.max(-MAX_MM, Math.min(MAX_MM, Number.isFinite(convertido) ? convertido : 0));
    // `|| 0` normaliza o zero negativo que a inversão do eixo produz. -0 e 0 são o mesmo
    // milímetro, mas não são o mesmo valor para quem compara, e a diferença apareceria
    // como falso conflito na comparação de duas versões do desenho.
    return limitado || 0;
  };
  // Y para baixo: a inversão acontece aqui, uma vez só.
  const ponto = (p: { x: number; y: number }, deslocamento: { x: number; y: number }) => ({
    x: mm(p.x + deslocamento.x), y: mm(-(p.y + deslocamento.y)),
  });

  function guardarElemento(elemento: Elemento) {
    if (elementos.length >= LIMITE_ELEMENTOS) { truncado = true; return; }
    const analisado = elementoSchema.safeParse(elemento);
    if (analisado.success) elementos.push(analisado.data);
    else ignorados.fora_de_faixa = (ignorados.fora_de_faixa ?? 0) + 1;
  }

  function traco(pontos: { x: number; y: number }[], camada: string, espessuraMm = 25) {
    const limpos = pontos.filter((p, i, todos) => i === 0 || p.x !== todos[i - 1].x || p.y !== todos[i - 1].y);
    if (limpos.length < 2) return;
    // Uma polilinha imensa não cabe num elemento só; parte-se mantendo o ponto de
    // emenda, para o traço não abrir buraco.
    for (let i = 0; i < limpos.length - 1; i += LIMITE_PONTOS - 1) {
      const pedaco = limpos.slice(i, i + LIMITE_PONTOS);
      if (pedaco.length >= 2) guardarElemento({ id: proximoId(), camada, tipo: "traco", pontos: pedaco, espessuraMm });
    }
  }

  function converter(entidade: Entidade, deslocamento: { x: number; y: number }, profundidade: number) {
    const base = { x: numeroDe(entidade, -1, 0), y: numeroDe(entidade, -2, 0) };
    const desvio = { x: deslocamento.x - base.x, y: deslocamento.y - base.y };
    const camada = camadaDe(textoDe(entidade, 8, "0"));

    switch (entidade.tipo) {
      case "LINE":
        traco([
          ponto({ x: numeroDe(entidade, 10, 0), y: numeroDe(entidade, 20, 0) }, desvio),
          ponto({ x: numeroDe(entidade, 11, 0), y: numeroDe(entidade, 21, 0) }, desvio),
        ], camada);
        return;
      case "LWPOLYLINE":
      case "POLYLINE": {
        const pontos = vertices(entidade).map((p) => ponto(p, desvio));
        const fechada = (numeroDe(entidade, 70, 0) & 1) === 1;
        traco(fechada && pontos.length > 2 ? [...pontos, pontos[0]] : pontos, camada);
        return;
      }
      case "VERTEX":
      case "SEQEND":
        return; // Já lidos junto da POLYLINE.
      case "CIRCLE":
        traco(arco({ x: numeroDe(entidade, 10, 0), y: numeroDe(entidade, 20, 0) },
          numeroDe(entidade, 40, 0), 0, 360, escala).map((p) => ponto(p, desvio)), camada);
        return;
      case "ARC":
        traco(arco({ x: numeroDe(entidade, 10, 0), y: numeroDe(entidade, 20, 0) }, numeroDe(entidade, 40, 0),
          numeroDe(entidade, 50, 0), numeroDe(entidade, 51, 0), escala).map((p) => ponto(p, desvio)), camada);
        return;
      case "POINT": {
        const centro = ponto({ x: numeroDe(entidade, 10, 0), y: numeroDe(entidade, 20, 0) }, desvio);
        traco([{ x: centro.x - 50, y: centro.y }, { x: centro.x + 50, y: centro.y }], camada, 20);
        traco([{ x: centro.x, y: centro.y - 50 }, { x: centro.x, y: centro.y + 50 }], camada, 20);
        return;
      }
      case "TEXT":
      case "MTEXT": {
        // O MTEXT quebra o conteúdo entre o código 3 (partes) e o 1 (última parte), e
        // carrega códigos de formatação entre chaves que não são texto.
        const partes = entidade.pares.filter((par) => par.codigo === 3).map((par) => par.valor).join("");
        const cru = `${partes}${textoDe(entidade, 1, "")}`;
        const conteudo = cru
          .replace(/\\[A-Za-z][^;]*;/g, "").replace(/[{}]/g, "")
          .replace(/\\P/g, " ").replace(/%%[dcp]/g, "").trim().slice(0, 500);
        if (!conteudo) return;
        const posicao = ponto({ x: numeroDe(entidade, 10, 0), y: numeroDe(entidade, 20, 0) }, desvio);
        const alturaMm = Math.max(10, Math.min(5000, Math.round(numeroDe(entidade, 40, 2.5) * escala)));
        const giro = Math.round(numeroDe(entidade, 50, 0));
        guardarElemento({
          id: proximoId(), camada, tipo: "texto", posicao, texto: conteudo, alturaMm,
          // Giro invertido junto com o eixo.
          rotacaoGraus: ((-giro % 360) + 360) % 360,
        });
        return;
      }
      case "INSERT": {
        const nome = textoDe(entidade, 2, "").trim();
        const itens = blocos.get(nome);
        if (!itens) { ignorados[`bloco ausente: ${nome || "sem nome"}`] = (ignorados[`bloco ausente: ${nome || "sem nome"}`] ?? 0) + 1; return; }
        // Bloco dentro de bloco existe e é legítimo; bloco que se insere a si mesmo,
        // não — e sem este limite o arquivo travaria o servidor.
        if (profundidade >= 8) { ignorados["bloco aninhado demais"] = (ignorados["bloco aninhado demais"] ?? 0) + 1; return; }
        const dentro = {
          x: desvio.x + numeroDe(entidade, 10, 0),
          y: desvio.y + numeroDe(entidade, 20, 0),
        };
        for (const item of itens) converter(item, dentro, profundidade + 1);
        return;
      }
      default:
        ignorados[entidade.tipo] = (ignorados[entidade.tipo] ?? 0) + 1;
    }
  }

  for (const entidade of entidades) converter(entidade, { x: 0, y: 0 }, 0);

  if (!camadas.length) camadaDe("0");
  if (!unidadeDoArquivo) {
    avisos.push(`O arquivo não declara a unidade de desenho. A importação usou ${unidadeLabels[unidade].toLowerCase()}; meça algo conhecido com a cota antes de confiar nas medidas.`);
  }
  if (truncado) {
    avisos.push(`O desenho passa de ${LIMITE_ELEMENTOS} elementos e foi cortado nesse ponto. Importe o arquivo em partes, ou apague no CAD o que não for necessário antes de exportar.`);
  }
  const semSuporte = Object.entries(ignorados).filter(([nome]) => nome !== "fora_de_faixa");
  if (semSuporte.length) {
    avisos.push(`Não foram importados: ${semSuporte.map(([nome, quantos]) => `${quantos} × ${nome}`).join(", ")}.`);
  }
  if (ignorados.fora_de_faixa) {
    avisos.push(`${ignorados.fora_de_faixa} elemento(s) ficaram fora da faixa de medida aceita e não entraram. Confira a unidade escolhida.`);
  }
  if (!elementos.length) {
    avisos.push("Nenhuma geometria foi encontrada na seção ENTITIES deste arquivo.");
  }

  return {
    camadas, elementos, unidade, unidadeDeclarada: Boolean(unidadeDoArquivo),
    avisos, ignorados, truncado,
  };
}

// ## DWG
//
// Os seis primeiros bytes de todo DWG são a versão em ASCII. Ler isso é trivial e é o
// único proveito honesto que se tira do arquivo aqui: em vez de "formato não suportado",
// a pessoa ouve qual é o arquivo dela e o que fazer com ele.
const VERSOES_DWG: Record<string, string> = {
  AC1009: "AutoCAD R11/R12", AC1012: "AutoCAD R13", AC1014: "AutoCAD R14",
  AC1015: "AutoCAD 2000–2002", AC1018: "AutoCAD 2004–2006", AC1021: "AutoCAD 2007–2009",
  AC1024: "AutoCAD 2010–2012", AC1027: "AutoCAD 2013–2017", AC1032: "AutoCAD 2018 ou mais novo",
};

export function versaoDoDwg(bytes: Uint8Array): { codigo: string; nome: string } | null {
  if (bytes.length < 6) return null;
  const codigo = String.fromCharCode(...bytes.subarray(0, 6));
  if (!/^AC10\d\d$/.test(codigo)) return null;
  return { codigo, nome: VERSOES_DWG[codigo] ?? "versão não catalogada" };
}

// ## Escrita
//
// O caminho de volta. Sem ele a prancheta é uma ilha: o desenho entra e não sai para o
// programa em que o resto do escritório trabalha.
//
// A saída é DXF R12 ASCII, que é o dialeto mais antigo e por isso o que TODO programa
// abre — AutoCAD, BricsCAD, LibreCAD, QCAD, SketchUp, Revit. Versões novas trazem
// recursos que este desenho não usa e fecham a porta de programas antigos: escolher a
// versão mais capaz aqui seria pagar compatibilidade por nada.
//
// O eixo Y volta a apontar para cima, desfazendo a inversão da leitura. Exportar sem
// desfazer devolveria a planta espelhada para quem a mandou.

function par(codigo: number, valor: string | number) {
  return `${codigo}\n${valor}`;
}

// O DXF R12 não tem onde guardar acento, e nome de camada não aceita alguns sinais.
// Trocar é melhor do que gerar um arquivo que o CAD recusa a abrir.
function nomeDeCamada(nome: string, usados: Map<string, string>) {
  const existente = usados.get(nome);
  if (existente) return existente;
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9_$-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 31) || "CAMADA";
  let candidato = base;
  let n = 2;
  const tomados = new Set(usados.values());
  while (tomados.has(candidato)) { candidato = `${base.slice(0, 28)}-${n}`; n += 1; }
  usados.set(nome, candidato);
  return candidato;
}

const numeroDxf = (valor: number) => Number.isInteger(valor) ? String(valor) : valor.toFixed(4);

/**
 * Escreve o documento como DXF R12 ASCII, em milímetros.
 *
 * Só sai o que está em camada visível — o mesmo critério da tela e da exportação em SVG,
 * para que as três concordem. Cômodo vira polilinha fechada; a área calculada não vai
 * junto, porque no DXF ela seria texto solto que envelhece assim que alguém mover uma
 * parede. Símbolo e mobília saem como a geometria que representam, não como bloco: bloco
 * exigiria uma tabela de definição que este desenho não mantém.
 */
export function exportarDxf(documento: { camadas: Camada[]; elementos: Elemento[] },
  opcoes: { visiveis?: Elemento[] } = {}): string {
  const elementos = opcoes.visiveis ?? documento.elementos;
  const nomes = new Map<string, string>();
  const camadaDoElemento = new Map<string, string>();
  for (const camada of documento.camadas) camadaDoElemento.set(camada.id, nomeDeCamada(camada.nome, nomes));
  const nomeDe = (id: string) => camadaDoElemento.get(id) ?? "0";

  const linhas: string[] = [];
  const escrever = (codigo: number, valor: string | number) => linhas.push(par(codigo, valor));

  escrever(0, "SECTION"); escrever(2, "HEADER");
  // 4 = milímetro. É o que torna a medida do arquivo inequívoca para quem o abrir.
  escrever(9, "$INSUNITS"); escrever(70, 4);
  escrever(9, "$MEASUREMENT"); escrever(70, 1);
  escrever(0, "ENDSEC");

  escrever(0, "SECTION"); escrever(2, "TABLES");
  escrever(0, "TABLE"); escrever(2, "LAYER"); escrever(70, documento.camadas.length + 1);
  escrever(0, "LAYER"); escrever(2, "0"); escrever(70, 0); escrever(62, 7); escrever(6, "CONTINUOUS");
  for (const camada of documento.camadas) {
    escrever(0, "LAYER"); escrever(2, nomeDe(camada.id));
    escrever(70, 0); escrever(62, camada.visivel ? 7 : -7); escrever(6, "CONTINUOUS");
  }
  escrever(0, "ENDTAB"); escrever(0, "ENDSEC");

  escrever(0, "SECTION"); escrever(2, "ENTITIES");

  // Y para cima de novo: é aqui, e só aqui, que a inversão da leitura é desfeita.
  const ex = (valor: number) => numeroDxf(valor);
  const ey = (valor: number) => numeroDxf(-valor);

  const linha = (camada: string, a: { x: number; y: number }, b: { x: number; y: number }) => {
    escrever(0, "LINE"); escrever(8, camada);
    escrever(10, ex(a.x)); escrever(20, ey(a.y)); escrever(30, 0);
    escrever(11, ex(b.x)); escrever(21, ey(b.y)); escrever(31, 0);
  };
  const polilinha = (camada: string, pontos: { x: number; y: number }[], fechada: boolean) => {
    escrever(0, "LWPOLYLINE"); escrever(8, camada);
    escrever(90, pontos.length); escrever(70, fechada ? 1 : 0);
    for (const ponto of pontos) { escrever(10, ex(ponto.x)); escrever(20, ey(ponto.y)); }
  };
  const texto = (camada: string, posicao: { x: number; y: number }, conteudo: string, alturaMm: number, giro: number) => {
    escrever(0, "TEXT"); escrever(8, camada);
    escrever(10, ex(posicao.x)); escrever(20, ey(posicao.y)); escrever(30, 0);
    escrever(40, numeroDxf(alturaMm));
    escrever(1, conteudo.replace(/[\r\n]+/g, " ").slice(0, 250));
    escrever(50, numeroDxf(((-giro % 360) + 360) % 360));
  };

  for (const elemento of elementos) {
    const camada = nomeDe(elemento.camada);
    switch (elemento.tipo) {
      case "parede":
      case "cota":
        linha(camada, elemento.a, elemento.b);
        break;
      case "comodo":
        polilinha(camada, elemento.pontos, true);
        break;
      case "traco":
        polilinha(camada, elemento.pontos, false);
        break;
      case "abertura": {
        const meia = elemento.larguraMm / 2;
        const radianos = elemento.rotacaoGraus * Math.PI / 180;
        const girar = (dx: number, dy: number) => ({
          x: elemento.posicao.x + dx * Math.cos(radianos) - dy * Math.sin(radianos),
          y: elemento.posicao.y + dx * Math.sin(radianos) + dy * Math.cos(radianos),
        });
        linha(camada, girar(-meia, 0), girar(meia, 0));
        break;
      }
      case "mobilia":
      case "imagem": {
        const meiaLargura = elemento.larguraMm / 2;
        const meiaAltura = elemento.alturaMm / 2;
        const radianos = elemento.rotacaoGraus * Math.PI / 180;
        const girar = (dx: number, dy: number) => ({
          x: elemento.posicao.x + dx * Math.cos(radianos) - dy * Math.sin(radianos),
          y: elemento.posicao.y + dx * Math.sin(radianos) + dy * Math.cos(radianos),
        });
        polilinha(camada, [
          girar(-meiaLargura, -meiaAltura), girar(meiaLargura, -meiaAltura),
          girar(meiaLargura, meiaAltura), girar(-meiaLargura, meiaAltura),
        ], true);
        if (elemento.tipo === "mobilia" && elemento.rotulo) {
          texto(camada, elemento.posicao, elemento.rotulo, Math.max(50, elemento.alturaMm / 6), elemento.rotacaoGraus);
        }
        break;
      }
      case "simbolo": {
        // Círculo de referência com o rótulo ao lado: o glifo da tela é desenho de tela,
        // e reproduzi-lo em segmentos encheria o arquivo de traço sem significado. O
        // ponto e o nome dele são o que o outro programa precisa.
        escrever(0, "CIRCLE"); escrever(8, camada);
        escrever(10, ex(elemento.posicao.x)); escrever(20, ey(elemento.posicao.y)); escrever(30, 0);
        escrever(40, 120);
        texto(camada, { x: elemento.posicao.x + 180, y: elemento.posicao.y }, elemento.rotulo ?? elemento.familia, 150, 0);
        break;
      }
      case "texto":
        texto(camada, elemento.posicao, elemento.texto, elemento.alturaMm, elemento.rotacaoGraus);
        break;
    }
  }

  escrever(0, "ENDSEC");
  escrever(0, "EOF");
  return `${linhas.join("\n")}\n`;
}
