import {
  ApiHost,
  ClientKey,
  FeatureApiResponse,
  LoadFeaturesOptions,
  Polyfills,
  RepositoryKey,
} from "./types/growthbook";
import type { CacheSettings, Context, GrowthBook } from ".";

type CacheEntry = {
  data: FeatureApiResponse;
  version: string;
  staleAt: Date;
};
type ScopedChannel = {
  connection: EventSource;
  listener: (event: MessageEvent<string>) => void;
};

// Config settings that can be set via exported functions
let backgroundSyncEnabled = true;
const polyfills: Polyfills = {
  fetch: globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined,
  SubtleCrypto: globalThis.crypto?.subtle,
  EventSource: globalThis.EventSource,
};
const cacheSettings = {
  localStorageKey: "growthbook:cache:features",
  staleTTL: 1000 * 60, // 1 minute
  pollingInterval: 5000,
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
const autoUpdateKeys: Set<RepositoryKey> = new Set();
const supportsSSE: Set<RepositoryKey> = new Set();
// eslint-disable-next-line
let pollingTimer: any;

// Public functions
export function setPolyfills(overrides: Partial<Polyfills>) {
  Object.assign(polyfills, overrides);
}
export function configureCache(overrides: CacheSettings) {
  Object.assign(cacheSettings, overrides);
}
export function disableBackgroundSync() {
  backgroundSyncEnabled = false;
  clearAutoUpdates();
}
export function resetFeatureRepository() {
  cache.clear();
  cacheInitialized = false;
  activeFetches.clear();
  clearAutoUpdates();

  if (globalThis.localStorage) {
    try {
      globalThis.localStorage.removeItem(cacheSettings.localStorageKey);
    } catch (e) {
      // Ignore localStorage errors
    }
  }
}

function getApiHostAndKey(instance: GrowthBook): [ApiHost, ClientKey, boolean] {
  // eslint-disable-next-line
  const ctx = (instance as any).context as Context;
  const apiHost = ctx.apiHost || "";
  const clientKey = ctx.clientKey || "";
  return [apiHost.replace(/\/*$/, ""), clientKey, !!ctx.enableDevMode];
}

export async function primeCache(
  instance: GrowthBook
): Promise<FeatureApiResponse | null> {
  const [apiHost, clientKey, enableDevMode] = getApiHostAndKey(instance);
  if (!clientKey) return null;
  const key: RepositoryKey = `${apiHost}||${clientKey}`;
  initializeCache();
  const existing = cache.get(key);
  if (existing && !enableDevMode) {
    // Reload features in the backgroud if stale
    if (existing.staleAt < new Date()) {
      fetchFeatures(apiHost, clientKey);
    }
    // Otherwise, if we don't need to refresh now, start a background sync
    else if (backgroundSyncEnabled) {
      startAutoUpdate(apiHost, clientKey, key);
    }
    return existing.data;
  } else {
    const data = await fetchFeatures(apiHost, clientKey);
    return data;
  }
}

export async function loadFeatures(
  instance: GrowthBook,
  options: LoadFeaturesOptions = {}
) {
  const [apiHost, clientKey] = getApiHostAndKey(instance);
  if (!clientKey) return [null, null];
  const key: RepositoryKey = `${apiHost}||${clientKey}`;
  if (!key) return;

  // Fetch features with an optional timeout
  const data = await promiseTimeout(primeCache(instance), options.timeout);

  if (data) {
    await setFeaturesOnInstance(instance, data);
  }
  if (options.autoUpdate) {
    subscribe(key, instance);
  }
}
export function unsubscribe(instance: GrowthBook) {
  subscribedInstances.forEach((s) => s.delete(instance));
}

// Private functions

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
function subscribe(key: RepositoryKey, instance: GrowthBook) {
  const subs = subscribedInstances.get(key) || new Set();
  subs.add(instance);
  subscribedInstances.set(key, subs);
}

// Populate cache from localStorage (if available)
function initializeCache() {
  if (cacheInitialized) return;
  cacheInitialized = true;

  if (globalThis.localStorage) {
    try {
      const value = globalThis.localStorage.getItem(
        cacheSettings.localStorageKey
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
function onNewFeatureData(key: RepositoryKey, data: FeatureApiResponse) {
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
  // Update local storage
  if (globalThis.localStorage) {
    try {
      globalThis.localStorage.setItem(
        cacheSettings.localStorageKey,
        JSON.stringify(Array.from(cache.entries()))
      );
    } catch (e) {
      // Ignore localStorage errors
    }
  }

  // Update features for all subscribed GrowthBook instances
  subscribedInstances
    .get(key)
    ?.forEach((instance) => setFeaturesOnInstance(instance, data));
}

async function setFeaturesOnInstance(
  instance: GrowthBook,
  data: FeatureApiResponse
) {
  await (data.encryptedFeatures
    ? instance.setEncryptedFeatures(
        data.encryptedFeatures,
        undefined,
        polyfills.SubtleCrypto
      )
    : instance.setFeatures(data.features));
}

async function fetchFeatures(apiHost: ApiHost, clientKey: ClientKey) {
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
        if (backgroundSyncEnabled) {
          startAutoUpdate(apiHost, clientKey, key);
        }
        return data;
      })
      .catch((e) => {
        console.error("Error fetching features", e);
        return Promise.resolve({ features: {} });
      })
      .finally(() => {
        activeFetches.delete(key);
      });
    activeFetches.set(key, promise);
  }
  return await promise;
}

// Update any expired cache entries, repeat every 5 seconds
function pollForFeatureChanges() {
  const now = new Date();
  autoUpdateKeys.forEach((key) => {
    // Don't need to poll if this key supports SSE
    if (supportsSSE.has(key)) return;
    const existing = cache.get(key);
    if (existing && existing.staleAt < now) {
      const [apiHost, clientKey] = key.split("||");
      fetchFeatures(apiHost, clientKey);
    }
  });
  pollingTimer = setTimeout(
    pollForFeatureChanges,
    cacheSettings.pollingInterval
  );
}

// Watch a feature endpoint for changes
// Will prefer SSE if enabled, otherwise fall back to cron
function startAutoUpdate(
  apiHost: ApiHost,
  clientKey: ClientKey,
  key: RepositoryKey
) {
  autoUpdateKeys.add(key);
  if (supportsSSE.has(key) && polyfills.EventSource) {
    if (streams.has(key)) return;
    const channel: ScopedChannel = {
      connection: new polyfills.EventSource(`${apiHost}/sub/${clientKey}`),
      listener: (event: MessageEvent<string>) => {
        try {
          const json: FeatureApiResponse = JSON.parse(event.data);
          onNewFeatureData(key, json);
        } catch (e) {
          console.error("SSE Error", e);
        }
      },
    };
    streams.set(key, channel);
    channel.connection.addEventListener("features", channel.listener);
  } else {
    // Ensure polling process is running in the background
    if (!pollingTimer) {
      pollingTimer = setTimeout(
        pollForFeatureChanges,
        cacheSettings.pollingInterval
      );
    }
  }
}

function clearAutoUpdates() {
  // Clear list of which keys are auto-updated
  autoUpdateKeys.clear();
  supportsSSE.clear();

  // Stop listening for any SSE events
  streams.forEach((c) => {
    if (c.connection.removeEventListener) {
      c.connection.removeEventListener("features", c.listener);
    }
    c.connection.close();
  });
  streams.clear();

  // Remove all references to GrowthBook instances
  subscribedInstances.clear();

  // Stop the polling process
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}
