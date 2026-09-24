// Lê só o cabeçalho de um DXF: versão, página de código e unidade.
//
// A página de código decide como o texto do desenho é decodificado. Um DXF até 2004
// (AC1018) grava texto na página declarada em $DWGCODEPAGE — ANSI_1252 em planta
// brasileira — e lido como UTF-8 transforma "Área" em "�rea". De 2007 (AC1021) em
// diante o formato é UTF-8. A unidade ($INSUNITS) dá nome ao número medido na tela.

export type CabecalhoDxf = { versao: string | null; codificacao: string; unidade: string | null };

const UNIDADES: Record<number, string> = {
  1: "pol", 2: "pés", 3: "milhas", 4: "mm", 5: "cm", 6: "m", 7: "km", 8: "micropol", 9: "mils", 10: "jardas",
  11: "Å", 12: "nm", 13: "µm", 14: "dm", 15: "dam", 16: "hm", 17: "Gm", 18: "UA", 19: "anos-luz", 20: "parsecs",
};

function variavel(texto: string, nome: string) {
  // $NOME, depois um código de grupo e o valor, cada um na sua linha.
  const match = new RegExp(`\\n\\s*9\\s*\\r?\\n\\${nome}\\s*\\r?\\n\\s*\\d+\\s*\\r?\\n([^\\r\\n]*)`).exec(`\n${texto}`);
  return match ? match[1].trim() : null;
}

export function lerCabecalhoDxf(inicio: Uint8Array): CabecalhoDxf {
  // Cabeçalho é ASCII; latin1 lê qualquer byte sem falhar.
  const texto = new TextDecoder("latin1").decode(inicio);
  const versao = variavel(texto, "$ACADVER");
  const pagina = variavel(texto, "$DWGCODEPAGE");
  const insunits = Number(variavel(texto, "$INSUNITS"));
  const numero = versao ? Number(/^AC(\d{4})$/.exec(versao)?.[1] ?? NaN) : NaN;
  let codificacao = "utf-8";
  if (!(numero >= 1021)) {
    const ansi = pagina ? /^ANSI_(\d{3,4})$/i.exec(pagina) : null;
    codificacao = ansi ? (["874", "932", "936", "949", "950"].includes(ansi[1]) ? { 874: "windows-874", 932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5" }[ansi[1]]! : `windows-${ansi[1]}`) : "windows-1252";
  }
  return { versao, codificacao, unidade: UNIDADES[insunits] ?? null };
}
