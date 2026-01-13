import { GrowthBookClient, setPolyfills } from "@growthbook/growthbook";
import * as EventSource from "eventsource";
import { logger } from "back-end/src/util/logger";
import { GB_SDK_ID, IS_CLOUD } from "back-end/src/util/secrets";
import { AppFeatures } from "back-end/types/app-features";

// Set up Node.js polyfills for streaming support
setPolyfills({ EventSource });

let gbClient: GrowthBookClient<AppFeatures> | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Get the singleton GrowthBookClient instance
 * This provides 3x performance improvement over creating new instances per request
 * by reusing the same core instance across all requests
 */
export function getGrowthBookClient(): GrowthBookClient<AppFeatures> | null {
  if (!IS_CLOUD) return null;

  if (!gbClient) {
    gbClient = new GrowthBookClient<AppFeatures>({
      apiHost: "https://cdn.growthbook.io",
      clientKey: GB_SDK_ID,
    });
  }

  return gbClient;
}

/**
 * Initialize the GrowthBook client with streaming support
 * Should be called once during application startup
 * Enables real-time feature updates via Server-Sent Events
 */
export async function initializeGrowthBookClient(): Promise<void> {
  if (!IS_CLOUD) {
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
        await client.init({
          timeout: 3000,
          streaming: true, // Enable real-time updates via SSE
        });
        logger.info(
          "GrowthBook client initialized successfully with streaming",
        );
      }
    } catch (error) {
      logger.error("Failed to initialize GrowthBook client", { error });
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
