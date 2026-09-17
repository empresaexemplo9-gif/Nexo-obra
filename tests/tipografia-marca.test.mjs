// A Ador Hairline chegou licenciada, em cinco arquivos: Light, Black e três itálicos.
// Não vieram Regular nem Bold retos.
//
// O defeito que este arquivo impede é silencioso: declarar uma faixa de peso que os
// arquivos não têm faz o navegador ENGROSSAR a Light por conta própria. O texto continua
// aparecendo, ninguém vê erro, e o traço fino que dá nome à Hairline desaparece —
// exatamente a característica que o manual da marca descreve.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const regras = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, corpo]) => corpo);
const ador = regras.filter((corpo) => /ador-hairline/.test(corpo));

test("os cinco arquivos recebidos estão servidos", async () => {
  const esperados = [
    ["ador-hairline-light.ttf", "normal", "300"],
    ["ador-hairline-light-italic.ttf", "italic", "300"],
    ["ador-hairline-italic.ttf", "italic", "400"],
    ["ador-hairline-extrabold-italic.ttf", "italic", "800"],
    ["ador-hairline-black.ttf", "normal", "900"],
  ];
  assert.equal(ador.length, esperados.length);
  for (const [arquivo, estilo, peso] of esperados) {
    const regra = ador.find((corpo) => corpo.includes(arquivo));
    assert.ok(regra, `falta a regra de ${arquivo}`);
    assert.match(regra, new RegExp(`font-style:\\s*${estilo}`), `${arquivo}: estilo`);
    assert.match(regra, new RegExp(`font-weight:\\s*${peso}\\s*;`), `${arquivo}: o peso precisa ser o do arquivo, exato`);
    const info = await stat(new URL(`../public/fonts/${arquivo}`, import.meta.url));
    assert.ok(info.size > 50_000, `${arquivo} parece truncado`);
  }
});

test("nenhuma regra da Ador declara faixa de peso", () => {
  // `font-weight: 300 700` numa fonte estática autoriza o navegador a sintetizar os
  // pesos intermediários. É assim que a finura se perde sem nenhum sinal na tela.
  for (const regra of ador) {
    assert.doesNotMatch(regra, /font-weight:\s*\d+\s+\d+/, "faixa de peso permite traço sintético");
  }
});

test("o título pede um peso que existe de verdade", () => {
  const bloco = /\.display-heading\s*{([^}]*)}/.exec(css)?.[1] ?? "";
  const peso = /font-weight:\s*(\d+)/.exec(bloco)?.[1];
  const pesosRetos = ador.filter((r) => /font-style:\s*normal/.test(r)).map((r) => /font-weight:\s*(\d+)/.exec(r)[1]);
  assert.ok(pesosRetos.includes(peso), `o título pede ${peso} e os arquivos retos são ${pesosRetos.join(", ")}`);
});

test("a reserva continua disponível e a Ador vem primeiro", () => {
  assert.match(css, /--font-display:\s*"Hoikos Display",\s*"Hoikos Display Reserva"/);
  assert.match(css, /font-family:\s*"Hoikos Display Reserva"/);
});

test("todas as regras adiam o texto em vez de escondê-lo", () => {
  // Sem `swap`, o título fica invisível enquanto a fonte carrega — e são arquivos de
  // centenas de kB.
  for (const regra of ador) assert.match(regra, /font-display:\s*swap/);
});
