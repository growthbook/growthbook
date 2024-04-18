import {
  Attributes,
  CacheSettings,
  FeatureApiResponse,
  Helpers,
  Polyfills,
} from "./types/growthbook";
import type { GrowthBook } from ".";

type CacheEntry = {
  data: FeatureApiResponse;
  sse?: boolean;
  version: string;
  staleAt: Date;
};
type ScopedChannel = {
  src: EventSource | null;
  cb: (event: MessageEvent<string>) => void;
  host: string;
  clientKey: string;
  headers?: Record<string, string>;
  errors: number;
  state: "active" | "idle" | "disabled";
};

// Config settings
const cacheSettings: CacheSettings = {
  // Consider a fetch stale after 1 minute
  staleTTL: 1000 * 60,
  // Max time to keep a fetch in cache (24 hours default)
  maxAge: 1000 * 60 * 60 * 24,
  cacheKey: "gbFeaturesCache",
  backgroundSync: true,
  maxEntries: 10,
  disableIdleStreams: false,
  idleStreamInterval: 20000,
};
const polyfills: Polyfills = {
  fetch: globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined,
  SubtleCrypto: globalThis.crypto ? globalThis.crypto.subtle : undefined,
  EventSource: globalThis.EventSource,
};
export const helpers: Helpers = {
  fetchFeaturesCall: ({ host, clientKey, headers }) => {
    return (polyfills.fetch as typeof globalThis.fetch)(
      `${host}/api/features/${clientKey}`,
      { headers }
    );
  },
  fetchRemoteEvalCall: ({ host, clientKey, payload, headers }) => {
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    };
    return (polyfills.fetch as typeof globalThis.fetch)(
      `${host}/api/eval/${clientKey}`,
      options
    );
  },
  eventSourceCall: ({ host, clientKey, headers }) => {
    if (headers) {
      return new polyfills.EventSource(`${host}/sub/${clientKey}`, {
        headers,
      });
    }
    return new polyfills.EventSource(`${host}/sub/${clientKey}`);
  },
  startIdleListener: () => {
    let idleTimeout: number | undefined;
    const isBrowser =
      typeof window !== "undefined" && typeof document !== "undefined";
    if (!isBrowser) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(idleTimeout);
        onVisible();
      } else if (document.visibilityState === "hidden") {
        idleTimeout = window.setTimeout(
          onHidden,
          cacheSettings.idleStreamInterval
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  },
  stopIdleListener: () => {
    // No-op, replaced by startIdleListener
  },
};

try {
  if (globalThis.localStorage) {
    polyfills.localStorage = globalThis.localStorage;
  }
} catch (e) {
  // Ignore localStorage errors
}

// Global state
const subscribedInstances: Map<string, Set<GrowthBook>> = new Map();
let cacheInitialized = false;
const cache: Map<string, CacheEntry> = new Map();
const activeFetches: Map<string, Promise<FeatureApiResponse>> = new Map();
const streams: Map<string, ScopedChannel> = new Map();
const supportsSSE: Set<string> = new Set();

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

export async function refreshFeatures(
  instance: GrowthBook,
  timeout?: number,
  skipCache?: boolean,
  allowStale?: boolean,
  updateInstance?: boolean,
  backgroundSync?: boolean,
  useStoredPayload?: boolean,
  skipExperimentUpdate?: boolean
): Promise<void> {
  if (!backgroundSync) {
    cacheSettings.backgroundSync = false;
  }

  const data = await fetchFeaturesWithCache(
    instance,
    allowStale,
    timeout,
    skipCache,
    useStoredPayload
  );
  const sse = supportsSSE.has(getKey(instance));
  updateInstance &&
    data &&
    (await refreshInstance(instance, data, sse, skipExperimentUpdate));
}

// Subscribe a GrowthBook instance to feature changes
export function subscribe(instance: GrowthBook): void {
  const key = getKey(instance);
  const subs = subscribedInstances.get(key) || new Set();
  subs.add(instance);
  subscribedInstances.set(key, subs);
}
export function unsubscribe(instance: GrowthBook): void {
  subscribedInstances.forEach((s) => s.delete(instance));
}

export function onHidden() {
  streams.forEach((channel) => {
    if (!channel) return;
    channel.state = "idle";
    disableChannel(channel);
  });
}

export function onVisible() {
  streams.forEach((channel) => {
    if (!channel) return;
    if (channel.state !== "idle") return;
    enableChannel(channel);
  });
}

// Private functions

async function updatePersistentCache() {
  try {
    if (!polyfills.localStorage) return;
    await polyfills.localStorage.setItem(
      cacheSettings.cacheKey,
      JSON.stringify(Array.from(cache.entries()))
    );
  } catch (e) {
    // Ignore localStorage errors
  }
}

async function fetchFeaturesWithCache(
  instance: GrowthBook,
  allowStale?: boolean,
  timeout?: number,
  skipCache?: boolean,
  useStoredPayload?: boolean
): Promise<FeatureApiResponse | null> {
  const key = getKey(instance);
  const cacheKey = getCacheKey(instance);
  const now = new Date();

  const minStaleAt = new Date(
    now.getTime() - cacheSettings.maxAge + cacheSettings.staleTTL
  );

  await initializeCache();
  const existing = cache.get(cacheKey);
  if (
    existing &&
    !skipCache &&
    !useStoredPayload &&
    (allowStale || existing.staleAt > now) &&
    existing.staleAt > minStaleAt
  ) {
    // Restore from cache whether SSE is supported
    if (existing.sse) supportsSSE.add(key);

    // Reload features in the background if stale
    if (existing.staleAt < now) {
      fetchFeatures(instance);
    }
    // Otherwise, if we don't need to refresh now, start a background sync
    else {
      startAutoRefresh(instance);
    }
    return existing.data;
  } else {
    return await promiseTimeout(
      fetchFeatures(instance, useStoredPayload),
      timeout
    );
  }
}

function getKey(instance: GrowthBook): string {
  const [apiHost, clientKey] = instance.getApiInfo();
  return `${apiHost}||${clientKey}`;
}

function getCacheKey(instance: GrowthBook): string {
  const baseKey = getKey(instance);
  if (!instance.isRemoteEval()) return baseKey;

  const attributes = instance.getAttributes();
  const cacheKeyAttributes =
    instance.getCacheKeyAttributes() || Object.keys(instance.getAttributes());
  const ca: Attributes = {};
  cacheKeyAttributes.forEach((key) => {
    ca[key] = attributes[key];
  });

  const fv = instance.getForcedVariations();
  const url = instance.getUrl();

  return `${baseKey}||${JSON.stringify({
    ca,
    fv,
    url,
  })}`;
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
    let timer: unknown;
    const finish = (data?: T) => {
      if (resolved) return;
      resolved = true;
      timer && clearTimeout(timer as NodeJS.Timer);
      resolve(data || null);
    };

    if (timeout) {
      timer = setTimeout(() => finish(), timeout);
    }

    promise.then((data) => finish(data)).catch(() => finish());
  });
}

// Populate cache from localStorage (if available)
async function initializeCache(): Promise<void> {
  if (cacheInitialized) return;
  cacheInitialized = true;
  try {
    if (polyfills.localStorage) {
      const value = await polyfills.localStorage.getItem(
        cacheSettings.cacheKey
      );
      if (value) {
        const parsed: [string, CacheEntry][] = JSON.parse(value);
        if (parsed && Array.isArray(parsed)) {
          parsed.forEach(([key, data]) => {
            cache.set(key, {
              ...data,
              staleAt: new Date(data.staleAt),
            });
          });
        }
        cleanupCache();
      }
    }
  } catch (e) {
    // Ignore localStorage errors
  }
  if (!cacheSettings.disableIdleStreams) {
    const cleanupFn = helpers.startIdleListener();
    if (cleanupFn) {
      helpers.stopIdleListener = cleanupFn;
    }
  }
}

// Enforce the maxEntries limit
function cleanupCache() {
  const entriesWithTimestamps = Array.from(cache.entries())
    .map(([key, value]) => ({
      key,
      staleAt: value.staleAt.getTime(),
    }))
    .sort((a, b) => a.staleAt - b.staleAt);

  const entriesToRemoveCount = Math.min(
    Math.max(0, cache.size - cacheSettings.maxEntries),
    cache.size
  );

  for (let i = 0; i < entriesToRemoveCount; i++) {
    cache.delete(entriesWithTimestamps[i].key);
  }
}

// Called whenever new features are fetched from the API
function onNewFeatureData(
  key: string,
  cacheKey: string,
  data: FeatureApiResponse
): void {
  // If contents haven't changed, ignore the update, extend the stale TTL
  const version = data.dateUpdated || "";
  const staleAt = new Date(Date.now() + cacheSettings.staleTTL);
  const existing = cache.get(cacheKey);
  if (existing && version && existing.version === version) {
    existing.staleAt = staleAt;
    updatePersistentCache();
    return;
  }

  const sse = supportsSSE.has(key);
  // Update in-memory cache
  cache.set(cacheKey, {
    data,
    version,
    staleAt,
    sse,
  });
  cleanupCache();
  // Update local storage (don't await this, just update asynchronously)
  updatePersistentCache();

  // Update features for all subscribed GrowthBook instances
  const instances = subscribedInstances.get(key);
  instances &&
    instances.forEach((instance) => refreshInstance(instance, data, sse));
}

async function refreshInstance(
  instance: GrowthBook,
  data: FeatureApiResponse,
  sse?: boolean,
  skipUpdate?: boolean
): Promise<void> {
  instance.shouldStorePayload() && instance.setPayload({ data, sse });
  data = await instance.decryptPayload(data, undefined, polyfills.SubtleCrypto);

  await instance.refreshStickyBuckets(data);
  instance.setFeatures(data.features || instance.getFeatures());
  instance.setExperiments(
    data.experiments || instance.getExperiments(),
    skipUpdate
  );
}

async function fetchFeatures(
  instance: GrowthBook,
  useStoredPayload?: boolean
): Promise<FeatureApiResponse> {
  const { apiHost, apiRequestHeaders } = instance.getApiHosts();
  const clientKey = instance.getClientKey();
  const remoteEval = instance.isRemoteEval();
  const key = getKey(instance);
  const cacheKey = getCacheKey(instance);

  // Bypass normal fetch if hydrating from a stored payload
  const storedPayload = instance.getPayload();
  if (useStoredPayload && storedPayload) {
    const data = storedPayload.data;
    onNewFeatureData(key, cacheKey, data);
    startAutoRefresh(instance);
    if (storedPayload.sse) {
      supportsSSE.add(key);
    }
    return data;
  }

  let promise = !useStoredPayload ? activeFetches.get(cacheKey) : undefined;
  if (!promise) {
    const fetcher: Promise<Response> = remoteEval
      ? helpers.fetchRemoteEvalCall({
          host: apiHost,
          clientKey,
          payload: {
            attributes: instance.getAttributes(),
            forcedVariations: instance.getForcedVariations(),
            forcedFeatures: Array.from(instance.getForcedFeatures().entries()),
            url: instance.getUrl(),
          },
          headers: apiRequestHeaders,
        })
      : helpers.fetchFeaturesCall({
          host: apiHost,
          clientKey,
          headers: apiRequestHeaders,
        });

    // TODO: auto-retry if status code indicates a temporary error
    promise = fetcher
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error: ${res.status}`);
        }
        if (res.headers.get("x-sse-support") === "enabled") {
          supportsSSE.add(key);
        }
        return res.json();
      })
      .then((data: FeatureApiResponse) => {
        onNewFeatureData(key, cacheKey, data);
        startAutoRefresh(instance);
        activeFetches.delete(cacheKey);
        return data;
      })
      .catch((e) => {
        process.env.NODE_ENV !== "production" &&
          instance.log("Error fetching features", {
            apiHost,
            clientKey,
            error: e ? e.message : null,
          });
        activeFetches.delete(cacheKey);
        return Promise.resolve({});
      });
    activeFetches.set(cacheKey, promise);
  }
  return promise;
}

// Watch a feature endpoint for changes
// Will prefer SSE if enabled, otherwise fall back to cron
function startAutoRefresh(instance: GrowthBook): void {
  const key = getKey(instance);
  const cacheKey = getCacheKey(instance);
  const { streamingHost, streamingHostRequestHeaders } = instance.getApiHosts();
  const clientKey = instance.getClientKey();
  if (
    cacheSettings.backgroundSync &&
    supportsSSE.has(key) &&
    polyfills.EventSource
  ) {
    if (streams.has(key)) return;
    const channel: ScopedChannel = {
      src: null,
      host: streamingHost,
      clientKey,
      headers: streamingHostRequestHeaders,
      cb: (event: MessageEvent<string>) => {
        try {
          if (event.type === "features-updated") {
            const instances = subscribedInstances.get(key);
            instances &&
              instances.forEach((instance) => {
                fetchFeatures(instance);
              });
          } else if (event.type === "features") {
            const json: FeatureApiResponse = JSON.parse(event.data);
            onNewFeatureData(key, cacheKey, json);
          }
          // Reset error count on success
          channel.errors = 0;
        } catch (e) {
          process.env.NODE_ENV !== "production" &&
            instance.log("SSE Error", {
              streamingHost,
              clientKey,
              error: e ? (e as Error).message : null,
            });
          onSSEError(channel);
        }
      },
      errors: 0,
      state: "active",
    };
    streams.set(key, channel);
    enableChannel(channel);
  }
}

function onSSEError(channel: ScopedChannel) {
  if (channel.state === "idle") return;
  channel.errors++;
  if (channel.errors > 3 || (channel.src && channel.src.readyState === 2)) {
    // exponential backoff after 4 errors, with jitter
    const delay =
      Math.pow(3, channel.errors - 3) * (1000 + Math.random() * 1000);
    disableChannel(channel);
    setTimeout(() => {
      if (["idle", "active"].includes(channel.state)) return;
      enableChannel(channel);
    }, Math.min(delay, 300000)); // 5 minutes max
  }
}

function disableChannel(channel: ScopedChannel) {
  if (!channel.src) return;
  channel.src.onopen = null;
  channel.src.onerror = null;
  channel.src.close();
  channel.src = null;
  if (channel.state === "active") {
    channel.state = "disabled";
  }
}

function enableChannel(channel: ScopedChannel) {
  channel.src = helpers.eventSourceCall({
    host: channel.host,
    clientKey: channel.clientKey,
    headers: channel.headers,
  }) as EventSource;
  channel.state = "active";
  channel.src.addEventListener("features", channel.cb);
  channel.src.addEventListener("features-updated", channel.cb);
  channel.src.onerror = () => onSSEError(channel);
  channel.src.onopen = () => {
    channel.errors = 0;
  };
}

function destroyChannel(channel: ScopedChannel, key: string) {
  disableChannel(channel);
  streams.delete(key);
}

function clearAutoRefresh() {
  // Clear list of which keys are auto-updated
  supportsSSE.clear();

  // Stop listening for any SSE events
  streams.forEach(destroyChannel);

  // Remove all references to GrowthBook instances
  subscribedInstances.clear();

  // Run the idle stream cleanup function
  helpers.stopIdleListener();
}
