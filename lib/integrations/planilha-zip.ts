import { inflateRawSync } from "node:zlib";

// Leitor de ZIP e de XLSX, sem dependência nova.
//
// O arquivo da Caixa é um ZIP com XLSX dentro, e o XLSX é ele próprio um ZIP de XML.
// Trazer uma biblioteca de planilha custaria em duas frentes: o bundle da função
// serverless tem limite de tamanho, e as bibliotecas do ramo carregam a planilha inteira
// em memória — que é exatamente o que não cabe num arquivo de 20 MB. O `zlib` do Node já
// descomprime; o que falta é ler o índice do ZIP, e são poucas dezenas de linhas.
//
// A leitura é seletiva de propósito: o índice é lido uma vez e só a entrada pedida é
// descomprimida.

export type EntradaZip = { nome: string; tamanho: number; comprimido: number; metodo: number; deslocamento: number };
export type Zip = { entradas: EntradaZip[]; extrair(nome: string): Buffer };

const FIM_DIRETORIO = 0x06054b50;
const ENTRADA_DIRETORIO = 0x02014b50;

// O diretório central fica no fim, depois de um comentário de tamanho variável, então a
// busca é de trás para frente.
function acharFimDoDiretorio(dados: Buffer): number {
  const limite = Math.max(0, dados.length - 0xffff - 22);
  for (let posicao = dados.length - 22; posicao >= limite; posicao -= 1) {
    if (dados.readUInt32LE(posicao) === FIM_DIRETORIO) return posicao;
  }
  throw new Error("arquivo não é um ZIP válido: fim do diretório central não encontrado");
}

export function abrirZip(dados: Buffer): Zip {
  const fim = acharFimDoDiretorio(dados);
  const total = dados.readUInt16LE(fim + 10);
  let posicao = dados.readUInt32LE(fim + 16);
  const entradas: EntradaZip[] = [];
  for (let indice = 0; indice < total; indice += 1) {
    if (posicao + 46 > dados.length || dados.readUInt32LE(posicao) !== ENTRADA_DIRETORIO) break;
    const tamanhoNome = dados.readUInt16LE(posicao + 28);
    const tamanhoExtra = dados.readUInt16LE(posicao + 30);
    const tamanhoComentario = dados.readUInt16LE(posicao + 32);
    entradas.push({
      nome: dados.toString("utf8", posicao + 46, posicao + 46 + tamanhoNome),
      metodo: dados.readUInt16LE(posicao + 10),
      comprimido: dados.readUInt32LE(posicao + 20),
      tamanho: dados.readUInt32LE(posicao + 24),
      deslocamento: dados.readUInt32LE(posicao + 42),
    });
    posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }

  const porNome = new Map(entradas.map((entrada) => [entrada.nome, entrada]));
  return {
    entradas,
    extrair(nome: string): Buffer {
      const entrada = porNome.get(nome);
      if (!entrada) throw new Error(`entrada "${nome}" não existe neste arquivo`);
      // O cabeçalho local repete nome e extra com tamanhos próprios: é por ele que se
      // acha o início real dos bytes, não pelos tamanhos do diretório central.
      const base = entrada.deslocamento;
      const inicio = base + 30 + dados.readUInt16LE(base + 26) + dados.readUInt16LE(base + 28);
      const bruto = dados.subarray(inicio, inicio + entrada.comprimido);
      if (entrada.metodo === 0) return Buffer.from(bruto);
      if (entrada.metodo === 8) return inflateRawSync(bruto);
      throw new Error(`método de compressão ${entrada.metodo} não suportado`);
    },
  };
}
