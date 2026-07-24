import { loadSDKVersion } from "../util";
import type { Attributes, EventProperties } from "../types/growthbook";
import type { GrowthBook } from "../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../GrowthBookClient";
import { EVENT_EXPERIMENT_VIEWED, EVENT_FEATURE_EVALUATED } from "../core";

const SDK_VERSION = loadSDKVersion();

type GlobalTrackedEvent = {
  eventName: string;
  properties: Record<string, unknown>;
};
declare global {
  interface Window {
    gbEvents?:
      | (GlobalTrackedEvent | string)[]
      | {
          push: (event: GlobalTrackedEvent | string) => void;
        };
  }
}

type EventPayload = {
  event_name: string;
  properties_json: Record<string, unknown>;
  sdk_language: string;
  sdk_version: string;
  url: string;
  context_json: Record<string, unknown>;
  user_id: string | null;
  device_id: string | null;
  page_id: string | null;
  session_id: string | null;
  page_title?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
};

function parseString(value: unknown): null | string {
  return typeof value === "string" ? value : null;
}

function utf8ByteLength(str: string): number {
  return typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(str).length
    : str.length * 3; // conservative upper bound without TextEncoder
}

function parseAttributes(attributes: Attributes): {
  nested: Attributes;
  topLevel: {
    user_id: string | null;
    device_id: string | null;
    page_id: string | null;
    session_id: string | null;
    page_title?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
  };
} {
  const {
    user_id,
    device_id,
    anonymous_id,
    id,
    page_id,
    session_id,
    utmCampaign,
    utmContent,
    utmMedium,
    utmSource,
    utmTerm,
    pageTitle,
    ...nested
  } = attributes;

  return {
    nested,
    topLevel: {
      user_id: parseString(user_id),
      device_id: parseString(device_id || anonymous_id || id),
      page_id: parseString(page_id),
      session_id: parseString(session_id),
      utm_campaign: parseString(utmCampaign) || undefined,
      utm_content: parseString(utmContent) || undefined,
      utm_medium: parseString(utmMedium) || undefined,
      utm_source: parseString(utmSource) || undefined,
      utm_term: parseString(utmTerm) || undefined,
      page_title: parseString(pageTitle) || undefined,
    },
  };
}

type EventData = {
  eventName: string;
  properties: EventProperties;
  attributes: Attributes;
  url: string;
};

function getEventPayload({
  eventName,
  properties,
  attributes,
  url,
}: EventData): EventPayload {
  const { nested, topLevel } = parseAttributes(attributes || {});

  return {
    event_name: eventName,
    properties_json: properties || {},
    ...topLevel,
    sdk_language: "js",
    sdk_version: SDK_VERSION,
    url: url,
    context_json: nested,
  };
}

export type TrackingTransport = "auto" | "beacon" | "fetch";

async function track({
  clientKey,
  ingestorHost,
  events,
  useBeacon,
}: {
  events: EventPayload[];
  clientKey: string;
  ingestorHost?: string;
  useBeacon?: boolean;
}) {
  if (!events.length) return;

  const endpoint = `${
    ingestorHost || "https://us1.gb-ingest.com"
  }/track?client_key=${clientKey}`;
  const body = JSON.stringify(events);

  // sendBeacon is queued by the browser and survives page unload even where
  // fetch keepalive is unsupported. text/plain keeps it a CORS simple request.
  // Unlike the fetch below, sendBeacon cannot omit credentials; use
  // transport "fetch" if cookies must never reach the ingestor origin.
  if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      if (
        navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }))
      ) {
        return;
      }
      // Beacon rejected (e.g. payload over the beacon quota) - fall through
    } catch (e) {
      // Fall through to fetch
    }
  }

  try {
    await fetch(endpoint, {
      method: "POST",
      body,
      headers: {
        Accept: "application/json",
        "Content-Type": "text/plain",
      },
      credentials: "omit",
      // Let the request outlive the page; exposures fired just before a
      // navigation (e.g. redirect tests) are otherwise cancelled by the
      // browser. Keepalive bodies share a 64KB in-flight *byte* quota and
      // larger ones are rejected outright, so oversized batches skip it.
      keepalive: utf8ByteLength(body) < 60000,
    });
  } catch (e) {
    console.error("Failed to track event", e);
  }
}

export function growthbookTrackingPlugin({
  queueFlushInterval = 100,
  ingestorHost,
  enable = true,
  debug,
  dedupeCacheSize = 1000,
  dedupeKeyAttributes = [],
  eventFilter,
  transport = "auto",
}: {
  // TODO: add option to allow filtering out certain attributes that contain PII
  queueFlushInterval?: number;
  ingestorHost?: string;
  enable?: boolean;
  debug?: boolean;
  dedupeCacheSize?: number;
  dedupeKeyAttributes?: string[];
  eventFilter?: (event: EventData) => boolean;
  // "auto" (default): fetch with keepalive, plus sendBeacon when the page is
  // unloading. "beacon": always prefer sendBeacon. "fetch": never use beacon.
  transport?: TrackingTransport;
} = {}) {
  return (gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient) => {
    const clientKey = gb.getClientKey();
    if (!clientKey) {
      throw new Error("clientKey must be specified to use event logging");
    }

    // LRU cache for events to avoid duplicates
    const eventCache = new Set<string>();

    if ("setEventLogger" in gb) {
      let _q: EventPayload[] = [];
      let timer: NodeJS.Timeout | null = null;
      let promise: Promise<void> | null = null;
      let flushDone: (() => void) | null = null;
      const flush = async (unloading?: boolean) => {
        const events = _q;
        _q = [];
        timer && clearTimeout(timer);
        timer = null;
        // Release the in-flight promise so later events schedule a new flush
        // (an unload flush cancels the timer that would have released it,
        // which would otherwise stall the queue for the rest of the page)
        const done = flushDone;
        flushDone = null;
        promise = null;
        try {
          events.length &&
            (await track({
              clientKey,
              events,
              ingestorHost,
              useBeacon:
                transport === "beacon" || (transport === "auto" && !!unloading),
            }));
        } finally {
          done && done();
        }
      };
      gb.setEventLogger(async (eventName, properties, userContext) => {
        const data: EventData = {
          eventName,
          properties,
          attributes: userContext.attributes || {},
          url: userContext.url || "",
        };

        // Skip logging if the event is being filtered
        if (eventFilter && !eventFilter(data)) {
          return;
        }

        // De-dupe Feature Evaluated and Experiment Viewed events
        if (
          eventName === EVENT_FEATURE_EVALUATED ||
          eventName === EVENT_EXPERIMENT_VIEWED
        ) {
          // Build the key for de-duping
          const dedupeKeyData: Record<string, unknown> = {
            eventName,
            properties,
          };
          for (const key of dedupeKeyAttributes) {
            dedupeKeyData["attr:" + key] = data.attributes[key];
          }

          const k = JSON.stringify(dedupeKeyData);
          // Duplicate event fired recently, move to end of LRU cache and skip
          if (eventCache.has(k)) {
            eventCache.delete(k);
            eventCache.add(k);
            return;
          }
          eventCache.add(k);

          // If the cache is too big, remove the oldest item
          if (eventCache.size > dedupeCacheSize) {
            const oldest = eventCache.values().next().value;
            oldest && eventCache.delete(oldest);
          }
        }

        const payload = getEventPayload(data);

        debug &&
          console.log(
            "Logging event to GrowthBook",
            JSON.parse(JSON.stringify(payload)),
          );
        if (!enable) return;

        _q.push(payload);

        // Only one in-progress promise at a time
        if (!promise) {
          promise = new Promise((resolve) => {
            flushDone = resolve;
            // Flush the queue after a delay
            timer = setTimeout(() => {
              flush().catch(console.error);
            }, queueFlushInterval);
          });
        }
        await promise;
      });

      // Flush the queue on page unload. Listeners are removed on destroy so
      // SPA re-inits don't accumulate handlers over dead instances.
      if (typeof document !== "undefined" && document.visibilityState) {
        const onVisibilityChange = () => {
          if (document.visibilityState === "hidden") {
            flush(true).catch(console.error);
          }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        "onDestroy" in gb &&
          gb.onDestroy(() =>
            document.removeEventListener(
              "visibilitychange",
              onVisibilityChange,
            ),
          );
      }
      // pagehide fires on navigations where visibilitychange may not
      if (typeof window !== "undefined") {
        const onPageHide = () => {
          flush(true).catch(console.error);
        };
        window.addEventListener("pagehide", onPageHide);
        "onDestroy" in gb &&
          gb.onDestroy(() =>
            window.removeEventListener("pagehide", onPageHide),
          );
      }

      // Flush the queue when the growthbook instance is destroyed
      "onDestroy" in gb &&
        gb.onDestroy(() => {
          flush().catch(console.error);
        });
    }

    // Listen on window.gbEvents.push if in a browser
    // This makes it easier to integrate with Segment, GTM, etc.
    if (typeof window !== "undefined" && !("createScopedInstance" in gb)) {
      const prevEvents = Array.isArray(window.gbEvents) ? window.gbEvents : [];
      window.gbEvents = {
        push: (event: GlobalTrackedEvent | string) => {
          if ("isDestroyed" in gb && gb.isDestroyed()) {
            // If trying to log and the instance has been destroyed, switch back to just an array
            // This will let the next GrowthBook instance pick it up
            window.gbEvents = [event];
            return;
          }

          if (typeof event === "string") {
            gb.logEvent(event);
          } else if (event) {
            gb.logEvent(event.eventName, event.properties);
          }
        },
      };
      for (const event of prevEvents) {
        window.gbEvents.push(event);
      }
    }
  };
}
