import { crc32, inflateRawSync } from "node:zlib";

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
  if (dados.length > 80 * 1024 * 1024) throw new Error("ZIP excede 80 MB.");
  const fim = acharFimDoDiretorio(dados);
  const total = dados.readUInt16LE(fim + 10);
  let posicao = dados.readUInt32LE(fim + 16);
  const entradas: EntradaZip[] = [];
  for (let indice = 0; indice < total; indice += 1) {
    if (posicao + 46 > dados.length || dados.readUInt32LE(posicao) !== ENTRADA_DIRETORIO) throw new Error("Diretório ZIP truncado.");
    const tamanhoNome = dados.readUInt16LE(posicao + 28);
    const tamanhoExtra = dados.readUInt16LE(posicao + 30);
    const tamanhoComentario = dados.readUInt16LE(posicao + 32);
    if (posicao + 46 + tamanhoNome + tamanhoExtra + tamanhoComentario > dados.length) throw new Error("Entrada ZIP truncada.");
    if (dados.readUInt16LE(posicao + 8) & 1) throw new Error("ZIP cifrado não suportado.");
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
  if (porNome.size !== entradas.length) throw new Error("ZIP contém nomes duplicados.");
  const checksums = new Map<string, number>();
  let central = dados.readUInt32LE(fim + 16);
  for (const entry of entradas) {
    checksums.set(entry.nome, dados.readUInt32LE(central + 16));
    central += 46 + dados.readUInt16LE(central + 28) + dados.readUInt16LE(central + 30) + dados.readUInt16LE(central + 32);
  }
  return {
    entradas,
    extrair(nome: string): Buffer {
      const entrada = porNome.get(nome);
      if (!entrada) throw new Error(`entrada "${nome}" não existe neste arquivo`);
      // O cabeçalho local repete nome e extra com tamanhos próprios: é por ele que se
      // acha o início real dos bytes, não pelos tamanhos do diretório central.
      const base = entrada.deslocamento;
      if (entrada.tamanho > 128 * 1024 * 1024 || base + 30 > dados.length || dados.readUInt32LE(base) !== 0x04034b50) throw new Error("Entrada ZIP inválida ou muito grande.");
      const inicio = base + 30 + dados.readUInt16LE(base + 26) + dados.readUInt16LE(base + 28);
      if (inicio + entrada.comprimido > dados.length) throw new Error("Conteúdo ZIP truncado.");
      const bruto = dados.subarray(inicio, inicio + entrada.comprimido);
      if (entrada.metodo !== 0 && entrada.metodo !== 8) throw new Error(`método de compressão ${entrada.metodo} não suportado`);
      const result = entrada.metodo === 0 ? Buffer.from(bruto) : inflateRawSync(bruto, { maxOutputLength: 128 * 1024 * 1024 });
      if (result.length !== entrada.tamanho || crc32(result) !== checksums.get(nome)) throw new Error("Integridade ZIP inválida (tamanho ou CRC).");
      return result;
    },
  };
}
