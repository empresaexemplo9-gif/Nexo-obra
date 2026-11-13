// Gerador mínimo de XLS (BIFF8 dentro de arquivo composto) só para os testes do leitor.
// Produz exatamente os registros que a GOINFRA usa — SST com CONTINUE (inclusive texto
// cortado no meio, com troca de 1 para 2 bytes por caractere), LABELSST, NUMBER, RK,
// MULRK, LABEL e FORMULA — para o teste não depender de arquivo baixado.

const registro = (tipo, dados) => { const h = Buffer.alloc(4); h.writeUInt16LE(tipo, 0); h.writeUInt16LE(dados.length, 2); return Buffer.concat([h, dados]); };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const f64 = (n) => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b; };
const celula = (linha, coluna) => Buffer.concat([u16(linha), u16(coluna), u16(15)]);
const rk = (inteiro) => ((inteiro << 2) | 0x02) >>> 0;
const rkCentesimo = (centesimos) => ((centesimos << 2) | 0x03) >>> 0;
const precisaLargo = (t) => [...t].some((c) => c.charCodeAt(0) > 0xff);
const textoXl = (t, tamanho16) => {
  const largo = precisaLargo(t);
  return Buffer.concat([tamanho16 ? u16(t.length) : Buffer.from([t.length]), Buffer.from([largo ? 1 : 0]), Buffer.from(t, largo ? "utf16le" : "latin1")]);
};

/**
 * `linhas`: matriz de células; string vira texto da SST, número vira NUMBER, `{ rk }` vira
 * RK, `{ formula: n }` vira FORMULA com resultado numérico, `{ label }` vira LABEL.
 * `cortar` corta a SST no meio do texto informado, para exercitar o CONTINUE.
 */
export function gerarXls(linhas, { aba = "Relatório", cortar = null, preencher = 6000 } = {}) {
  const textos = [];
  const indice = (t) => { let i = textos.indexOf(t); if (i < 0) { textos.push(t); i = textos.length - 1; } return i; };
  const celulas = [];
  linhas.forEach((linha, r) => {
    // Números inteiros seguidos na mesma linha viram um MULRK, como o Excel grava.
    let c = 0;
    while (c < linha.length) {
      const v = linha[c];
      if (v === null || v === undefined || v === "") { c += 1; continue; }
      if (typeof v === "object" && "rk" in v) {
        let fim = c;
        while (fim + 1 < linha.length && typeof linha[fim + 1] === "object" && linha[fim + 1] && "rk" in linha[fim + 1]) fim += 1;
        if (fim > c) {
          const partes = [u16(r), u16(c)];
          for (let k = c; k <= fim; k += 1) partes.push(u16(15), u32(rk(linha[k].rk)));
          partes.push(u16(fim));
          celulas.push(registro(0x00bd, Buffer.concat(partes)));
        } else celulas.push(registro(0x027e, Buffer.concat([celula(r, c), u32(rk(v.rk))])));
        c = fim + 1; continue;
      }
      if (typeof v === "object" && "centesimos" in v) celulas.push(registro(0x027e, Buffer.concat([celula(r, c), u32(rkCentesimo(v.centesimos))])));
      else if (typeof v === "object" && "formula" in v) celulas.push(registro(0x0006, Buffer.concat([celula(r, c), f64(v.formula), u16(0), u32(0), u16(0)])));
      else if (typeof v === "object" && "label" in v) celulas.push(registro(0x0204, Buffer.concat([celula(r, c), textoXl(v.label, true)])));
      else if (typeof v === "number") celulas.push(registro(0x0203, Buffer.concat([celula(r, c), f64(v)])));
      else celulas.push(registro(0x00fd, Buffer.concat([celula(r, c), u32(indice(String(v)))])));
      c += 1;
    }
  });

  // SST: o texto `cortar` é partido ao meio; a segunda metade vai num CONTINUE que
  // recomeça com o byte de opções (aqui, 2 bytes por caractere).
  const pedacos = [Buffer.concat([u32(textos.length), u32(textos.length)])];
  const continuacoes = [];
  for (const t of textos) {
    if (t === cortar) {
      const meio = Math.floor(t.length / 2);
      pedacos.push(Buffer.concat([u16(t.length), Buffer.from([0]), Buffer.from(t.slice(0, meio), "latin1")]));
      continuacoes.push(Buffer.concat([Buffer.from([1]), Buffer.from(t.slice(meio), "utf16le")]));
      continue;
    }
    (continuacoes.length ? continuacoes : pedacos).push(Buffer.concat([u16(t.length), textoXl(t, false).subarray(1)]));
  }
  const sst = registro(0x00fc, Buffer.concat(pedacos));
  const cont = continuacoes.length ? registro(0x003c, Buffer.concat(continuacoes)) : Buffer.alloc(0);

  const bofGlobal = registro(0x0809, Buffer.concat([u16(0x0600), u16(0x0005), Buffer.alloc(12)]));
  const enchimento = registro(0x00eb, Buffer.alloc(Math.min(preencher, 8000))); // mantém o fluxo acima de 4 KB
  const nomeAba = Buffer.concat([Buffer.from([aba.length]), Buffer.from([precisaLargo(aba) ? 1 : 0]), Buffer.from(aba, precisaLargo(aba) ? "utf16le" : "latin1")]);
  const tamanhoBoundsheet = 4 + 6 + nomeAba.length;
  const posicaoDaAba = bofGlobal.length + enchimento.length + tamanhoBoundsheet + sst.length + cont.length + 4;
  const boundsheet = registro(0x0085, Buffer.concat([u32(posicaoDaAba), Buffer.from([0, 0]), nomeAba]));
  const globais = Buffer.concat([bofGlobal, enchimento, boundsheet, sst, cont, registro(0x000a, Buffer.alloc(0))]);
  const planilha = Buffer.concat([registro(0x0809, Buffer.concat([u16(0x0600), u16(0x0010), Buffer.alloc(12)])), ...celulas, registro(0x000a, Buffer.alloc(0))]);
  const livro = Buffer.concat([globais, planilha]);

  // Arquivo composto: cabeçalho, setores do livro, um setor de diretório e um de FAT.
  const SETOR = 512;
  const setoresLivro = Math.ceil(livro.length / SETOR);
  const setorDiretorio = setoresLivro;
  const setorFat = setoresLivro + 1;
  const fat = Buffer.alloc(SETOR, 0xff);
  for (let i = 0; i < setoresLivro; i += 1) fat.writeUInt32LE(i + 1 < setoresLivro ? i + 1 : 0xfffffffe, i * 4);
  fat.writeUInt32LE(0xfffffffe, setorDiretorio * 4);
  fat.writeUInt32LE(0xfffffffd, setorFat * 4);
  const cabecalho = Buffer.alloc(512, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(cabecalho, 0);
  cabecalho.writeUInt16LE(0x003e, 0x18); cabecalho.writeUInt16LE(3, 0x1a); cabecalho.writeUInt16LE(0xfffe, 0x1c);
  cabecalho.writeUInt16LE(9, 0x1e); cabecalho.writeUInt16LE(6, 0x20);
  cabecalho.writeUInt32LE(1, 0x2c); cabecalho.writeUInt32LE(setorDiretorio, 0x30); cabecalho.writeUInt32LE(4096, 0x38);
  cabecalho.writeUInt32LE(0xfffffffe, 0x3c); cabecalho.writeUInt32LE(0xfffffffe, 0x44);
  for (let i = 0; i < 109; i += 1) cabecalho.writeUInt32LE(i === 0 ? setorFat : 0xffffffff, 0x4c + i * 4);
  const entrada = (nome, tipo, inicio, tamanho) => {
    const e = Buffer.alloc(128, 0);
    Buffer.from(`${nome}\0`, "utf16le").copy(e, 0);
    e.writeUInt16LE((nome.length + 1) * 2, 0x40); e[0x42] = tipo; e[0x43] = 1;
    e.writeUInt32LE(0xffffffff, 0x44); e.writeUInt32LE(0xffffffff, 0x48); e.writeUInt32LE(tipo === 5 ? 1 : 0xffffffff, 0x4c);
    e.writeUInt32LE(inicio >>> 0, 0x74); e.writeUInt32LE(tamanho, 0x78);
    return e;
  };
  const diretorio = Buffer.concat([entrada("Root Entry", 5, 0xfffffffe, 0), entrada("Workbook", 2, 0, livro.length), Buffer.alloc(256, 0)]);
  const corpoLivro = Buffer.concat([livro, Buffer.alloc(setoresLivro * SETOR - livro.length, 0)]);
  return Buffer.concat([cabecalho, corpoLivro, diretorio, fat]);
}
