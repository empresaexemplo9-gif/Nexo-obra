import { execSync } from "node:child_process";

import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// Selo do build, gravado no bundle. O domínio público é um redirecionador para outro
// alvo de publicação, então "meu código está no ar?" precisava de resposta na tela.
function buildStamp() {
  const fromEnvironment = process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.GITHUB_SHA
    ?? process.env.CF_PAGES_COMMIT_SHA;
  if (fromEnvironment) return fromEnvironment.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "desconhecido";
  }
}

const localRuntimeVars = Object.fromEntries(
  [
    "DRAP_API_URL",
    "DRAP_API_TOKEN",
    "DRAP_API_KEY_HEADER",
    "DRAP_SUMMARY_PATH",
    "DRAP_TRANSACTIONS_PATH",
    "DRAP_CHARGES_PATH",
    "DRAP_WEBHOOK_SECRET",
    "SUPERADMIN_EMAIL",
    "SUPERADMIN_PASSWORD_HASH",
    "SUPERADMIN_SESSION_SECRET",
  ]
    .map((key) => [key, process.env[key]])
    .filter((entry): entry is [string, string] => Boolean(entry[1])),
);

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
  vars: localRuntimeVars,
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define: {
      __PLATFORM_BUILD__: JSON.stringify(buildStamp()),
      __PLATFORM_BUILT_AT__: JSON.stringify(new Date().toISOString()),
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
