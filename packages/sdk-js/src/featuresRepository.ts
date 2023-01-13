// feature-repo.ts
import streamManager from "./stream";
import { Context, FeatureDefinition } from ".";

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

export async function loadFeatures(
  apiHost: string,
  clientKey: string,
  context?: Context
): Promise<FeatureApiResponse | null> {
  const key: RepositoryKey = `${apiHost}||${clientKey}`;
  let entry = cache.get(key);
  if (!entry) {
    const data = await fetchFeatures(key, context);
    if (!data) return null;
    entry = {
      data,
      staleAt: new Date(Date.now() + (context?.cacheTTL ?? cacheTTL)),
    };
    cache.set(key, entry);
    savePersistentCache();
  }

  // Refresh in the background if stale
  if (entry.staleAt < new Date()) {
    fetchFeatures(key).catch((e) => {
      console.error(e);
    });
  }

  return entry.data;
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

export function bindStream(
  apiHost: string,
  clientKey: string,
  sdkUid: string,
  //eslint-disable-next-line
  eventCallback: (event: string, resp: FeatureApiResponse) => void,
  context: Context
) {
  // After features are set, bind additional updates from EventSource
  if (streamManager && context?.streaming) {
    const key: RepositoryKey = `${apiHost}||${clientKey}`;
    //eslint-disable-next-line
    const cb = (event: string, resp: any) => {
      const entry: CacheEntry = {
        data: resp as FeatureApiResponse,
        staleAt: new Date(Date.now() + (context?.cacheTTL ?? cacheTTL)),
      };
      cache.set(key, entry);
      savePersistentCache();
      eventCallback(event, resp);
    };
    streamManager.startStream(key, sdkUid, cb);
  }
}
