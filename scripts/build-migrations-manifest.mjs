#!/usr/bin/env node
// Gera `drizzle/manifest.ts` com o SQL de `drizzle/*.sql` embutido.
//
// Antes o SQL entrava no bundle por `import.meta.glob`, que é do Vite. Fora dele — no
// `next build`, que é o que o Vercel roda — a expressão não existe e as migrações
// simplesmente não chegariam ao servidor. Ler do disco em tempo de requisição dependeria
// de o rastreamento de arquivos do Next incluir a pasta; embutir não depende de nada.
//
// A fonte da verdade continua sendo `drizzle/*.sql`. `tests/migrations.test.mjs` compara
// o manifesto com a pasta e falha se alguém gerar uma migração e esquecer de regerar.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const names = (await readdir(`${root}drizzle`)).filter((file) => file.endsWith(".sql")).sort();
const entries = await Promise.all(names.map(async (name) => [
  name.replace(/\.sql$/, ""),
  (await readFile(`${root}drizzle/${name}`, "utf8")).replaceAll("\r\n", "\n"),
]));

const body = entries
  .map(([id, sql]) => `  [${JSON.stringify(id)}, ${JSON.stringify(sql)}],`)
  .join("\n");

await writeFile(`${root}drizzle/manifest.ts`, `// Arquivo gerado por scripts/build-migrations-manifest.mjs. Não edite à mão.
// Regenere com \`npm run db:manifest\` (o \`db:generate\` já faz isso).

export const migrationSources: ReadonlyArray<readonly [string, string]> = [
${body}
];
`);

console.log(`drizzle/manifest.ts: ${entries.length} migrações embutidas.`);
