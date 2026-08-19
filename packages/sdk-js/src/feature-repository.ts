import {
  Attributes,
  CacheSettings,
  FeatureApiResponse,
  FetchResponse,
  Helpers,
  Polyfills,
} from "./types/growthbook";
import { getPolyfills, promiseTimeout } from "./util";
import type {
  GrowthBook,
  InitOptions,
  InitSyncOptions,
  GrowthBookClient,
} from ".";

type CacheEntry = {
  data: FeatureApiResponse;
  sse?: boolean;
  version: string;
  staleAt: Date;
};
type Poller = {
  timer: ReturnType<typeof setTimeout> | null;
  interval: number;
  errors: number;
};
type ScopedChannel = {
  src: EventSource | null;
  cb: (event: MessageEvent<string>) => void;
  key: string;
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
  // Max time to keep a fetch in cache (4 hours default)
  maxAge: 1000 * 60 * 60 * 4,
  cacheKey: "gbFeaturesCache",
  backgroundSync: true,
  maxEntries: 10,
  disableIdleStreams: false,
  idleStreamInterval: 20000,
  disableCache: false,
};

const polyfills = getPolyfills();

export const helpers: Helpers = {
  fetchFeaturesCall: ({ host, clientKey, headers }) => {
    return (polyfills.fetch as typeof globalThis.fetch)(
      `${host}/api/features/${clientKey}`,
      { headers },
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
      options,
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
          cacheSettings.idleStreamInterval,
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
const subscribedInstances: Map<
  string,
  Set<GrowthBook | GrowthBookClient>
> = new Map();
let cacheInitialized = false;
const cache: Map<string, CacheEntry> = new Map();
const activeFetches: Map<string, Promise<FetchResponse>> = new Map();
const streams: Map<string, ScopedChannel> = new Map();
const pollers: Map<string, Poller> = new Map();
const supportsSSE: Set<string> = new Set();
const streamingWarnings: Set<string> = new Set();

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

// Get or fetch features and refresh the SDK instance
export async function refreshFeatures({
  instance,
  timeout,
  skipCache,
  allowStale,
  backgroundSync,
}: {
  instance: GrowthBook | GrowthBookClient;
  timeout?: number;
  skipCache?: boolean;
  allowStale?: boolean;
  backgroundSync?: boolean;
}): Promise<FetchResponse> {
  if (!backgroundSync) {
    cacheSettings.backgroundSync = false;
  }

  return fetchFeaturesWithCache({
    instance,
    allowStale,
    timeout,
    skipCache,
  });
}

// Subscribe a GrowthBook instance to feature changes
function subscribe(instance: GrowthBook | GrowthBookClient): void {
  const key = getKey(instance);
  const subs = subscribedInstances.get(key) || new Set();
  subs.add(instance);
  subscribedInstances.set(key, subs);
}
export function unsubscribe(instance: GrowthBook | GrowthBookClient): void {
  subscribedInstances.forEach((s, key) => {
    s.delete(instance);
    // Nothing left to refresh, so stop polling this key
    const poller = s.size ? undefined : pollers.get(key);
    if (poller) destroyPoller(poller, key);
  });
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

const MAX_BACKOFF_MS = 1000 * 60 * 5;

// Exponential backoff. Jitter is proportional rather than flat, so that clients retrying
// against the same host spread out instead of bunching at the same offset.
function backoffDelay(base: number, factor: number, attempt: number): number {
  return Math.min(
    base * Math.pow(factor, attempt) * (1 + Math.random()),
    MAX_BACKOFF_MS,
  );
}

// The only place the SDK warns directly rather than through the env-gated instance.log().
// log() is debug-only, so routing a misconfiguration through it would hide the problem from
// exactly the production users it affects. Diagnostics still belong in instance.log().
function warnMisconfiguration(message: string): void {
  console.warn(`[GrowthBook] ${message}`);
}

// Deduped per reason, so a process warns once about each distinct cause
function warnStreamingUnavailable(reason: string): void {
  if (streamingWarnings.has(reason)) return;
  streamingWarnings.add(reason);
  warnMisconfiguration(
    `Streaming is enabled, but not active: ${reason}. Features will not be updated in the background. Set \`pollingInterval\` to refresh on a timer instead, or see https://docs.growthbook.io/lib/node#refreshing-features`,
  );
}

async function updatePersistentCache() {
  try {
    if (!polyfills.localStorage) return;
    await polyfills.localStorage.setItem(
      cacheSettings.cacheKey,
      JSON.stringify(Array.from(cache.entries())),
    );
  } catch (e) {
    // Ignore localStorage errors
  }
}

// SWR wrapper for fetching features. May indirectly or directly start SSE streaming.
async function fetchFeaturesWithCache({
  instance,
  allowStale,
  timeout,
  skipCache,
}: {
  instance: GrowthBook | GrowthBookClient;
  allowStale?: boolean;
  timeout?: number;
  skipCache?: boolean;
}): Promise<FetchResponse> {
  const key = getKey(instance);
  const cacheKey = getCacheKey(instance);
  const now = new Date();

  const minStaleAt = new Date(
    now.getTime() - cacheSettings.maxAge + cacheSettings.staleTTL,
  );

  await initializeCache();
  const existing =
    !cacheSettings.disableCache && !skipCache ? cache.get(cacheKey) : undefined;
  if (
    existing &&
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
    return { data: existing.data, success: true, source: "cache" };
  } else {
    const res = await promiseTimeout(fetchFeatures(instance), timeout);
    return (
      res || {
        data: null,
        success: false,
        source: "timeout",
        error: new Error("Timeout"),
      }
    );
  }
}

function getKey(instance: GrowthBook | GrowthBookClient): string {
  const [apiHost, clientKey] = instance.getApiInfo();
  return `${apiHost}||${clientKey}`;
}

function getCacheKey(instance: GrowthBook | GrowthBookClient): string {
  const baseKey = getKey(instance);
  if (!("isRemoteEval" in instance) || !instance.isRemoteEval()) return baseKey;

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

// Populate cache from localStorage (if available)
async function initializeCache(): Promise<void> {
  if (cacheInitialized) return;
  cacheInitialized = true;
  try {
    if (polyfills.localStorage) {
      const value = await polyfills.localStorage.getItem(
        cacheSettings.cacheKey,
      );
      if (!cacheSettings.disableCache && value) {
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
    cache.size,
  );

  for (let i = 0; i < entriesToRemoveCount; i++) {
    cache.delete(entriesWithTimestamps[i].key);
  }
}

// Called whenever new features are fetched from the API
function onNewFeatureData(
  key: string,
  cacheKey: string,
  data: FeatureApiResponse,
): void {
  // If contents haven't changed, ignore the update, extend the stale TTL
  const version = data.dateUpdated || "";
  const staleAt = new Date(Date.now() + cacheSettings.staleTTL);
  const existing = !cacheSettings.disableCache
    ? cache.get(cacheKey)
    : undefined;
  if (existing && version && existing.version === version) {
    existing.staleAt = staleAt;
    updatePersistentCache();
    return;
  }

  if (!cacheSettings.disableCache) {
    // Update in-memory cache
    cache.set(cacheKey, {
      data,
      version,
      staleAt,
      sse: supportsSSE.has(key),
    });
    cleanupCache();
  }
  // Update local storage (don't await this, just update asynchronously)
  updatePersistentCache();

  // Update features for all subscribed GrowthBook instances
  const instances = subscribedInstances.get(key);
  instances && instances.forEach((instance) => refreshInstance(instance, data));
}

async function refreshInstance(
  instance: GrowthBook | GrowthBookClient,
  data: FeatureApiResponse | null,
): Promise<void> {
  await instance.setPayload(data || instance.getPayload());
}

// Fetch the features payload from helper function or from in-mem injected payload
async function fetchFeatures(
  instance: GrowthBook | GrowthBookClient,
): Promise<FetchResponse> {
  const { apiHost, apiRequestHeaders } = instance.getApiHosts();
  const clientKey = instance.getClientKey();
  const remoteEval = "isRemoteEval" in instance && instance.isRemoteEval();
  const key = getKey(instance);
  const cacheKey = getCacheKey(instance);

  let promise = activeFetches.get(cacheKey);
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
        return { data, success: true, source: "network" as const };
      })
      .catch((e) => {
        process.env.NODE_ENV !== "production" &&
          instance.log("Error fetching features", {
            apiHost,
            clientKey,
            error: e ? e.message : null,
          });
        activeFetches.delete(cacheKey);

        return {
          data: null,
          source: "error" as const,
          success: false,
          error: e,
        };
      });
    activeFetches.set(cacheKey, promise);
  }
  return promise;
}

// Start SSE streaming, listens to feature payload changes and triggers a refresh or re-fetch
function startAutoRefresh(
  instance: GrowthBook | GrowthBookClient,
  forceSSE: boolean = false,
): void {
  const key = getKey(instance);
  const cacheKey = getCacheKey(instance);
  const { streamingHost, streamingHostRequestHeaders } = instance.getApiHosts();
  const clientKey = instance.getClientKey();

  if (forceSSE) {
    supportsSSE.add(key);
  }

  if (
    cacheSettings.backgroundSync &&
    supportsSSE.has(key) &&
    polyfills.EventSource
  ) {
    if (streams.has(key)) return;
    const channel: ScopedChannel = {
      src: null,
      key,
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
    const delay = backoffDelay(1000, 3, channel.errors - 3);
    disableChannel(channel);
    setTimeout(() => {
      if (["idle", "active"].includes(channel.state)) return;
      // A channel dropped while backing off (destroy, clearCache) must not reconnect:
      // it would open an EventSource nothing tracks or can ever close
      if (streams.get(channel.key) !== channel) return;
      enableChannel(channel);
    }, delay);
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
  try {
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
      // Retire polling once the stream is confirmed open, not merely constructed -
      // a stream blocked by a proxy is exactly why someone configured polling
      const poller = pollers.get(channel.key);
      if (poller) destroyPoller(poller, channel.key);
    };
  } catch (e) {
    // A half-built connection may already be open, so close it before dropping the ref
    try {
      if (channel.src) {
        channel.src.close();
        channel.src.onerror = null;
        channel.src.onopen = null;
      }
    } catch (closeError) {
      // Ignore cleanup errors from incompatible implementations
    }
    channel.src = null;
    channel.state = "disabled";
    // Evict so the existing-key guard can't block a later retry, but only if this channel
    // is still the registered one - a stale re-connect must not evict its replacement
    if (streams.get(channel.key) === channel) streams.delete(channel.key);
    warnStreamingUnavailable(
      `the EventSource implementation threw an error (${
        e ? (e as Error).message : "unknown error"
      })`,
    );
  }
}

function destroyChannel(channel: ScopedChannel, key: string) {
  disableChannel(channel);
  streams.delete(key);
}

// Refresh on a fixed interval. Deduped per key, so many instances sharing a clientKey poll once.
function startPolling(key: string, interval: number): void {
  // setTimeout collapses an out-of-range delay to 1ms, turning a typo into a request loop
  if (!Number.isFinite(interval) || interval < 1 || interval > 2147483647) {
    warnMisconfiguration(
      `Ignoring invalid pollingInterval (${interval}). Expected a finite number of milliseconds between 1 and 2147483647.`,
    );
    return;
  }
  if (pollers.has(key)) return;

  const poller: Poller = { timer: null, interval, errors: 0 };
  pollers.set(key, poller);
  scheduleNextPoll(key, poller);
}

function scheduleNextPoll(key: string, poller: Poller): void {
  // Gentler curve than onSSEError's, since this one already starts from the
  // user's configured interval rather than a fixed 1s
  const delay =
    poller.errors > 0
      ? backoffDelay(poller.interval, 2, poller.errors - 1)
      : poller.interval;

  const timer = setTimeout(() => {
    // Resolve a subscriber at poll time. The instance that started polling may have been
    // destroyed, which clears its options and would send us to the wrong host.
    const subs = subscribedInstances.get(key);
    const instance = subs && subs.values().next().value;
    if (!instance) {
      destroyPoller(poller, key);
      return;
    }

    // Bypass the cache so the interval, not staleTTL, decides how often we refresh
    fetchFeatures(instance).then((res) => {
      poller.errors = res.success ? 0 : poller.errors + 1;
      // Don't reschedule if polling was stopped while the request was in flight
      if (pollers.get(key) === poller) {
        scheduleNextPoll(key, poller);
      }
    });
  }, delay) as ReturnType<typeof setTimeout> & { unref?: () => void };

  // Never hold a short-lived process (serverless, CLI) open just to poll
  if (timer.unref) timer.unref();
  poller.timer = timer;
}

function destroyPoller(poller: Poller, key: string) {
  if (poller.timer) clearTimeout(poller.timer);
  pollers.delete(key);
}

export function clearAutoRefresh() {
  // Clear list of which keys are auto-updated
  supportsSSE.clear();
  streamingWarnings.clear();

  // Stop listening for any SSE events
  streams.forEach(destroyChannel);

  // Stop any background polling
  pollers.forEach(destroyPoller);

  // Remove all references to GrowthBook instances
  subscribedInstances.clear();

  // Run the idle stream cleanup function
  helpers.stopIdleListener();
}

export function startBackgroundSync(
  instance: GrowthBook | GrowthBookClient,
  options: InitOptions | InitSyncOptions,
) {
  if (!options.streaming && options.pollingInterval === undefined) return;

  if (!instance.getClientKey()) {
    throw new Error("Must specify clientKey to enable streaming or polling");
  }

  if (options.streaming) {
    if (options.payload) {
      startAutoRefresh(instance, true);
    }
    if (!polyfills.EventSource) {
      warnStreamingUnavailable(
        "no EventSource implementation is available. In Node.js, install the `eventsource` package and pass it to setPolyfills({ EventSource })",
      );
    } else if (
      cacheSettings.backgroundSync &&
      !supportsSSE.has(getKey(instance))
    ) {
      // Keyed on supportsSSE rather than an absent stream, so an EventSource that
      // failed to start (already warned about above) doesn't also get blamed here
      warnStreamingUnavailable(
        "the API host did not report SSE support (missing `x-sse-support` response header). This is also expected when the initial payload fetch fails",
      );
    }
  }

  subscribe(instance);

  // Not gated on an existing stream: startAutoRefresh opens one whenever the host
  // advertises SSE, so gating here would drop the polling that was asked for if that
  // stream never connects. onopen retires the poller once it does.
  // Checked against undefined so 0 reaches startPolling's validation warning
  const key = getKey(instance);
  if (options.pollingInterval !== undefined && cacheSettings.backgroundSync) {
    startPolling(key, options.pollingInterval);
  }
}
