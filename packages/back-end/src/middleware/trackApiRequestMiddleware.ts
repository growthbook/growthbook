import { NextFunction, Request, Response } from "express";
import { OAuthClientInterface } from "shared/validators";
import { ApiRequestLocals } from "back-end/types/api";
import { getOAuthClientById } from "back-end/src/models/OAuthClientModel";
import {
  countResponseBytes,
  getGrowthBookClient,
  getRoutePath,
  getTrustedOrgAttributes,
  onResponseComplete,
  parseContentLength,
} from "back-end/src/services/growthbook";
import {
  parseApiClient,
  truncateUserAgent,
} from "back-end/src/util/api-client.util";
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
  return /^\/api\/(v\d+)\//.exec(req.originalUrl)?.[1];
}

// Dynamic client registration mints a client per install, so this is bounded
// rather than assumed small. Names never change after issuance.
const MAX_CACHED_OAUTH_CLIENTS = 500;
const MAX_OAUTH_CLIENT_NAME_LENGTH = 100;
const oauthClientNames = new Map<string, string>();

async function getOAuthClientName(
  clientId: string | undefined,
): Promise<string | undefined> {
  if (!clientId) return undefined;

  const cached = oauthClientNames.get(clientId);
  if (cached !== undefined) return cached || undefined;

  // Enrichment must never cost us the event, so a failed lookup goes
  // uncached — the next request retries rather than pinning an empty name.
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

async function logApiRequest(
  req: ApiRequest,
  res: Response,
  startedAt: number,
  resContentSize: number,
) {
  const gbClient = getGrowthBookClient();
  if (!gbClient || !req.organization) return;

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
        ...getTrustedOrgAttributes(req.organization),
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
