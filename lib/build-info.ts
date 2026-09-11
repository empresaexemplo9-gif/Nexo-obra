// Identificação do build que está realmente servindo a aplicação.
//
// O código estar publicado no GitHub não significa que ele está no ar: o domínio público
// já reescreveu rotas para outro alvo de publicação enquanto o repositório seguia adiante.
// Isso custou horas de confusão. Este selo responde na tela qual commit está servindo.
//
// O valor é embutido no build: `env` do `next.config.ts` no build do Next, e `define` do
// Vite enquanto o build antigo ainda existir.
declare const __PLATFORM_BUILD__: string | undefined;
declare const __PLATFORM_BUILT_AT__: string | undefined;

function stamp(fromNext: string | undefined, fromVite: string | undefined, fallback: string) {
  if (fromNext) return fromNext;
  if (typeof fromVite === "string" && fromVite) return fromVite;
  return fallback;
}

export const PLATFORM_BUILD = stamp(
  process.env.PLATFORM_BUILD,
  typeof __PLATFORM_BUILD__ === "string" ? __PLATFORM_BUILD__ : undefined,
  "desconhecido",
);
export const PLATFORM_BUILT_AT = stamp(
  process.env.PLATFORM_BUILT_AT,
  typeof __PLATFORM_BUILT_AT__ === "string" ? __PLATFORM_BUILT_AT__ : undefined,
  "",
);
