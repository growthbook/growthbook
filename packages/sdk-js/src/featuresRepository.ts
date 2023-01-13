// feature-repo.ts
import streamManager from "./stream";
import { Context, FeatureDefinition, GrowthBook } from ".";

export type ApiHost = string;
export type ClientKey = string;
export type RepositoryKey = `${ApiHost}||${ClientKey}`;

export type FeatureApiResponse = {
  features: Record<string, FeatureDefinition>;
  encryptedFeatures?: string;
};

type CacheEntry = {
  data: FeatureApiResponse;
  staleAt: Date;
};

const cacheTTL = 1000 * 60; // 1 minute
const cache: Map<RepositoryKey, CacheEntry> = new Map();

// Fetch with debouncing
const activeFetches: Map<
  RepositoryKey,
  Promise<FeatureApiResponse>
> = new Map();

type CallbackRegistry = Map<
  GrowthBook,
  [RepositoryKey, (resp: FeatureApiResponse) => Promise<void>]
>;
const onChangeCallbackRegistry: CallbackRegistry = new Map();

// Request features from server or cache. Upon success, start SSE stream for realtime updates.
export async function loadFeatures(
  context: Context
): Promise<FeatureApiResponse | null> {
  const key: RepositoryKey = `${context.apiHost}||${context.clientKey}`;
  let entry = cache.get(key);
  if (!entry) {
    const data = await fetchFeatures(key, context);
    if (!data) return null;
    entry = await updateCacheFromPayload(key, data, context);
  } else {
    await triggerCallbacks(key, entry);
    refetchCacheIfStale(key, entry, context).catch((e) => console.error(e));
  }

  if (context?.streaming) {
    // Create stream manager if not already created
    streamManager.initialize(context?.eventSource);
    // Start a key-scoped stream if not already started
    streamManager.startStream(key, (event, payload) => {
      if (event === "features") {
        updateCacheFromPayload(key, payload, context);
      }
    });
  }

  // legacy: return the data directly
  return entry.data;
}

async function fetchFeatures(
  key: RepositoryKey,
  context?: Context
): Promise<FeatureApiResponse | null> {
  let promise = activeFetches.get(key);
  if (!promise) {
    const [apiHost, clientKey] = key.split("||");
    const url = `${apiHost}/api/features/${clientKey}`;
    // TODO: timeout using AbortController
    promise = (context?.fetch ?? globalThis.fetch)(url)
      // TODO: auto-retry if status code indicates a temporary error
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return Promise.resolve(null);
      })
      .finally(() => {
        activeFetches.delete(key);
      });
    activeFetches.set(key, promise);
  }
  return await promise;
}

export function loadPersistentCache() {
  if (typeof globalThis?.localStorage === "object") {
    const lsCacheEntry = globalThis.localStorage.getItem(
      "growthbook:cache:features"
    );
    if (lsCacheEntry) {
      try {
        const cacheObj = new Map(JSON.parse(lsCacheEntry));
        // eslint-disable-next-line
        cacheObj.forEach((value: any, key: any) => {
          value.staleAt = new Date(value.staleAt);
          if (value.staleAt >= new Date()) {
            cache.set(key as RepositoryKey, value as CacheEntry);
          } else {
            cache.delete(key as RepositoryKey);
          }
        });
      } catch (e) {
        console.error(e);
      }
    }
  }
}

function savePersistentCache() {
  if (typeof globalThis?.localStorage === "object") {
    const cacheObj = Array.from(cache.entries());
    globalThis.localStorage.setItem(
      "growthbook:cache:features",
      JSON.stringify(cacheObj)
    );
  }
}

async function updateCacheFromPayload(
  key: RepositoryKey,
  // eslint-disable-next-line
  data: any,
  context?: Context
) {
  const entry = {
    data: data as FeatureApiResponse,
    staleAt: new Date(Date.now() + (context?.cacheTTL ?? cacheTTL)),
  };
  cache.set(key, entry);
  savePersistentCache();
  await triggerCallbacks(key, entry);

  return entry;
}

async function triggerCallbacks(key: RepositoryKey, entry: CacheEntry) {
  const promises = Array.from(onChangeCallbackRegistry)
    .map(([_, [cbKey, cb]]) => {
      if (cbKey === key) {
        return cb(entry.data);
      }
    })
    .filter((v) => v !== undefined);
  await Promise.all(promises);
  return;
}

async function refetchCacheIfStale(
  key: RepositoryKey,
  entry: CacheEntry,
  context?: Context
) {
  // Refresh in the background if stale
  if (entry.staleAt < new Date()) {
    const data = await fetchFeatures(key, context);
    if (data) {
      await updateCacheFromPayload(key, data, context);
    }
  }
}

export function registerOnChangeCallback(
  context: Context,
  that: GrowthBook,
  cb: (resp: FeatureApiResponse) => Promise<void>
) {
  if (onChangeCallbackRegistry.has(that)) {
    return;
  }
  const key: RepositoryKey = `${context.apiHost}||${context.clientKey}`;
  onChangeCallbackRegistry.set(that, [key, cb]);
}

export function unregisterOnChangeCallback(that: GrowthBook) {
  onChangeCallbackRegistry.delete(that);
}

export function forceClearRepository() {
  cache.clear();
  activeFetches.clear();
  onChangeCallbackRegistry.clear();
  savePersistentCache();
}
