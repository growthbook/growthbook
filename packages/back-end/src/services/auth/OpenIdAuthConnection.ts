import { NextFunction, Request, Response } from "express";
import {
  Issuer,
  IssuerMetadata,
  TokenSet,
  generators,
  Client,
  custom,
} from "openid-client";

import jwtExpress, { RequestHandler } from "express-jwt";
import jwks from "jwks-rsa";
import { SSO_CONFIG } from "shared/enterprise";
import {
  SSOConnectionInterface,
  UnauthenticatedResponse,
} from "shared/types/sso-connection";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { MemoryCache } from "back-end/src/services/cache";
import {
  AuthChecksCookie,
  SSOConnectionIdCookie,
} from "back-end/src/util/cookie";
import { APP_ORIGIN, IS_CLOUD, USE_PROXY } from "back-end/src/util/secrets";
import { _dangerousGetSSOConnectionById } from "back-end/src/models/SSOConnectionModel";
import {
  getUserLoginPropertiesFromRequest,
  trackLoginForUser,
} from "back-end/src/services/users";
import { getHttpOptions } from "back-end/src/util/http.util";
import {
  VERCEL_CLIENT_ID,
  VERCEL_CLIENT_SECRET,
} from "back-end/src/services/vercel-native-integration.service";
import { AuthConnection, TokensResponse } from "./AuthConnection";

type AuthChecks = {
  connection_id: string;
  state: string;
  code_verifier: string;
};

if (USE_PROXY) {
  custom.setHttpOptionsDefaults(getHttpOptions());
}

const passthroughQueryParams = ["hypgen", "hypothesis"];

// Micro-Cache with a TTL of 30 seconds, avoids hitting Mongo on every request
const ssoConnectionCache = new MemoryCache(async (ssoConnectionId: string) => {
  const ssoConnection = await _dangerousGetSSOConnectionById(ssoConnectionId);
  if (ssoConnection) {
    return ssoConnection;
  }
  throw new Error("Could not find SSO connection - " + ssoConnectionId);
}, 30);

const clientMap: Map<SSOConnectionInterface, Client> = new Map();

const jwksMiddlewareCache: { [key: string]: RequestHandler } = {};

export class OpenIdAuthConnection implements AuthConnection {
  async refresh(
    req: Request,
    res: Response,
    refreshToken: string,
  ): Promise<TokensResponse> {
    const { client, connection } = await getConnectionFromRequest(req, res);

    if (connection.id?.startsWith("vercel:")) {
      throw new Error("Session expired. Must re-authenticate in Vercel.");
    }

    const tokenSet = await client.refresh(refreshToken);

    if (!tokenSet.id_token) {
      throw new Error("id_token not returned in refresh request");
    }

    return {
      idToken: tokenSet.id_token,
      refreshToken: tokenSet.refresh_token || "",
      expiresIn: this.getMaxAge(tokenSet),
    };
  }
  async getUnauthenticatedResponse(
    req: Request,
    res: Response,
  ): Promise<UnauthenticatedResponse> {
    const { connection, client } = await getConnectionFromRequest(req, res);
    const redirectURI = this.getRedirectURI(connection, client, req, res);

    // If there's an existing incomplete auth session for this Cloud SSO provider,
    // confirm with the user to give them a chance to cancel and reset to the default auth
    const checks = this.getAuthChecks(req);
    const confirm = !!connection.id && checks?.connection_id === connection.id;

    return {
      redirectURI,
      confirm,
    };
  }
  async processCallback(req: Request, res: Response): Promise<TokensResponse> {
    const { connection, client } = await getConnectionFromRequest(req, res);

    // Get rid of temporary codeVerifier cookie
    const checks = this.getAuthChecks(req);
    AuthChecksCookie.setValue("", req, res);

    if (!checks) {
      throw new Error("Missing auth checks in session");
    }
    if (checks.connection_id !== (connection.id || "")) {
      throw new Error("Invalid auth checks in session");
    }

    const params = client.callbackParams(req.originalUrl);
    const tokenSet = await client.callback(
      `${APP_ORIGIN}/oauth/callback`,
      params,
      {
        code_verifier: checks.code_verifier,
        state: checks.state,
      },
    );

    const email = tokenSet.claims().email;
    if (email) {
      const trackingProperties = getUserLoginPropertiesFromRequest(req);
      trackLoginForUser({
        ...trackingProperties,
        email,
      });
    }

    return {
      idToken: tokenSet?.id_token || "",
      refreshToken: tokenSet?.refresh_token || "",
      expiresIn: this.getMaxAge(tokenSet),
    };
  }
  async logout(req: Request, res: Response): Promise<string> {
    const { connection } = await getConnectionFromRequest(req, res);
    if (connection?.metadata?.logout_endpoint) {
      return connection.metadata.logout_endpoint as string;
    }
    return "";
  }
  async middleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { connection } = await getConnectionFromRequest(
        req as Request,
        res,
      );

      // Store the ssoConnectionId in the request
      req.loginMethod = connection;

      const metadata = connection.metadata;

      const jwksUri = metadata.jwks_uri;
      const algorithms = metadata.id_token_signing_alg_values_supported;
      const issuer = metadata.issuer;

      if (!jwksUri || !algorithms || !issuer) {
        throw new Error(
          "Missing SSO metadata: 'issuer', 'jwks_uri', and/or 'id_token_signing_alg_values_supported'",
        );
      }

      const cacheKey = JSON.stringify([
        jwksUri,
        connection.clientId,
        issuer,
        algorithms,
      ]);

      let middleware = jwksMiddlewareCache[cacheKey];
      if (!middleware) {
        middleware = jwtExpress({
          secret: jwks.expressJwtSecret({
            cache: true,
            cacheMaxEntries: 200,
            cacheMaxAge: 10 * 60 * 60 * 1000,
            rateLimit: false,
            jwksRequestsPerMinute: 10,
            jwksUri,
            requestAgent: getHttpOptions().agent,
          }),
          audience: connection.clientId,
          issuer,
          algorithms,
        });
        jwksMiddlewareCache[cacheKey] = middleware;
      }
      middleware(req as Request, res, next);
    } catch (e) {
      next(e);
    }
  }

  private getAuthChecks(req: Request) {
    const checks = AuthChecksCookie.getValue(req);
    if (!checks) return null;
    const parsed: AuthChecks = JSON.parse(checks);
    return parsed;
  }
  private getMaxAge(tokenSet: TokenSet) {
    if (tokenSet.expires_in) {
      return tokenSet.expires_in;
    }
    if (tokenSet.expires_at) {
      return Math.floor(tokenSet.expires_at - Date.now() / 1000);
    }
    return 0;
  }
  private getRedirectURI(
    ssoConnection: SSOConnectionInterface,
    client: Client,
    req: Request,
    res: Response,
  ) {
    // Vercel has a provider-initiated SSO flow that differs from the normal OAuth flow
    if (ssoConnection.id?.startsWith("vercel:")) {
      const installationId = ssoConnection.id.split(":")[1];
      return `https://vercel.com/sso/integrations/${
        process.env.VERCEL_INTEGRATION_SLUG || "growthbook"
      }/${installationId}`;
    }

    const code_verifier = generators.codeVerifier();
    const code_challenge = generators.codeChallenge(code_verifier);

    const state = generators.state();

    const checks: AuthChecks = {
      connection_id: ssoConnection.id || "",
      code_verifier,
      state,
    };

    AuthChecksCookie.setValue(JSON.stringify(checks), req, res);

    let url = client.authorizationUrl({
      scope: `openid email profile ${
        ssoConnection.additionalScope || ""
      }`.trim(),
      code_challenge,
      code_challenge_method: "S256",
      state,
      audience: (ssoConnection.metadata?.audience ??
        ssoConnection.clientId) as string,
    });

    if (ssoConnection.extraQueryParams) {
      for (const [k, v] of Object.entries(ssoConnection.extraQueryParams)) {
        url += `&${k}=${v}`;
      }
    }

    for (const [k, v] of Object.entries(req.query)) {
      if (passthroughQueryParams.includes(k)) {
        url += `&${k}=${v}`;
      }
    }

    return url;
  }
}

async function getConnectionFromRequest(req: Request, res: Response) {
  // First, get the connection info
  let ssoConnectionId = SSOConnectionIdCookie.getValue(req);

  let persistSSOConnectionId = false;

  // If there's no ssoConnectionId in the cookie, look in the querystring instead
  // This is used for IdP-initiated Enterprise SSO on Cloud
  if (IS_CLOUD && !ssoConnectionId) {
    const ssoConnectionIdFromQuery = req.query.ssoId;
    if (
      ssoConnectionIdFromQuery &&
      typeof ssoConnectionIdFromQuery === "string"
    ) {
      persistSSOConnectionId = true;
      ssoConnectionId = ssoConnectionIdFromQuery;
    }
  }

  let connection: SSOConnectionInterface;
  if (IS_CLOUD && ssoConnectionId.startsWith("vercel:")) {
    connection = {
      id: ssoConnectionId,
      clientId: VERCEL_CLIENT_ID,
      clientSecret: VERCEL_CLIENT_SECRET,
      metadata: {
        issuer: "https://marketplace.vercel.com",
        jwks_uri: "https://marketplace.vercel.com/.well-known/jwks",
        id_token_signing_alg_values_supported: ["RS256"],
        authorization_endpoint: "https://api.vercel.com/oauth/authorize",
        token_endpoint: "https://api.vercel.com/oauth/access_token",
      },
    };
  } else if (IS_CLOUD && ssoConnectionId) {
    connection = await ssoConnectionCache.get(ssoConnectionId);
  } else if (SSO_CONFIG) {
    connection = SSO_CONFIG;
  } else {
    throw new Error("No SSO connection configured");
  }

  // Then, get the corresponding OpenID Client
  let client = clientMap.get(connection);
  if (!client) {
    const issuer = new Issuer(connection.metadata as IssuerMetadata);
    client = new issuer.Client({
      client_id: connection.clientId,
      client_secret: connection.clientSecret,
      redirect_uris: [`${APP_ORIGIN}/oauth/callback`],
      response_types: [`code`],
      token_endpoint_auth_method: connection.clientSecret
        ? "client_secret_basic"
        : "none",
    });
    clientMap.set(connection, client);
  }

  // If we've made it this far, the connection was found and we should persist it in a cookie
  if (persistSSOConnectionId && ssoConnectionId) {
    SSOConnectionIdCookie.setValue(ssoConnectionId, req, res);
  }

  return { connection, client };
}
