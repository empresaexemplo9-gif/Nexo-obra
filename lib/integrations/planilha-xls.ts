import type { Planilha } from "./planilha-xlsx";

// Leitor de XLS (Excel 97–2003, BIFF8): o mínimo para ler linhas de uma aba, sem
// dependência.
//
// A GOINFRA publica as tabelas de custo nesse formato. Um XLS é um "arquivo composto"
// (Compound File Binary): um pequeno sistema de arquivos com setores e uma tabela de
// alocação (FAT). Dentro dele, o fluxo "Workbook" é uma sequência de registros BIFF.
// Só o que a tabela de preços usa é lido: nomes das abas, textos (tabela compartilhada
// SST), números (NUMBER, RK, MULRK) e o resultado guardado de fórmulas. Estilo, data,
// fórmula e gráfico ficam de fora — cada recurso a mais seria código sem pergunta.

const ASSINATURA = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FIM_DA_CADEIA = 0xfffffffe;
const LIVRE = 0xffffffff;

export function ehXls(dados: Buffer): boolean {
  return dados.length >= 512 && ASSINATURA.every((byte, i) => dados[i] === byte);
}

/** Lê o fluxo "Workbook" de dentro do arquivo composto. */
function fluxoDoLivro(dados: Buffer): Buffer {
  if (!ehXls(dados)) throw new Error("o arquivo não é um XLS (assinatura de arquivo composto ausente).");
  const tamanhoSetor = 1 << dados.readUInt16LE(0x1e);
  const tamanhoMini = 1 << dados.readUInt16LE(0x20);
  const setoresFat = dados.readUInt32LE(0x2c);
  const primeiroDiretorio = dados.readUInt32LE(0x30);
  const limiteMini = dados.readUInt32LE(0x38);
  const primeiroMiniFat = dados.readUInt32LE(0x3c);
  const primeiroDifat = dados.readUInt32LE(0x44);
  const setor = (n: number) => {
    const inicio = (n + 1) * tamanhoSetor;
    if (inicio + tamanhoSetor > dados.length + tamanhoSetor) throw new Error("XLS truncado: setor fora do arquivo.");
    return dados.subarray(inicio, Math.min(inicio + tamanhoSetor, dados.length));
  };

  // Onde estão os setores da FAT: 109 no cabeçalho, o resto na cadeia DIFAT.
  const setoresDaFat: number[] = [];
  for (let i = 0; i < 109 && setoresDaFat.length < setoresFat; i += 1) setoresDaFat.push(dados.readUInt32LE(0x4c + i * 4));
  let difat = primeiroDifat;
  for (let guarda = 0; setoresDaFat.length < setoresFat && difat !== FIM_DA_CADEIA && difat !== LIVRE && guarda < 10_000; guarda += 1) {
    const bloco = setor(difat);
    const porSetor = tamanhoSetor / 4 - 1;
    for (let i = 0; i < porSetor && setoresDaFat.length < setoresFat; i += 1) setoresDaFat.push(bloco.readUInt32LE(i * 4));
    difat = bloco.readUInt32LE(porSetor * 4);
  }
  const fat: number[] = [];
  for (const n of setoresDaFat) { const bloco = setor(n); for (let i = 0; i < bloco.length; i += 4) fat.push(bloco.readUInt32LE(i)); }

  const cadeia = (inicio: number, tabela: number[]) => {
    const lista: number[] = [];
    const vistos = new Set<number>();
    for (let n = inicio; n !== FIM_DA_CADEIA && n !== LIVRE; n = tabela[n]) {
      if (n === undefined || vistos.has(n)) throw new Error("XLS corrompido: cadeia de setores inválida.");
      vistos.add(n); lista.push(n);
    }
    return lista;
  };
  const lerCadeia = (inicio: number) => Buffer.concat(cadeia(inicio, fat).map(setor));

  const diretorio = lerCadeia(primeiroDiretorio);
  type Entrada = { nome: string; tipo: number; inicio: number; tamanho: number };
  const entradas: Entrada[] = [];
  for (let p = 0; p + 128 <= diretorio.length; p += 128) {
    const tamanhoNome = diretorio.readUInt16LE(p + 0x40);
    entradas.push({
      nome: diretorio.subarray(p, p + Math.max(0, tamanhoNome - 2)).toString("utf16le"),
      tipo: diretorio[p + 0x42], inicio: diretorio.readUInt32LE(p + 0x74), tamanho: diretorio.readUInt32LE(p + 0x78),
    });
  }
  const raiz = entradas.find((e) => e.tipo === 5);
  const livro = entradas.find((e) => e.tipo === 2 && (e.nome === "Workbook" || e.nome === "Book"));
  if (!livro) throw new Error("o XLS não tem o fluxo da pasta de trabalho.");
  if (livro.nome === "Book") throw new Error("XLS do Excel 95 ou anterior não é lido; abra no Excel e salve como XLSX.");

  if (livro.tamanho >= limiteMini) return lerCadeia(livro.inicio).subarray(0, livro.tamanho);
  // Fluxo pequeno mora no "mini stream", em setores de 64 bytes.
  if (!raiz) throw new Error("XLS corrompido: sem entrada raiz.");
  const miniStream = lerCadeia(raiz.inicio);
  const miniFatBruto = primeiroMiniFat === FIM_DA_CADEIA ? Buffer.alloc(0) : lerCadeia(primeiroMiniFat);
  const miniFat: number[] = [];
  for (let i = 0; i < miniFatBruto.length; i += 4) miniFat.push(miniFatBruto.readUInt32LE(i));
  return Buffer.concat(cadeia(livro.inicio, miniFat).map((n) => miniStream.subarray(n * tamanhoMini, (n + 1) * tamanhoMini))).subarray(0, livro.tamanho);
}

type Registro = { tipo: number; inicio: number; dados: Buffer };

function registros(fluxo: Buffer): Registro[] {
  const lista: Registro[] = [];
  for (let p = 0; p + 4 <= fluxo.length;) {
    const tipo = fluxo.readUInt16LE(p);
    const tamanho = fluxo.readUInt16LE(p + 2);
    lista.push({ tipo, inicio: p, dados: fluxo.subarray(p + 4, p + 4 + tamanho) });
    p += 4 + tamanho;
  }
  return lista;
}

/**
 * Tabela de textos compartilhados (SST). Ela costuma passar do limite de um registro e
 * continua em registros CONTINUE; quando um texto é cortado no meio, o pedaço seguinte
 * recomeça com um novo byte de opções (1 ou 2 bytes por caractere). Por isso a leitura
 * conhece as fronteiras entre os registros.
 */
function lerSst(partes: Buffer[]): string[] {
  const textos: string[] = [];
  let parte = 0; let p = 8;
  const total = partes[0].readUInt32LE(4);
  const avancarSeAcabou = () => { while (parte < partes.length && p >= partes[parte].length) { parte += 1; p = 0; } };
  const byte = () => { avancarSeAcabou(); const v = partes[parte][p]; p += 1; return v; };
  const u16 = () => byte() | (byte() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const pular = (n: number) => { while (n > 0) { avancarSeAcabou(); const passo = Math.min(n, partes[parte].length - p); p += passo; n -= passo; } };

  for (let i = 0; i < total && parte < partes.length; i += 1) {
    avancarSeAcabou();
    if (parte >= partes.length) break;
    const caracteres = u16();
    let opcoes = byte();
    const rico = opcoes & 0x08 ? u16() : 0;
    const estendido = opcoes & 0x04 ? u32() : 0;
    let texto = "";
    let faltam = caracteres;
    while (faltam > 0) {
      if (p >= partes[parte].length) { parte += 1; p = 0; if (parte >= partes.length) break; opcoes = partes[parte][p]; p += 1; }
      const largo = (opcoes & 0x01) === 1;
      const cabem = Math.min(faltam, Math.floor((partes[parte].length - p) / (largo ? 2 : 1)));
      const pedaco = partes[parte].subarray(p, p + cabem * (largo ? 2 : 1));
      texto += largo ? pedaco.toString("utf16le") : pedaco.toString("latin1");
      p += pedaco.length; faltam -= cabem;
    }
    pular(rico * 4 + estendido);
    textos.push(texto);
  }
  return textos;
}

function numeroRk(rk: number): number {
  let valor: number;
  if (rk & 0x02) valor = rk >> 2;
  else { const buffer = Buffer.alloc(8); buffer.writeUInt32LE(0, 0); buffer.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4); valor = buffer.readDoubleLE(0); }
  return rk & 0x01 ? valor / 100 : valor;
}

const comoTexto = (numero: number) => Number.isInteger(numero) ? String(numero) : String(Math.round(numero * 1e9) / 1e9);

function textoCurto(dados: Buffer, p: number, tamanhoComDoisBytes: boolean): string {
  const caracteres = tamanhoComDoisBytes ? dados.readUInt16LE(p) : dados[p];
  const q = p + (tamanhoComDoisBytes ? 2 : 1);
  const largo = (dados[q] & 0x01) === 1;
  return largo ? dados.subarray(q + 1, q + 1 + caracteres * 2).toString("utf16le") : dados.subarray(q + 1, q + 1 + caracteres).toString("latin1");
}

export function abrirPlanilhaXls(dados: Buffer): Planilha {
  const fluxo = fluxoDoLivro(dados);
  const todos = registros(fluxo);
  const bof = todos[0];
  if (!bof || bof.tipo !== 0x0809 || bof.dados.readUInt16LE(0) !== 0x0600) throw new Error("só XLS do Excel 97 ou mais novo (BIFF8) é lido.");

  const abas: { nome: string; posicao: number }[] = [];
  let textos: string[] = [];
  for (let i = 0; i < todos.length; i += 1) {
    const r = todos[i];
    if (r.tipo === 0x0085 && r.dados[5] === 0) abas.push({ posicao: r.dados.readUInt32LE(0), nome: textoCurto(r.dados, 6, false) });
    if (r.tipo === 0x00fc) {
      const partes = [r.dados];
      for (let j = i + 1; j < todos.length && todos[j].tipo === 0x003c; j += 1) partes.push(todos[j].dados);
      textos = lerSst(partes);
    }
    if (r.tipo === 0x000a) break; // fim do bloco global do livro
  }

  const cache = new Map<string, string[][]>();
  function lerAba(nome: string): string[][] {
    const aba = abas.find((a) => a.nome === nome);
    if (!aba) return [];
    const linhas: string[][] = [];
    const por = (linha: number, coluna: number, valor: string) => {
      while (linhas.length <= linha) linhas.push([]);
      const atual = linhas[linha];
      while (atual.length < coluna) atual.push("");
      atual[coluna] = valor;
    };
    let i = todos.findIndex((r) => r.inicio === aba.posicao);
    if (i < 0) return [];
    for (i += 1; i < todos.length; i += 1) {
      const { tipo, dados: d } = todos[i];
      if (tipo === 0x000a) break;
      if (d.length < 6) continue;
      const linha = d.readUInt16LE(0); const coluna = d.readUInt16LE(2);
      if (tipo === 0x00fd) por(linha, coluna, textos[d.readUInt32LE(6)] ?? "");
      else if (tipo === 0x0203) por(linha, coluna, comoTexto(d.readDoubleLE(6)));
      else if (tipo === 0x027e) por(linha, coluna, comoTexto(numeroRk(d.readUInt32LE(6))));
      else if (tipo === 0x00bd) {
        const ultima = d.readUInt16LE(d.length - 2);
        for (let c = coluna, p = 4; c <= ultima && p + 6 <= d.length - 2; c += 1, p += 6) por(linha, c, comoTexto(numeroRk(d.readUInt32LE(p + 2))));
      } else if (tipo === 0x0204) por(linha, coluna, textoCurto(d, 6, true));
      else if (tipo === 0x0006) {
        // Fórmula: vale o resultado guardado. Texto vem no registro STRING seguinte.
        if (d.readUInt16LE(12) === 0xffff) {
          if (d[6] === 0 && todos[i + 1]?.tipo === 0x0207) por(linha, coluna, textoCurto(todos[i + 1].dados, 0, true));
          else if (d[6] === 1) por(linha, coluna, d[8] ? "VERDADEIRO" : "FALSO");
        } else por(linha, coluna, comoTexto(d.readDoubleLE(6)));
      }
    }
    return linhas;
  }

  return {
    abas: abas.map((a) => a.nome),
    linhas(nome: string, limite?: number) {
      if (!cache.has(nome)) cache.set(nome, lerAba(nome));
      const todas = cache.get(nome)!;
      return limite === undefined ? todas : todas.slice(0, limite);
    },
  };
}
