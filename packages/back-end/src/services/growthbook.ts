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
  IS_LOCALHOST,
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
 * Prefers the Referer (front-end page) when present; otherwise builds from the request.
 * Matches the front-end's growthbook.setURL(window.location.href).
 */
export function getGrowthBookRequestUrl(
  req: Pick<Request, "protocol" | "get" | "originalUrl">,
): string {
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

/**
 * Get the singleton GrowthBookClient instance
 * This provides 3x performance improvement over creating new instances per request
 * by reusing the same core instance across all requests
 */
export function getGrowthBookClient(): GrowthBookClient<AppFeatures> | null {
  if (!IS_CLOUD && !IS_LOCALHOST) return null;

  if (!gbClient) {
    gbClient = createGrowthBookClient();
  }

  return gbClient;
}

/**
 * Initialize the GrowthBook client with streaming support
 * Should be called once during application startup
 * Enables real-time feature updates via Server-Sent Events
 */
export async function initializeGrowthBookClient(): Promise<void> {
  if (!IS_CLOUD && !IS_LOCALHOST) {
    logger.info(
      "GrowthBook client not initialized - not running in cloud mode",
    );
    return;
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const client = getGrowthBookClient();
      if (client) {
        const { success, source, error } = await client.init({
          timeout: 3000,
          streaming: true, // Enable real-time updates via SSE
        });

        if (!success) {
          logger.warn({ source, err: error }, "GrowthBook features not loaded");
        } else {
          logger.info(
            { source, streaming: true },
            "GrowthBook client initialized successfully",
          );
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize GrowthBook client");
      // Don't throw - allow app to continue without feature flags
    }
  })();

  return initPromise;
}

/**
 * Cleanup the GrowthBook client on shutdown
 * Call this during graceful shutdown to close SSE connections
 */
export function destroyGrowthBookClient(): void {
  if (gbClient) {
    gbClient.destroy();
    gbClient = null;
    initPromise = null;
    logger.info("GrowthBook client destroyed");
  }
}
