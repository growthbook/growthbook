import {
  ApiHost,
  CacheSettings,
  ClientKey,
  FeatureApiResponse,
  LoadFeaturesOptions,
  Polyfills,
  RefreshFeaturesOptions,
  RepositoryKey,
} from "./types/growthbook";
import type { Context, GrowthBook } from ".";

type CacheEntry = {
  data: FeatureApiResponse;
  version: string;
  staleAt: Date;
};
type ScopedChannel = {
  src: EventSource;
  cb: (event: MessageEvent<string>) => void;
  errors: number;
};

// Config settings
const cacheSettings: CacheSettings = {
  // Consider a fetch stale after 1 minute
  staleTTL: 1000 * 60,
  cacheKey: "gbFeaturesCache",
  backgroundSync: true,
};
const polyfills: Polyfills = {
  fetch: globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined,
  SubtleCrypto: globalThis.crypto ? globalThis.crypto.subtle : undefined,
  EventSource: globalThis.EventSource,
  localStorage: globalThis.localStorage,
};

// Global state
const subscribedInstances: Map<RepositoryKey, Set<GrowthBook>> = new Map();
let cacheInitialized = false;
const cache: Map<RepositoryKey, CacheEntry> = new Map();
const activeFetches: Map<
  RepositoryKey,
  Promise<FeatureApiResponse>
> = new Map();
const streams: Map<RepositoryKey, ScopedChannel> = new Map();
const supportsSSE: Set<RepositoryKey> = new Set();

// Public functions
export function setPolyfills(overrides: Partial<Polyfills>): void {
  Object.assign(polyfills, overrides);
}
export function configureCache(overrides: Partial<CacheSettings>): void {
  Object.assign(cacheSettings, overrides);
  if (!cacheSettings.backgroundSync) {
    clearAutoRefresh();
  }
}

export async function clearCache(): Promise<void> {
  cache.clear();
  activeFetches.clear();
  clearAutoRefresh();
  cacheInitialized = false;
  await updatePersistentCache();
}

export async function fetchFeaturesWithCache(
  instance: GrowthBook,
  allowStale?: boolean,
  timeout?: number,
  skipCache?: boolean
): Promise<FeatureApiResponse | null> {
  const [key, apiHost, clientKey, enableDevMode] = getKey(instance);
  if (!clientKey) return null;
  const now = new Date();
  await initializeCache();
  const existing = cache.get(key);
  if (
    existing &&
    !enableDevMode &&
    !skipCache &&
    (allowStale || existing.staleAt > now)
  ) {
    // Reload features in the backgroud if stale
    if (existing.staleAt < now) {
      fetchFeatures(instance, apiHost, clientKey);
    }
    // Otherwise, if we don't need to refresh now, start a background sync
    else {
      startAutoRefresh(instance, apiHost, clientKey, key);
    }
    return existing.data;
  } else {
    const data = await promiseTimeout(
      fetchFeatures(instance, apiHost, clientKey),
      timeout
    );
    return data;
  }
}

export async function refreshFeatures(
  instance: GrowthBook,
  options?: RefreshFeaturesOptions
): Promise<void> {
  options = options || {};
  const data = await fetchFeaturesWithCache(
    instance,
    false,
    options.timeout,
    options.skipCache
  );
  data && (await setFeaturesOnInstance(instance, data));
}

export async function loadFeatures(
  instance: GrowthBook,
  options?: LoadFeaturesOptions
): Promise<void> {
  options = options || {};
  // Fetch features with an optional timeout
  const data = await fetchFeaturesWithCache(instance, true, options.timeout);
  if (data) {
    await setFeaturesOnInstance(instance, data);
  }
  if (options.autoRefresh) {
    subscribe(instance);
  }
}
export function unsubscribe(instance: GrowthBook): void {
  subscribedInstances.forEach((s) => s.delete(instance));
}

// Private functions
async function updatePersistentCache() {
  try {
    await polyfills.localStorage.setItem(
      cacheSettings.cacheKey,
      JSON.stringify(Array.from(cache.entries()))
    );
  } catch (e) {
    // Ignore localStorage errors
  }
}

function getKey(
  instance: GrowthBook
): [RepositoryKey, ApiHost, ClientKey, boolean] {
  // eslint-disable-next-line
  const ctx = (instance as any).context as Context;
  const apiHost = ctx.apiHost || "";
  const clientKey = ctx.clientKey || "";
  return [
    `${apiHost}||${clientKey}`,
    apiHost.replace(/\/*$/, ""),
    clientKey,
    !!ctx.enableDevMode,
  ];
}

// Guarantee the promise always resolves within {timeout} ms
// Resolved value will be `null` when there's an error or it takes too long
// Note: The promise will continue running in the background, even if the timeout is hit
function promiseTimeout<T>(
  promise: Promise<T>,
  timeout?: number
): Promise<T | null> {
  return new Promise((resolve) => {
    let resolved = false;
    // eslint-disable-next-line
    let timer: any;
    const finish = (data?: T) => {
      if (resolved) return;
      resolved = true;
      timer && clearTimeout(timer);
      resolve(data || null);
    };

    if (timeout) {
      timer = setTimeout(() => finish(), timeout);
    }

    promise.then((data) => finish(data)).catch(() => finish());
  });
}

// Subscribe a GrowthBook instance to feature changes
function subscribe(instance: GrowthBook): void {
  const [key] = getKey(instance);
  const subs = subscribedInstances.get(key) || new Set();
  subs.add(instance);
  subscribedInstances.set(key, subs);
}

// Populate cache from localStorage (if available)
async function initializeCache(): Promise<void> {
  if (cacheInitialized) return;
  cacheInitialized = true;
  if (polyfills.localStorage) {
    try {
      const value = await polyfills.localStorage.getItem(
        cacheSettings.cacheKey
      );
      if (value) {
        const parsed: [RepositoryKey, CacheEntry][] = JSON.parse(value);
        if (parsed && Array.isArray(parsed)) {
          parsed.forEach(([key, data]) => {
            cache.set(key, {
              ...data,
              staleAt: new Date(data.staleAt),
            });
          });
        }
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }
}

// Called whenever new features are fetched from the API
function onNewFeatureData(key: RepositoryKey, data: FeatureApiResponse): void {
  // If contents haven't changed, ignore the update, extend the stale TTL
  const version = data.dateUpdated || "";
  const staleAt = new Date(Date.now() + cacheSettings.staleTTL);
  const existing = cache.get(key);
  if (existing && version && existing.version === version) {
    existing.staleAt = staleAt;
    return;
  }

  // Update in-memory cache
  cache.set(key, {
    data,
    version,
    staleAt,
  });
  // Update local storage (don't await this, just update asynchronously)
  updatePersistentCache();

  // Update features for all subscribed GrowthBook instances
  const instances = subscribedInstances.get(key);
  instances &&
    instances.forEach((instance) => setFeaturesOnInstance(instance, data));
}

async function setFeaturesOnInstance(
  instance: GrowthBook,
  data: FeatureApiResponse
): Promise<void> {
  await (data.encryptedFeatures
    ? instance.setEncryptedFeatures(
        data.encryptedFeatures,
        undefined,
        polyfills.SubtleCrypto
      )
    : instance.setFeatures(data.features));
}

async function fetchFeatures(
  instance: GrowthBook,
  apiHost: ApiHost,
  clientKey: ClientKey
): Promise<FeatureApiResponse> {
  const key: RepositoryKey = `${apiHost}||${clientKey}`;
  const endpoint = apiHost + "/api/features/" + clientKey;

  let promise = activeFetches.get(key);
  if (!promise) {
    promise = (polyfills.fetch as typeof globalThis.fetch)(endpoint)
      // TODO: auto-retry if status code indicates a temporary error
      .then((res) => {
        if (res.headers.get("x-sse-support") === "enabled") {
          supportsSSE.add(key);
        }
        return res.json();
      })
      .then((data: FeatureApiResponse) => {
        onNewFeatureData(key, data);
        startAutoRefresh(instance, apiHost, clientKey, key);
        activeFetches.delete(key);
        return data;
      })
      .catch((e) => {
        process.env.NODE_ENV !== "production" &&
          instance.log("Error fetching features", {
            apiHost,
            clientKey,
            error: e ? e.message : null,
          });
        activeFetches.delete(key);
        return Promise.resolve({ features: {} });
      });
    activeFetches.set(key, promise);
  }
  return await promise;
}

// Watch a feature endpoint for changes
// Will prefer SSE if enabled, otherwise fall back to cron
function startAutoRefresh(
  instance: GrowthBook,
  apiHost: ApiHost,
  clientKey: ClientKey,
  key: RepositoryKey
) {
  if (
    cacheSettings.backgroundSync &&
    supportsSSE.has(key) &&
    polyfills.EventSource
  ) {
    if (streams.has(key)) return;
    const channel: ScopedChannel = {
      src: new polyfills.EventSource(`${apiHost}/sub/${clientKey}`),
      cb: (event: MessageEvent<string>) => {
        try {
          const json: FeatureApiResponse = JSON.parse(event.data);
          onNewFeatureData(key, json);
          // Reset error count on success
          channel.errors = 0;
        } catch (e) {
          process.env.NODE_ENV !== "production" &&
            instance.log("SSE Error", {
              apiHost,
              clientKey,
              error: e ? (e as Error).message : null,
            });
          onSSEError(key, channel);
        }
      },
      errors: 0,
    };
    streams.set(key, channel);
    channel.src.addEventListener("features", channel.cb);

    channel.src.onerror = () => {
      onSSEError(key, channel);
    };
  }
}

function onSSEError(key: RepositoryKey, channel: ScopedChannel) {
  channel.errors++;
  if (channel.errors > 3 || channel.src.readyState === 2) {
    destroyChannel(channel, key);
  }
}

function destroyChannel(channel: ScopedChannel, key: RepositoryKey) {
  channel.src.onerror = null;
  channel.src.close();
  streams.delete(key);
}

function clearAutoRefresh() {
  // Clear list of which keys are auto-updated
  supportsSSE.clear();

  // Stop listening for any SSE events
  streams.forEach(destroyChannel);

  // Remove all references to GrowthBook instances
  subscribedInstances.clear();
}
