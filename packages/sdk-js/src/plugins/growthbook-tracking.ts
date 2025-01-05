import { loadSDKVersion } from "../util";
import type { Attributes, EventLogProps } from "../types/growthbook";
import type { GrowthBook } from "../GrowthBook";

const SDK_VERSION = loadSDKVersion();

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
};

function parseString(value: unknown): null | string {
  return typeof value === "string" ? value : null;
}

function parseAttributes(
  attributes: Attributes
): {
  nonIdAttributes: Attributes;
  ids: {
    user_id: string | null;
    device_id: string | null;
    page_id: string | null;
    session_id: string | null;
  };
} {
  const {
    user_id,
    device_id,
    anonymous_id,
    id,
    page_id,
    session_id,
    ...nonIdAttributes
  } = attributes;

  return {
    nonIdAttributes,
    ids: {
      user_id: parseString(user_id),
      device_id: parseString(device_id || anonymous_id || id),
      page_id: parseString(page_id),
      session_id: parseString(session_id),
    },
  };
}

async function track({
  clientKey,
  ingestorHost,
  events,
}: {
  events: EventLogProps[];
  clientKey: string;
  ingestorHost?: string;
}) {
  const data: EventPayload[] = events.map(
    ({ eventName, properties, attributes, url }) => {
      const { nonIdAttributes, ids } = parseAttributes(attributes || {});

      return {
        event_name: eventName,
        properties_json: properties || {},
        ...ids,
        sdk_language: "js",
        sdk_version: SDK_VERSION,
        url: url,
        context_json: nonIdAttributes,
      };
    }
  );

  const endpoint = `${
    ingestorHost || "https://us1.gb-ingest.com"
  }/track?client_key=${clientKey}`;
  const body = JSON.stringify(data);

  try {
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon(endpoint, body);
    } else {
      await fetch(endpoint, {
        method: "POST",
        body,
        headers: {
          Accept: "application/json",
          "Content-Type": "text/plain",
        },
        credentials: "omit",
      });
    }
  } catch (e) {
    console.error("Failed to track event", e);
  }
}

export function growthbookTrackingPlugin({
  useQueue = true,
  queueFlushInterval = 100,
  ingestorHost,
  enable = true,
  debug,
}: {
  useQueue?: boolean;
  queueFlushInterval?: number;
  ingestorHost?: string;
  enable?: boolean;
  debug?: boolean;
} = {}) {
  return (gb: GrowthBook) => {
    const clientKey = gb.getClientKey();
    if (!clientKey) {
      throw new Error("clientKey must be specified to use event logging");
    }

    // TODO: Listen for dataLayer events and log them in GrowthBook

    if (!useQueue) {
      gb.setEventLogger(async (event) => {
        debug && console.log("Logging event", event);
        if (!enable) return;

        await track({ clientKey, events: [event], ingestorHost });
      });
      return;
    }

    let _q: EventLogProps[] = [];
    let promise: Promise<void> | null = null;
    gb.setEventLogger(async (event) => {
      debug && console.log("Logging event", event);
      if (!enable) return;

      _q.push(event);
      if (!promise) {
        promise = new Promise((resolve, reject) => {
          setTimeout(() => {
            track({ clientKey, events: _q, ingestorHost })
              .then(resolve)
              .catch(reject);
            promise = null;
            _q = [];
          }, queueFlushInterval);
        });
      }
      await promise;
    });
  };
}
