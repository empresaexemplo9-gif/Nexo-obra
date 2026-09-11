// Ambiente de execução, sem depender de nenhum provedor específico.
//
// Antes, todo segredo vinha de `cloudflare:workers`, um módulo que só existe dentro do
// runtime da Cloudflare. Isso amarrava o projeto a um único destino de publicação e fazia
// `next build` falhar. Agora vem de `process.env`, que GitHub Actions, Vercel, Node e
// qualquer outro lugar sabem preencher.

export type RuntimeEnv = Record<string, string | undefined>;

// Em teste, o ambiente pode ser injetado sem mexer em process.env.
declare global {
  var __platformEnvOverride: RuntimeEnv | undefined;
}

export function runtimeEnv(): RuntimeEnv {
  return globalThis.__platformEnvOverride ?? (process.env as RuntimeEnv);
}

export function requireEnv(name: string): string {
  const value = runtimeEnv()[name];
  if (!value) throw new Error(`A variável de ambiente ${name} não está configurada.`);
  return value;
}
