import type { OpenRouterModel } from "shared/ai";

export const OPENROUTER_MODELS_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=all";

export const OPENROUTER_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

export type OpenRouterCatalogSnapshot = {
  fetchedAt: number;
  models: OpenRouterModel[];
};

export type OpenRouterCatalogCacheDeps = {
  fetchModels: () => Promise<OpenRouterModel[]>;
  load: () => Promise<OpenRouterCatalogSnapshot | null>;
  save: (snapshot: OpenRouterCatalogSnapshot) => Promise<void>;
  now?: () => number;
  ttlMs?: number;
  onRefreshError?: (error: unknown) => void;
};

export function createOpenRouterCatalogCache(deps: OpenRouterCatalogCacheDeps) {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? OPENROUTER_CATALOG_TTL_MS;
  let memory: OpenRouterCatalogSnapshot | null = null;
  let refreshInFlight: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const models = await deps.fetchModels();
        const snapshot = { fetchedAt: now(), models };
        memory = snapshot;
        await deps.save(snapshot);
      } catch (error) {
        deps.onRefreshError?.(error);
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  };

  const get = async (): Promise<OpenRouterModel[]> => {
    if (!memory) {
      try {
        memory = await deps.load();
      } catch (error) {
        deps.onRefreshError?.(error);
      }
    }
    if (!memory) {
      await refresh();
    }
    const snapshot = memory;
    if (!snapshot) return [];
    if (now() - snapshot.fetchedAt >= ttlMs) {
      void refresh();
    }
    return snapshot.models;
  };

  return {
    get,
    refresh,
    isRefreshInFlight: () => refreshInFlight !== null,
    peek: () => memory,
    reset: () => {
      memory = null;
      refreshInFlight = null;
    },
  };
}
