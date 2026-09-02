import { createHash } from "crypto";
import {
  EventProperties,
  GrowthBookClient,
  setPolyfills,
} from "@growthbook/growthbook";
import { growthbookTrackingPlugin } from "@growthbook/growthbook/plugins";
import { EventSource } from "eventsource";
import { NextFunction, Request, Response } from "express";
import { GROWTHBOOK_SECURE_ATTRIBUTE_SALT } from "shared/constants";
import { AppFeatures } from "shared/types/app-features";
import { OrganizationInterface } from "shared/types/organization";
import { getEffectiveAccountPlan } from "back-end/src/enterprise";
import { logger } from "back-end/src/util/logger";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
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

const EVENT_REQUEST_COMPLETED = "Request Completed";
const EVENT_AI_USAGE = "AI Usage";

export function parseContentLength(
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Route pattern (e.g. "/auth/reset/:token") rather than the resolved path, so
 * dynamic segments that carry secrets (tokens, keys, etc.) never appear in the event.
 */
export function getRoutePath(req: {
  path: string;
  baseUrl: string;
  route?: { path?: string };
}): string {
  // No matched route (e.g. a 404) means no safe pattern to bound the path to,
  // so don't fall back to the raw path, which may contain arbitrary user input.
  return req.route?.path ? `${req.baseUrl}${req.route.path}` : "(unmatched)";
}

/**
 * Logs a "Request Completed" event with latency, payload sizes, and status once
 * the response finishes, using the per-request scoped client (`req.gb`, set in
 * auth/index.ts) so the event carries the same user attributes as feature events.
 */
export function trackRequestCompletion(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const start = Date.now();

  // Sum the bytes written by handlers. This runs above the compression
  // middleware, so it's the uncompressed payload size (independent of the
  // client's Accept-Encoding), not the on-wire byte count.
  let resContentSize = 0;
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (chunk) resContentSize += Buffer.byteLength(chunk as string);
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof res.write;
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (chunk && typeof chunk !== "function")
      resContentSize += Buffer.byteLength(chunk as string);
    return (origEnd as (...a: unknown[]) => Response)(chunk, ...rest);
  }) as typeof res.end;

  // "close" also covers requests the client aborted before "finish" fired
  const onComplete = () => {
    res.removeListener("finish", onComplete);
    res.removeListener("close", onComplete);
    req.gb?.logEvent(EVENT_REQUEST_COMPLETED, {
      path: getRoutePath(req),
      method: req.method,
      statusCode: res.statusCode,
      latencyMs: Date.now() - start,
      reqContentSize: parseContentLength(req.headers["content-length"]),
      resContentSize,
    });
  };
  res.on("finish", onComplete);
  res.on("close", onComplete);
  next();
}

export function hashOrganizationId(orgId: string): string {
  if (!orgId) return "";
  return createHash("sha256")
    .update(GROWTHBOOK_SECURE_ATTRIBUTE_SALT + orgId)
    .digest("hex");
}

// How the call ended, so a cancelled or failed one is visible rather than simply
// absent. Defaults to "success", leaving existing callers unchanged.
export type AIUsageOutcome = "success" | "aborted" | "error";

// One event per AI call, whichever key paid. `usedOwnKey` separates BYOK traffic
// from managed-key traffic — only the latter is metered, so without it the event
// stream can't be reconciled against the cap counter.
//
// Fire and forget, never throws: analytics must not fail an AI request. Callers
// hold a `context`, not a `req`, so it builds its own scoped SDK instance.
export function trackAIUsage({
  organizationId,
  userId,
  type,
  model,
  provider,
  numPromptTokensUsed,
  numCompletionTokensUsed,
  numRetriedTokensUsed,
  usedDefaultPrompt,
  usedOwnKey,
  outcome = "success",
}: {
  organizationId: string;
  userId?: string;
  type: string;
  model: string;
  provider?: string;
  numPromptTokensUsed?: number;
  numCompletionTokensUsed?: number;
  // Spent on attempts that produced nothing usable, but still billed.
  numRetriedTokensUsed?: number;
  usedDefaultPrompt: boolean;
  usedOwnKey: boolean;
  outcome?: AIUsageOutcome;
}): void {
  try {
    const client = getGrowthBookClient();
    if (!client) return;

    const gb = client.createScopedInstance({
      attributes: {
        id: userId || "",
        user_id: userId || "",
        organizationId: hashOrganizationId(organizationId),
        cloudOrgId: IS_CLOUD ? organizationId : "",
      },
    });

    gb.logEvent(EVENT_AI_USAGE, {
      type,
      model,
      provider,
      numPromptTokensUsed,
      numCompletionTokensUsed,
      numRetriedTokensUsed,
      usedDefaultPrompt,
      usedOwnKey,
      outcome,
    });
  } catch (e) {
    logger.warn(e, "Failed to log AI usage event");
  }
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

// Server-derived attributes only — never request context, whose url would
// enable query-string variation overrides. Names mirror the front-end.
export function getTrustedOrgAttributes(
  org: OrganizationInterface,
): Record<string, unknown> {
  return {
    organizationId: hashOrganizationId(org.id),
    cloudOrgId: IS_CLOUD ? org.id : "",
    orgDateCreated: org.dateCreated
      ? new Date(org.dateCreated).toISOString()
      : "",
    accountPlan: getEffectiveAccountPlan(org),
    hasLicenseKey: !!org.licenseKey,
  };
}

/**
 * Log a telemetry event from a background job, where there is no `req.gb`.
 * Sets org attributes so the accountPlan filter doesn't drop the event, and
 * never throws — callers fire these inside business-logic try/catch blocks.
 */
export function trackEventForOrganization(
  org: OrganizationInterface,
  eventName: string,
  properties: EventProperties = {},
): void {
  try {
    const client = getGrowthBookClient();
    if (!client) return;

    client.logEvent(eventName, properties, {
      attributes: getTrustedOrgAttributes(org),
    });
  } catch (e) {
    logger.warn({ err: e, eventName }, "Failed to log GrowthBook event");
  }
}

export function trackEventForContext(
  context: ReqContext,
  eventName: string,
  properties: EventProperties = {},
): void {
  const gb = (context.req as AuthRequest | undefined)?.gb;
  if (gb) {
    try {
      gb.logEvent(eventName, properties);
    } catch (e) {
      logger.warn({ err: e, eventName }, "Failed to log GrowthBook event");
    }
    return;
  }
  trackEventForOrganization(context.org, eventName, properties);
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
