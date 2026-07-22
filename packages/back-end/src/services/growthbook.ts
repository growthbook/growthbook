import {
  GrowthBookClient,
  setPolyfills,
  EVENT_EXPERIMENT_VIEWED,
  EVENT_FEATURE_EVALUATED,
} from "@growthbook/growthbook";
import { growthbookTrackingPlugin } from "@growthbook/growthbook/plugins";
import { EventSource } from "eventsource";
import { Request } from "express";
import { AppFeatures } from "shared/types/app-features";
import { logger } from "back-end/src/util/logger";
import {
  GB_SDK_ID,
  IS_CLOUD,
  IS_MULTI_ORG,
  getIngestorHost,
  isGrowthBookTelemetryDebug,
  isGrowthBookTelemetryEnabled,
} from "back-end/src/util/secrets";

// Set up Node.js polyfills for streaming support
setPolyfills({ EventSource });

let gbClient: GrowthBookClient<AppFeatures> | null = null;
let initPromise: Promise<void> | null = null;

function createGrowthBookClient(): GrowthBookClient<AppFeatures> {
  const client = new GrowthBookClient<AppFeatures>({
    apiHost: "https://cdn.growthbook.io",
    clientKey: GB_SDK_ID,
    globalAttributes: {
      cloud: IS_CLOUD,
      multiOrg: IS_MULTI_ORG,
      requestSource: "backend",
    },
    plugins: [
      growthbookTrackingPlugin({
        ingestorHost: getIngestorHost(),
        enable: isGrowthBookTelemetryEnabled(),
        debug: isGrowthBookTelemetryDebug(),
        eventFilter: (event) => {
          // Wait for account plan to load before sending events
          if (event.attributes.accountPlan === "loading") return false;
          return true;
        },
        dedupeKeyAttributes: ["id", "organizationId"],
      }),
    ],
    onFeatureUsage: (key, result, userContext) => {
      client.logEvent(
        EVENT_FEATURE_EVALUATED,
        {
          feature: key,
          source: result.source,
          value: result.value,
          ruleId:
            result.source === "defaultValue" ? "$default" : result.ruleId || "",
          variationId: result.experimentResult
            ? result.experimentResult.key
            : "",
        },
        userContext,
      );
    },
  });

  // GrowthBookClient does not pass eventLogger into the eval context (unlike the
  // browser SDK), so route experiment callbacks through logEvent for the plugin.
  client.setTrackingCallback((experiment, result, userContext) => {
    client.logEvent(
      EVENT_EXPERIMENT_VIEWED,
      {
        experimentId: experiment.key,
        variationId: result.key,
      },
      userContext,
    );
  });

  return client;
}

/**
 * Full page URL for GrowthBook tracking events (userContext.url).
 * Prefers X-GB-Page-Url from the front-end (Referer is origin-only on cross-origin
 * requests under the default strict-origin-when-cross-origin policy).
 */
export function getGrowthBookRequestUrl(
  req: Pick<Request, "protocol" | "get" | "originalUrl">,
): string {
  const pageUrl = req.get(GB_PAGE_URL_HEADER);
  if (pageUrl) {
    return pageUrl;
  }

  const referer = req.get("referer");
  if (referer) {
    return referer;
  }

  const host = req.get("host");
  if (!host) {
    return req.originalUrl;
  }

  return `${req.protocol}://${host}${req.originalUrl}`;
}

const GB_SESSION_ID_HEADER = "x-gb-session-id";
const GB_DEVICE_ID_HEADER = "x-gb-device-id";
const GB_PAGE_ID_HEADER = "x-gb-page-id";
const GB_PAGE_URL_HEADER = "x-gb-page-url";
const GB_PAGE_PATH_HEADER = "x-gb-page-path";
const GB_ANONYMOUS_ID_HEADER = "x-gb-anonymous-id";

/**
 * Session, device, page IDs, and request context for backend SDK tracking events.
 * Cross-origin API calls do not send cookies, so the front-end also sends X-GB-* headers.
 * `ip` and `ua` come from the API request so ingestor geo/UA enrichment uses the end-user, not ECS.
 */
export function getGrowthBookTrackingAttributes(
  req: Pick<Request, "cookies" | "get" | "headers" | "ip">,
): {
  session_id?: string;
  device_id?: string;
  page_id?: string;
  anonymous_id?: string;
  url?: string;
  ip?: string;
  ua?: string;
} {
  const session_id =
    req.get(GB_SESSION_ID_HEADER) || req.cookies["gb_session_id"] || undefined;
  const device_id =
    req.get(GB_DEVICE_ID_HEADER) || req.cookies["gb_device_id"] || undefined;
  const page_id = req.get(GB_PAGE_ID_HEADER) || undefined;
  const anonymous_id = req.get(GB_ANONYMOUS_ID_HEADER) || undefined;
  const url = req.get(GB_PAGE_PATH_HEADER) || undefined;
  const ip = req.ip || undefined;
  const ua = (req.headers["user-agent"] as string) || undefined;

  return {
    ...(session_id ? { session_id } : {}),
    ...(device_id ? { device_id } : {}),
    ...(page_id ? { page_id } : {}),
    ...(anonymous_id ? { anonymous_id } : {}),
    ...(url ? { url } : {}),
    ...(ip ? { ip } : {}),
    ...(ua ? { ua } : {}),
  };
}

function ensureGrowthBookClient(): GrowthBookClient<AppFeatures> | null {
  if (!gbClient) {
    gbClient = createGrowthBookClient();
  }

  return gbClient;
}

/**
 * Get the singleton GrowthBookClient instance
 * This provides 3x performance improvement over creating new instances per request
 * by reusing the same core instance across all requests
 */
export function getGrowthBookClient(): GrowthBookClient<AppFeatures> | null {
  const client = ensureGrowthBookClient();

  if (!initPromise) {
    void initializeGrowthBookClient();
  }

  return client;
}

async function runGrowthBookClientInit(): Promise<void> {
  const client = ensureGrowthBookClient();
  if (!client) return;

  const { success, source, error } = await client.init({
    timeout: 3000,
    streaming: true, // Enable real-time updates via SSE
  });

  if (!success) {
    logger.warn({ source, err: error }, "GrowthBook features not loaded");
    return;
  }

  logger.info(
    { source, streaming: true },
    "GrowthBook client initialized successfully",
  );
}

/**
 * Initialize the GrowthBook client with streaming support
 * Should be called once during application startup
 * Enables real-time feature updates via Server-Sent Events
 */
export async function initializeGrowthBookClient(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = runGrowthBookClientInit().catch((error) => {
    logger.error({ err: error }, "Failed to initialize GrowthBook client");
    // Don't throw - allow app to continue without feature flags
  });

  return initPromise;
}

/**
 * Evaluate a backend AppFeatures flag using the global singleton client.
 * Usable anywhere (jobs, services) — unlike req.gb, which only exists on
 * authenticated routes. Returns `fallback` when the client or flag isn't
 * loaded, so callers keep safe default behavior during a CDN blip.
 */
export function getBackendFeatureValue<K extends string & keyof AppFeatures>(
  key: K,
  fallback: AppFeatures[K],
  attributes: Record<string, unknown> = {},
): AppFeatures[K] {
  const client = getGrowthBookClient();
  if (!client) return fallback;
  // getFeatureValue widens primitives (e.g. boolean literals); narrow back to
  // the flag's declared type, which is sound for all AppFeatures value types.
  return client.getFeatureValue(key, fallback, {
    attributes,
  }) as AppFeatures[K];
}

/**
 * Cleanup the GrowthBook client on shutdown
 * Call this during graceful shutdown to close SSE connections
 */
export function destroyGrowthBookClient(): void {
  gbClient?.destroy();
  gbClient = null;
  logger.info("GrowthBook client destroyed");
}
