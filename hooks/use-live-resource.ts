"use client";
import { useCallback, useEffect, useState } from "react";

export class ResourceError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function resourceJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ResourceError(body.error ?? "Não foi possível concluir a operação.", response.status, body.code);
  return body as T;
}
export const resourceMessage = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação.";

export function useLiveResource<T>(url: string | null, intervalMs = 15000) {
  const [state, setState] = useState<{ url: string; data: T | null; error: string; status?: number; updatedAt: Date } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await resourceJson<T>(url, { signal: controller.signal });
        if (!controller.signal.aborted) setState({ url, data, error: "", updatedAt: new Date() });
      } catch (error) {
        if (!controller.signal.aborted) setState((previous) => ({ url, data: error instanceof ResourceError && [401, 403, 404, 410].includes(error.status) ? null : previous?.url === url ? previous.data : null,
          error: resourceMessage(error), status: error instanceof ResourceError ? error.status : 0, updatedAt: previous?.updatedAt ?? new Date() }));
      } finally { inFlight = false; }
    };
    void load();
    const sync = () => { if (!document.hidden) void load(); };
    const timer = intervalMs ? window.setInterval(sync, intervalMs) : null;
    document.addEventListener("visibilitychange", sync); window.addEventListener("online", sync);
    return () => { controller.abort(); if (timer !== null) window.clearInterval(timer); document.removeEventListener("visibilitychange", sync); window.removeEventListener("online", sync); };
  }, [url, intervalMs, revision]);
  const current = state?.url === url ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? "", status: current?.status, loading: Boolean(url && !current), updatedAt: current?.updatedAt, refresh };
}
