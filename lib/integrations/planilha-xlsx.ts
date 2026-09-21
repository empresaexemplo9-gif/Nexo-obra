import { abrirZip, type Zip } from "./planilha-zip";

// Leitor de XLSX: o mínimo para ler linhas de uma aba, sem dependência.
//
// Um XLSX é um ZIP com XML dentro. O texto das células fica quase sempre numa tabela
// compartilhada (`sharedStrings.xml`) e a célula guarda só o índice — por isso não dá para
// ler a aba sozinha. Números ficam direto na célula.
//
// Só o necessário para a SINAPI: nome das abas, e as linhas de uma aba como texto. Não há
// fórmula, estilo, data nem formatação aqui, porque a planilha de referência não precisa
// disso e cada recurso a mais seria código sem pergunta que o justifique.

export type Planilha = { abas: string[]; linhas(aba: string, limite?: number): string[][] };

function textoDeXml(valor: string): string {
  return valor
    .replace(/&#(\d+);/g, (_, código) => String.fromCharCode(Number(código)))
    .replace(/&#x([0-9a-f]+);/gi, (_, código) => String.fromCharCode(parseInt(código, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// A coluna vem no endereço da célula ("BC12"): as letras dão o índice, que é o que mantém
// as colunas vazias no lugar certo em vez de deslocar a linha inteira.
function indiceDaColuna(referencia: string): number {
  const letras = /^([A-Z]+)/.exec(referencia)?.[1] ?? "";
  let indice = 0;
  for (const letra of letras) indice = indice * 26 + (letra.charCodeAt(0) - 64);
  return indice - 1;
}

function lerTextosCompartilhados(zip: Zip): string[] {
  const entrada = zip.entradas.find((item) => item.nome === "xl/sharedStrings.xml");
  if (!entrada) return [];
  const xml = zip.extrair(entrada.nome).toString("utf8");
  // Cada <si> é um texto; ele pode vir partido em vários <t> (trechos com formatação
  // diferente), e nesse caso o texto da célula é a concatenação de todos.
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([, corpo]) =>
    [...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([, texto]) => textoDeXml(texto)).join(""),
  );
}

export function abrirPlanilha(dados: Buffer): Planilha {
  const zip = abrirZip(dados);
  const workbook = zip.extrair("xl/workbook.xml").toString("utf8");
  const relacoes = zip.extrair("xl/_rels/workbook.xml.rels").toString("utf8");

  const alvoPorId = new Map(
    [...relacoes.matchAll(/<Relationship\b[^>]*\/>/g)]
      .map(([tag]) => [/\bId="([^"]+)"/.exec(tag)?.[1] ?? "", (/\bTarget="([^"]+)"/.exec(tag)?.[1] ?? "").replace(/^\/?xl\//, "").replace(/^\//, "")]),
  );
  const abas = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map((encontrado) => {
    const marca = encontrado[0];
    return {
      nome: textoDeXml(/name="([^"]*)"/.exec(marca)?.[1] ?? ""),
      alvo: alvoPorId.get(/r:id="([^"]+)"/.exec(marca)?.[1] ?? "") ?? "",
    };
  });

  let textos: string[] | null = null;
  return {
    abas: abas.map((aba) => aba.nome),
    linhas(nomeDaAba: string, limite = Infinity): string[][] {
      const aba = abas.find((item) => item.nome === nomeDaAba);
      if (!aba) throw new Error(`aba "${nomeDaAba}" não existe; há ${abas.map((i) => `"${i.nome}"`).join(", ")}`);
      textos ??= lerTextosCompartilhados(zip);
      const xml = zip.extrair(`xl/${aba.alvo}`).toString("utf8");
      const linhas: string[][] = [];
      for (const [, rowTag, corpo = ""] of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        if (linhas.length >= limite) break;
        const rowNumber = Number(/\br="(\d+)"/.exec(rowTag)?.[1] ?? linhas.length + 1);
        if (rowNumber > limite) break;
        if (rowNumber > 200000 || rowNumber <= linhas.length) throw new Error("Endereço de linha XLSX inválido.");
        while (linhas.length < rowNumber - 1) linhas.push([]);
        const linha: string[] = [];
        for (const [, marca, conteudo = ""] of corpo.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const referencia = /r="([A-Z]+\d+)"/.exec(marca)?.[1];
          const coluna = referencia ? indiceDaColuna(referencia) : linha.length;
          if (coluna < 0 || coluna > 16383) throw new Error("Endereço de coluna XLSX inválido.");
          const tipo = /t="([^"]+)"/.exec(marca)?.[1];
          const valor = /<v>([\s\S]*?)<\/v>/.exec(conteudo)?.[1];
          // `t="s"` é índice na tabela compartilhada; `t="inlineStr"` traz o texto junto.
          // CAIXA usa HYPERLINK(...,104658) com cache <v>0</v> para códigos.
          // Lemos somente o rótulo literal; nunca executamos fórmulas.
          const formula = textoDeXml(/<f\b[^>]*>([\s\S]*?)<\/f>/.exec(conteudo)?.[1] ?? "");
          const hyperlinkCode = /^HYPERLINK\([\s\S]*[,;]\s*"?(\d+)"?\s*\)$/i.exec(formula)?.[1];
          const texto = hyperlinkCode ?? (tipo === "s" && valor !== undefined ? (textos[Number(valor)] ?? "")
            : tipo === "inlineStr" ? [...conteudo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([, t]) => textoDeXml(t)).join("")
            : valor !== undefined ? textoDeXml(valor) : "");
          while (linha.length < coluna) linha.push("");
          linha[coluna] = texto;
        }
        linhas.push(linha);
      }
      return linhas;
    },
  };
}
