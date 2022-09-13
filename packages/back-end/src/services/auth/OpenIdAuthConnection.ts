import { NextFunction, Request, Response } from "express";
import {
  SSOConnectionInterface,
  UnauthenticatedResponse,
} from "../../../types/sso-connection";
import { MemoryCache } from "../cache";
import {
  Issuer,
  IssuerMetadata,
  TokenSet,
  generators,
  Client,
} from "openid-client";
import { AuthConnection, TokensResponse } from "./AuthConnection";
import { AuthRequest } from "../../types/AuthRequest";
import jwtExpress from "express-jwt";
import jwks from "jwks-rsa";
import { AuthChecksCookie, SSOConnectionIdCookie } from "../../util/cookie";
import { APP_ORIGIN, IS_CLOUD, SSO_CONFIG } from "../../util/secrets";
import { getSSOConnectionById } from "../../models/SSOConnectionModel";

type AuthChecks = {
  connection_id: string;
  state: string;
  code_verifier: string;
};

const ssoConnectionCache = new MemoryCache<SSOConnectionInterface>(30);
const ssoClientCache = new MemoryCache<Client>(30);

export class OpenIdAuthConnection implements AuthConnection {
  async getUnauthenticatedResponse(
    req: Request,
    res: Response
  ): Promise<UnauthenticatedResponse> {
    const ssoConnection = await getConnectionFromRequest(req);
    if (!ssoConnection) {
      throw new Error("Could not find SSO connection for this request");
    }
    const redirectURI = this.getRedirectURI(ssoConnection, req, res);

    // If there's an existing incomplete auth session for this Cloud SSO provider,
    // confirm with the user to give them a chance to cancel and reset to the default auth
    const checks = this.getAuthChecks(req);
    const confirm =
      !!ssoConnection.id && checks?.connection_id === ssoConnection.id;

    return {
      redirectURI,
      confirm,
    };
  }
  async refresh(
    req: Request,
    res: Response,
    refreshToken: string
  ): Promise<TokensResponse> {
    const ssoConnection = await getConnectionFromRequest(req);
    if (!ssoConnection) {
      throw new Error("Could not find SSO connection for this request");
    }
    const client = this.getOpenIdClient(ssoConnection);

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
  async middleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const ssoConnection = await getConnectionFromRequest(req);
      if (!ssoConnection) {
        throw new Error("Could not find SSO connection for this request");
      }

      // Store the ssoConnectionId in the request
      req.loginMethod = ssoConnection;

      const metadata = ssoConnection.metadata;

      const jwksUri = metadata.jwks_uri;
      const algorithms = metadata.id_token_signing_alg_values_supported;
      const issuer = metadata.issuer;

      if (!jwksUri || !algorithms || !issuer) {
        throw new Error(
          "Missing SSO metadata: 'issuer', 'jwks_uri', and/or 'id_token_signing_alg_values_supported'"
        );
      }

      const middleware = jwtExpress({
        secret: jwks.expressJwtSecret({
          cache: true,
          rateLimit: true,
          jwksRequestsPerMinute: 5,
          jwksUri,
        }),
        audience: ssoConnection.clientId,
        issuer,
        algorithms,
      });
      middleware(req, res, next);
    } catch (e) {
      next(e);
    }
  }
  async processCallback(req: Request, res: Response): Promise<TokensResponse> {
    const ssoConnection = await getConnectionFromRequest(req);
    if (!ssoConnection) {
      throw new Error("Could not find SSO connection for this request");
    }
    const client = this.getOpenIdClient(ssoConnection);

    // Get rid of temporary codeVerifier cookie
    const checks = this.getAuthChecks(req);
    AuthChecksCookie.setValue("", req, res);

    if (!checks) {
      throw new Error("Missing auth checks in session");
    }
    if (checks.connection_id !== (ssoConnection.id || "")) {
      throw new Error("Invalid auth checks in session");
    }

    const params = client.callbackParams(req.originalUrl);
    const tokenSet = await client.callback(
      `${APP_ORIGIN}/oauth/callback`,
      params,
      {
        code_verifier: checks.code_verifier,
        state: checks.state,
      }
    );

    return {
      idToken: tokenSet?.id_token || "",
      refreshToken: tokenSet?.refresh_token || "",
      expiresIn: this.getMaxAge(tokenSet),
    };
  }
  async logout(req: Request): Promise<string> {
    const ssoConnection = await getConnectionFromRequest(req);
    if (ssoConnection?.metadata?.end_session_endpoint) {
      const client = this.getOpenIdClient(ssoConnection);
      return client.endSessionUrl();
    }
    return "";
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
    req: Request,
    res: Response
  ) {
    const client = this.getOpenIdClient(ssoConnection);

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
      audience: (ssoConnection.metadata?.audience ||
        ssoConnection.clientId) as string,
    });

    if (ssoConnection.extraQueryParams) {
      for (const [k, v] of Object.entries(ssoConnection.extraQueryParams)) {
        url += `&${k}=${v}`;
      }
    }

    return url;
  }

  private getOpenIdClient(connection: SSOConnectionInterface) {
    const cacheKey = JSON.stringify(connection);
    const existing = ssoClientCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const issuer = new Issuer(connection.metadata as IssuerMetadata);
    const client = new issuer.Client({
      client_id: connection.clientId,
      client_secret: connection.clientSecret,
      redirect_uris: [`${APP_ORIGIN}/oauth/callback`],
      response_types: [`code`],
      token_endpoint_auth_method: connection.clientSecret
        ? "client_secret_basic"
        : "none",
    });
    ssoClientCache.set(cacheKey, client);
    return client;
  }
}

function getDefaultSSOConnection(): SSOConnectionInterface {
  if (!SSO_CONFIG) {
    throw new Error("No SSO connection configured");
  }
  return SSO_CONFIG;
}
async function getConnectionFromRequest(
  req: Request
): Promise<SSOConnectionInterface> {
  const ssoConnectionId = SSOConnectionIdCookie.getValue(req);
  if (IS_CLOUD && ssoConnectionId) {
    const existing = ssoConnectionCache.get(ssoConnectionId);
    if (existing) {
      return existing;
    }

    const ssoConnection = await getSSOConnectionById(ssoConnectionId);
    if (ssoConnection) {
      ssoConnectionCache.set(ssoConnectionId, ssoConnection);
      return ssoConnection;
    } else {
      throw new Error("Could not find SSO connection - " + ssoConnectionId);
    }
  }

  // Otherwise, use default
  return getDefaultSSOConnection();
}
