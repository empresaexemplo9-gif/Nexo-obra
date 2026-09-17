import { DrapApiError, requestDrapApi } from "@/lib/integrations/drap";

export const DRAP_RESOURCE_PATHS = {
  lancamentos: ["/api/v1/lancamentos"],
  parceiros: ["/api/v1/parceiros"],
  categorias: ["/api/v1/categorias"],
  resumo: ["/api/v1/resumo"],
  nfse: ["/api/v1/nfse", "/api/v1/notas-fiscais", "/api/v1/notas"],
  cobrancas: ["/api/v1/cobrancas"],
  orcamentos: ["/api/v1/orcamentos"],
  "contas-bancarias": ["/api/v1/contas-bancarias", "/api/v1/contas"],
  anexos: ["/api/v1/anexos"],
  "centros-custo": ["/api/v1/centros-custo"],
  modulos: ["/api/v1/modulos"],
  assinaturas: ["/api/v1/assinaturas"],
  planos: ["/api/v1/planos"],
  empresas: ["/api/v1/empresas"],
  webhooks: ["/api/v1/webhooks"],
} as const;

export type DrapResource = keyof typeof DRAP_RESOURCE_PATHS;
export type DrapResourceStatus = "available" | "forbidden" | "missing" | "rate_limited" | "error";
export type DrapResourceProbe = {
  resource: DrapResource;
  status: DrapResourceStatus;
  path: string | null;
  httpStatus: number | null;
  retryAfter: string | null;
};

const WRITABLE_RESOURCES = new Set<DrapResource>([
  "lancamentos",
  "parceiros",
  "categorias",
  "nfse",
  "cobrancas",
  "orcamentos",
  "contas-bancarias",
  "anexos",
  "centros-custo",
  "webhooks",
]);

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: DrapResourceProbe }>();

export function isDrapResource(value: string): value is DrapResource {
  return Object.prototype.hasOwnProperty.call(DRAP_RESOURCE_PATHS, value);
}

export function isDrapResourceWritable(resource: DrapResource) {
  return WRITABLE_RESOURCES.has(resource);
}

function cacheKey(externalCompanyId: string, resource: DrapResource) {
  return `${externalCompanyId}:${resource}`;
}

function remember(externalCompanyId: string, value: DrapResourceProbe) {
  cache.set(cacheKey(externalCompanyId, value.resource), { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export async function probeDrapResource(externalCompanyId: string, resource: DrapResource, fresh = false): Promise<DrapResourceProbe> {
  const key = cacheKey(externalCompanyId, resource);
  const cached = cache.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.value;

  for (const path of DRAP_RESOURCE_PATHS[resource]) {
    try {
      await requestDrapApi(externalCompanyId, `${path}?limit=1`);
      return remember(externalCompanyId, { resource, status: "available", path, httpStatus: 200, retryAfter: null });
    } catch (cause) {
      if (!(cause instanceof DrapApiError)) throw cause;
      if (cause.status === 404) continue;
      if (cause.status === 403) {
        return remember(externalCompanyId, { resource, status: "forbidden", path, httpStatus: 403, retryAfter: cause.retryAfter });
      }
      if (cause.status === 429) {
        return { resource, status: "rate_limited", path, httpStatus: 429, retryAfter: cause.retryAfter };
      }
      // 400/405/409/422 provam que a rota existe: o GET de descoberta é que
      // não satisfaz o contrato específico daquele recurso.
      if ([400, 405, 409, 422].includes(cause.status)) {
        return remember(externalCompanyId, { resource, status: "available", path, httpStatus: cause.status, retryAfter: cause.retryAfter });
      }
      return { resource, status: "error", path, httpStatus: cause.status, retryAfter: cause.retryAfter };
    }
  }

  return remember(externalCompanyId, { resource, status: "missing", path: null, httpStatus: 404, retryAfter: null });
}

export async function probeDrapResources(externalCompanyId: string, fresh = false) {
  const resources = Object.keys(DRAP_RESOURCE_PATHS) as DrapResource[];
  const probes = await Promise.all(resources.map((resource) => probeDrapResource(externalCompanyId, resource, fresh)));
  return Object.fromEntries(probes.map((probe) => [probe.resource, probe])) as Record<DrapResource, DrapResourceProbe>;
}

export async function requireDrapResourcePath(externalCompanyId: string, resource: DrapResource) {
  const probe = await probeDrapResource(externalCompanyId, resource);
  if (probe.status === "available" && probe.path) return probe.path;
  if (probe.status === "forbidden") throw new DrapApiError(403, { error: "resource_scope_insufficient" }, probe.retryAfter);
  if (probe.status === "rate_limited") throw new DrapApiError(429, { error: "resource_discovery_rate_limited" }, probe.retryAfter);
  if (probe.status === "missing") throw new DrapApiError(404, { error: "resource_not_found" }, null);
  throw new DrapApiError(probe.httpStatus ?? 502, { error: "resource_discovery_failed" }, probe.retryAfter);
}
