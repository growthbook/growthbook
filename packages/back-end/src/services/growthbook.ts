import crypto from "crypto";
import { GrowthBookClient, setPolyfills } from "@growthbook/growthbook";
import { EventSource } from "eventsource";
import { GROWTHBOOK_SECURE_ATTRIBUTE_SALT } from "shared/constants";
import { OrganizationInterface } from "shared/types/organization";
import { logger } from "back-end/src/util/logger";
import {
  GROWTHBOOK_SDK_API_HOST,
  GROWTHBOOK_SDK_CLIENT_KEY,
  IS_CLOUD,
  IS_MULTI_ORG,
} from "back-end/src/util/secrets";
import { getEffectiveAccountPlan } from "back-end/src/enterprise/licenseUtil";
import { AppFeatures } from "back-end/types/app-features";

// Node has no global EventSource; polyfill it for streaming (SSE) support
setPolyfills({ EventSource });

let gbClient: GrowthBookClient<AppFeatures> | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Singleton GrowthBookClient for reading GrowthBook's own feature flags from
 * the back-end (cloud only). Reuses one core instance across all requests.
 *
 * SECURITY: flags that gate enforcement (e.g. pricing limits) must be
 * evaluated ONLY against trusted, server-derived attributes — see
 * getTrustedOrgAttributes. Never evaluate them with request-supplied context
 * (URL, cookies, client attributes): the SDK honors query-string variation
 * overrides whenever the eval context carries a URL. Also never read a flag
 * on the SDK-payload-generation path (would create a circular dependency).
 */
export function getGrowthBookClient(): GrowthBookClient<AppFeatures> | null {
  if (!IS_CLOUD || !GROWTHBOOK_SDK_CLIENT_KEY) return null;

  if (!gbClient) {
    gbClient = new GrowthBookClient<AppFeatures>({
      apiHost: GROWTHBOOK_SDK_API_HOST,
      clientKey: GROWTHBOOK_SDK_CLIENT_KEY,
      globalAttributes: {
        cloud: IS_CLOUD,
        multiOrg: IS_MULTI_ORG,
      },
    });
  }

  return gbClient;
}

/**
 * Org-level targeting attributes derived exclusively from trusted server-side
 * data. Names and hashing mirror the front-end (services/UserContext.tsx) so
 * one flag config can target both apps consistently. Per-user attributes
 * (role, ids) are deliberately absent — enforcement flags are org-scoped.
 */
export function getTrustedOrgAttributes(
  org: OrganizationInterface,
): Record<string, unknown> {
  return {
    organizationId: crypto
      .createHash("sha256")
      .update(GROWTHBOOK_SECURE_ATTRIBUTE_SALT + org.id)
      .digest("hex"),
    cloudOrgId: IS_CLOUD ? org.id : "",
    orgDateCreated: org.dateCreated ? org.dateCreated.toISOString() : "",
    accountPlan: getEffectiveAccountPlan(org),
    hasLicenseKey: !!org.licenseKey,
    freeSeats: org.freeSeats || 3,
    discountCode: org.discountCode || "",
    isVercelIntegration: !!org.isVercelIntegration,
  };
}

/**
 * Initialize the GrowthBook client with streaming support. Called once at
 * boot; fail-soft so the app runs without feature flags if it can't connect.
 */
export async function initializeGrowthBookClient(): Promise<void> {
  const client = getGrowthBookClient();
  if (!client) {
    logger.info(
      "Back-end GrowthBook client disabled (not cloud or no GROWTHBOOK_SDK_CLIENT_KEY)",
    );
    return;
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const { success, source, error } = await client.init({
        timeout: 3000,
        streaming: true, // real-time updates via SSE
      });
      if (!success) {
        logger.warn({ source, error }, "GrowthBook features not loaded");
      } else {
        logger.info({ source }, "Back-end GrowthBook client initialized");
      }
    } catch (error) {
      // Don't throw — the app continues with in-app defaults
      logger.error({ error }, "Failed to initialize GrowthBook client");
    }
  })();

  return initPromise;
}

/**
 * Close SSE connections on graceful shutdown.
 */
export function destroyGrowthBookClient(): void {
  if (gbClient) {
    gbClient.destroy();
    gbClient = null;
    initPromise = null;
    logger.info("Back-end GrowthBook client destroyed");
  }
}
