import type { OpenRouterModel } from "shared/ai";
import { createOpenRouterCatalogCache } from "back-end/src/services/openRouterModelCatalog";

const modelsV1: OpenRouterModel[] = [
  { id: "anthropic/claude-sonnet-5", pricing: { prompt: "0.000002" } },
];
const modelsV2: OpenRouterModel[] = [
  { id: "anthropic/claude-sonnet-5", pricing: { prompt: "0.000003" } },
];

describe("createOpenRouterCatalogCache", () => {
  it("returns the last-good catalog without waiting on a stale refresh", async () => {
    let resolveFetch: ((models: OpenRouterModel[]) => void) | undefined;
    const fetchModels = jest.fn(
      () =>
        new Promise<OpenRouterModel[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const save = jest.fn().mockResolvedValue(undefined);
    let now = 1_000;
    const cache = createOpenRouterCatalogCache({
      fetchModels,
      load: async () => ({ fetchedAt: 0, models: modelsV1 }),
      save,
      now: () => now,
      ttlMs: 100,
    });

    now = 200;
    const got = await cache.get();
    expect(got).toEqual(modelsV1);
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expect(resolveFetch).toBeDefined();
    expect(save).not.toHaveBeenCalled();

    resolveFetch?.(modelsV2);
    await cache.refresh();
    expect(await cache.get()).toEqual(modelsV2);
  });

  it("blocks only on a cold empty cache", async () => {
    const fetchModels = jest.fn().mockResolvedValue(modelsV1);
    const cache = createOpenRouterCatalogCache({
      fetchModels,
      load: async () => null,
      save: async () => undefined,
      now: () => 0,
      ttlMs: 100,
    });

    await expect(cache.get()).resolves.toEqual(modelsV1);
    expect(fetchModels).toHaveBeenCalledTimes(1);
  });

  it("falls through to a blocking fetch when the store load fails", async () => {
    const fetchModels = jest.fn().mockResolvedValue(modelsV1);
    const onRefreshError = jest.fn();
    const cache = createOpenRouterCatalogCache({
      fetchModels,
      load: async () => {
        throw new Error("mongo down");
      },
      save: async () => undefined,
      now: () => 0,
      ttlMs: 100,
      onRefreshError,
    });

    await expect(cache.get()).resolves.toEqual(modelsV1);
    expect(onRefreshError).toHaveBeenCalled();
    expect(fetchModels).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous catalog when refresh fails", async () => {
    const fetchModels = jest
      .fn()
      .mockRejectedValue(new Error("openrouter down"));
    const onRefreshError = jest.fn();
    let now = 1_000;
    const cache = createOpenRouterCatalogCache({
      fetchModels,
      load: async () => ({ fetchedAt: 0, models: modelsV1 }),
      save: async () => undefined,
      now: () => now,
      ttlMs: 100,
      onRefreshError,
    });

    now = 200;
    expect(await cache.get()).toEqual(modelsV1);
    await cache.refresh();
    expect(onRefreshError).toHaveBeenCalled();
    expect(await cache.get()).toEqual(modelsV1);
  });
});
