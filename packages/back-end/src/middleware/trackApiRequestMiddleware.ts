import { NextFunction, Request, Response } from "express";
import { OAuthClientInterface } from "shared/validators";
import { OrganizationInterface } from "shared/types/organization";
import { ApiRequestLocals } from "back-end/types/api";
import { getOAuthClientById } from "back-end/src/models/OAuthClientModel";
import {
  countResponseBytes,
  getBackendFeatureValue,
  getGrowthBookClient,
  getRoutePath,
  getTrustedOrgAttributes,
  hashOrganizationId,
  onResponseComplete,
  parseContentLength,
} from "back-end/src/services/growthbook";
import {
  parseApiClient,
  truncateUserAgent,
} from "back-end/src/util/api-client.util";
import { isGrowthBookTelemetryEnabled } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

const EVENT_API_REQUEST = "API Request";

type ApiRequest = Request & ApiRequestLocals;

/**
 * How the caller authenticated. `jwt` is our own front-end calling the REST API
 * with a session token, which is app usage rather than API usage — the two have
 * to be separable or app traffic swamps the metric.
 */
function getAuthType(req: ApiRequest): string {
  if (req.isJwtAuth) return "jwt";
  if (req.oauthClientId) return "oauth";
  if (req.user) return "pat";
  return "api_key";
}

/** Read off the URL rather than the matched route, so 404s are still versioned. */
function getApiVersion(req: ApiRequest): string | undefined {
  // \b rather than / so the version survives `/api/v1` and `/api/v1?x=1`.
  return /^\/api\/(v\d+)\b/.exec(req.originalUrl)?.[1];
}

// `clientName` is write-once — the only mutation on `oauthclients` is
// `touchOAuthClient`, which sets `expiresAt` alone — and `clientId` is unique
// and never reused, so cached entries can't go stale. Add invalidation here if
// a client-configuration endpoint (RFC 7592) ever lands.
//
// Dynamic client registration mints one per install, not per application, so
// the population scales with users and the cap is load-bearing.
const MAX_CACHED_OAUTH_CLIENTS = 500;
const MAX_OAUTH_CLIENT_NAME_LENGTH = 100;
const oauthClientNames = new Map<string, string>();

async function getOAuthClientName(
  clientId: string | undefined,
): Promise<string | undefined> {
  if (!clientId) return undefined;

  const cached = oauthClientNames.get(clientId);
  if (cached !== undefined) {
    // Re-insert so eviction is LRU rather than FIFO — otherwise the busiest
    // client is evicted on schedule and every request re-queries Mongo.
    oauthClientNames.delete(clientId);
    oauthClientNames.set(clientId, cached);
    return cached || undefined;
  }

  // A lookup that threw goes uncached, so the next request retries. A lookup
  // that found nothing caches the empty name: the client doc is gone for good
  // (TTL) and re-querying every request would buy nothing.
  let client: OAuthClientInterface | null;
  try {
    client = await getOAuthClientById(clientId);
  } catch (err) {
    logger.warn({ err, clientId }, "Failed to look up OAuth client name");
    return undefined;
  }

  // Registered by the client itself, so treat it as untrusted text.
  const name = (client?.clientName || "").slice(
    0,
    MAX_OAUTH_CLIENT_NAME_LENGTH,
  );

  if (oauthClientNames.size >= MAX_CACHED_OAUTH_CLIENTS) {
    oauthClientNames.delete(oauthClientNames.keys().next().value as string);
  }
  oauthClientNames.set(clientId, name);

  return name || undefined;
}

/**
 * Org attributes for both flag targeting and the event itself.
 * `getEffectiveAccountPlan` throws on a self-hosted instance whose license
 * doesn't cover its SSO/multi-org config, and losing the plan shouldn't cost us
 * the event — fall back to the one attribute that can't fail, so the event is
 * still attributable.
 */
function getOrgAttributes(org: OrganizationInterface): Record<string, unknown> {
  try {
    return getTrustedOrgAttributes(org);
  } catch (err) {
    logger.warn(
      { err, organization: org.id },
      "Failed to resolve org attributes for API telemetry",
    );
    return { organizationId: hashOrganizationId(org.id) };
  }
}

async function logApiRequest(
  req: ApiRequest,
  res: Response,
  startedAt: number,
  resContentSize: number,
) {
  // The operator's opt-out comes first; the plugin would drop the event anyway,
  // but there's no reason to evaluate a flag for a deployment that said no.
  if (!isGrowthBookTelemetryEnabled()) return;

  const gbClient = getGrowthBookClient();
  if (!gbClient || !req.organization) return;

  const attributes = getOrgAttributes(req.organization);

  // Off by default: this is a new, high-volume event stream, and the only other
  // lever is DISABLE_TELEMETRY, which would take the app's events down with it.
  if (!getBackendFeatureValue("api-request-telemetry", false, attributes)) {
    return;
  }

  const userAgent = req.headers["user-agent"];
  const { client, clientVersion } = req.isJwtAuth
    ? { client: "app", clientVersion: null }
    : parseApiClient(userAgent);

  gbClient.logEvent(
    EVENT_API_REQUEST,
    {
      path: getRoutePath(req),
      method: req.method,
      statusCode: res.statusCode,
      latencyMs: Date.now() - startedAt,
      reqContentSize: parseContentLength(req.headers["content-length"]),
      resContentSize,
      apiVersion: getApiVersion(req),
      authType: getAuthType(req),
      apiKeyId: req.apiKey || undefined,
      oauthClientId: req.oauthClientId,
      oauthClientName: await getOAuthClientName(req.oauthClientId),
      client,
      clientVersion: clientVersion || undefined,
      userAgent: truncateUserAgent(userAgent),
    },
    {
      attributes: {
        ...attributes,
        ...(req.user ? { id: req.user.id, user_id: req.user.id } : {}),
      },
    },
  );
}

/**
 * Emits an "API Request" event per REST API call. The app's own
 * `trackRequestCompletion` is mounted after the REST router, so without this
 * `/api/v1` and `/api/v2` traffic is invisible in telemetry — the only record
 * is a `lastUsed` stamp on the key.
 *
 * Mount above authentication and the rate limiter so the requests they reject
 * are counted too. The org is only read once the response finishes, and a
 * request whose org never resolved is dropped rather than logged unattributed.
 */
export default function trackApiRequestMiddleware(
  req: ApiRequest,
  res: Response,
  next: NextFunction,
) {
  const startedAt = Date.now();
  const getResContentSize = countResponseBytes(res);

  onResponseComplete(res, () => {
    logApiRequest(req, res, startedAt, getResContentSize()).catch((err) =>
      logger.warn({ err }, "Failed to log API request event"),
    );
  });

  next();
}
