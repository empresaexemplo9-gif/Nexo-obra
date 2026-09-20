import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// Selo do build, gravado no bundle em tempo de compilação. O domínio público já serviu
// uma versão antiga enquanto o código novo estava no GitHub; este selo responde na tela
// qual commit está no ar.
function buildStamp() {
  const fromEnvironment = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromEnvironment) return fromEnvironment.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "desconhecido";
  }
}

const nextConfig: NextConfig = {
  // O cliente libSQL carrega um pacote nativo para atender `file:`. Empacotá-lo numa
  // função serverless é onde binário nativo costuma se perder no rastreamento e derrubar
  // todas as rotas de uma vez. Mantido externo, ele é resolvido de node_modules.
  serverExternalPackages: ["@libsql/client", "libsql", "dwg2dxf-converter"],
  // `env` é embutido no bundle do servidor e do navegador durante o build.
  env: {
    PLATFORM_BUILD: buildStamp(),
    PLATFORM_BUILT_AT: new Date().toISOString(),
  },
};

export default nextConfig;
