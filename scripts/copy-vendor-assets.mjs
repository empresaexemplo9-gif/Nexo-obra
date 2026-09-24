// Arquivos estáticos que os visualizadores da Prancheta carregam em tempo de execução:
// o worker do pdf.js (com mapas de caracteres, fontes padrão e decodificadores), o
// WebAssembly do leitor IFC e a fonte do texto dos desenhos DXF/DWG.
//
// Copiados de node_modules a cada build, e não versionados: assim a versão do arquivo
// servido é sempre a mesma da biblioteca que o carrega. Um worker de outra versão do
// pdf.js recusa o documento.
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const destino = `${root}public/vendor`;

const copias = [
  // Worker do build "legacy", o mesmo do documento (ver components/prancheta/visualizador-pdf.tsx).
  ["node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "pdfjs/pdf.worker.min.mjs"],
  ["node_modules/pdfjs-dist/cmaps", "pdfjs/cmaps"],
  ["node_modules/pdfjs-dist/standard_fonts", "pdfjs/standard_fonts"],
  ["node_modules/pdfjs-dist/wasm", "pdfjs/wasm"],
  ["node_modules/pdfjs-dist/iccs", "pdfjs/iccs"],
  ["node_modules/web-ifc/web-ifc.wasm", "web-ifc/web-ifc.wasm"],
  ["node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf", "fonts/LiberationSans-Regular.ttf"],
];

await rm(destino, { recursive: true, force: true });
for (const [origem, alvo] of copias) {
  await mkdir(`${destino}/${alvo}`.split("/").slice(0, -1).join("/"), { recursive: true });
  await cp(`${root}${origem}`, `${destino}/${alvo}`, { recursive: true });
}
console.log(`public/vendor: ${copias.length} itens copiados.`);
