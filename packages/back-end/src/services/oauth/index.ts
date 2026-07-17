import crypto from "crypto";
import { Request } from "express";
import { ApiKeyInterface } from "shared/types/apikey";
import { OAuthDcrRequest } from "shared/validators";
import {
  APP_ORIGIN,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_ISSUER,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
} from "back-end/src/util/secrets";
import { getCollection } from "back-end/src/util/mongo.util";
import { COLLECTION_NAME as API_KEY_COLLECTION } from "back-end/src/models/ApiKeyModel";
import { findOrganizationsByMemberId } from "back-end/src/models/OrganizationModel";
import {
  hashToken,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
  verifyPkceS256,
} from "back-end/src/util/oauth-token.util";
import {
  consumeAuthCode,
  createOAuthClient,
  deleteRefreshToken,
  deleteRefreshTokensForGrant,
  findRefreshToken,
  getOAuthClientById,
  insertAuthCode,
  insertRefreshToken,
} from "back-end/src/models/OAuthModels";

export {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
  hashToken,
  verifyPkceS256,
};

const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function randomUrlSafe(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function getIssuer(req?: Request): string {
  if (OAUTH_ISSUER) return OAUTH_ISSUER;
  if (req) {
    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
    const host = req.get("host");
    if (host) return `${proto}://${host}`;
  }
  // Local default: API typically on 3100
  return "http://localhost:3100";
}

export function getAuthorizationServerMetadata(req?: Request) {
  const issuer = getIssuer(req);
  return {
    issuer,
    authorization_endpoint: `${APP_ORIGIN}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
  };
}

export async function registerPublicClient(body: OAuthDcrRequest) {
  const grantTypes = body.grant_types ?? [
    "authorization_code",
    "refresh_token",
  ];
  const responseTypes = body.response_types ?? ["code"];

  // Only public clients (MCP / native) for Phase 1
  if (
    body.token_endpoint_auth_method &&
    body.token_endpoint_auth_method !== "none"
  ) {
    throw new OAuthError(
      "invalid_client_metadata",
      "Only token_endpoint_auth_method=none is supported",
    );
  }

  const client = await createOAuthClient({
    clientName: body.client_name,
    redirectUris: body.redirect_uris,
    tokenEndpointAuthMethod: "none",
    grantTypes,
    responseTypes,
    scope: body.scope,
    clientUri: body.client_uri,
  });

  return {
    client_id: client.clientId,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: "none" as const,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    client_id_issued_at: Math.floor(client.dateCreated.getTime() / 1000),
  };
}

export async function getAuthorizeInfo(params: {
  clientId: string;
  redirectUri: string;
}) {
  const client = await getOAuthClientById(params.clientId);
  if (!client) {
    throw new OAuthError("invalid_client", "Unknown client_id");
  }
  if (!client.redirectUris.includes(params.redirectUri)) {
    throw new OAuthError(
      "invalid_request",
      "redirect_uri is not registered for this client",
    );
  }
  return {
    clientId: client.clientId,
    clientName: client.clientName || client.clientId,
    redirectUri: params.redirectUri,
  };
}

export async function mintAuthorizationCode(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  userId: string;
  organization: string;
  scope?: string;
  resource?: string;
  state?: string;
}): Promise<{ redirectTo: string }> {
  if (params.codeChallengeMethod !== "S256") {
    throw new OAuthError(
      "invalid_request",
      "Only code_challenge_method=S256 is supported",
    );
  }
  if (!params.codeChallenge) {
    throw new OAuthError("invalid_request", "code_challenge is required");
  }

  const info = await getAuthorizeInfo({
    clientId: params.clientId,
    redirectUri: params.redirectUri,
  });

  const code = randomUrlSafe(32);
  const now = new Date();
  await insertAuthCode({
    codeHash: hashToken(code),
    clientId: info.clientId,
    userId: params.userId,
    organization: params.organization,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: "S256",
    scope: params.scope,
    resource: params.resource,
    used: false,
    expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
    dateCreated: now,
  });

  const url = new URL(params.redirectUri);
  url.searchParams.set("code", code);
  if (params.state) {
    url.searchParams.set("state", params.state);
  }
  return { redirectTo: url.toString() };
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const client = await getOAuthClientById(params.clientId);
  if (!client) {
    throw new OAuthError("invalid_client", "Unknown client_id");
  }

  const authCode = await consumeAuthCode(hashToken(params.code));
  if (!authCode) {
    throw new OAuthError(
      "invalid_grant",
      "Authorization code is invalid, expired, or already used",
    );
  }
  if (authCode.clientId !== params.clientId) {
    throw new OAuthError("invalid_grant", "client_id mismatch");
  }
  if (authCode.redirectUri !== params.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri mismatch");
  }
  if (!verifyPkceS256(params.codeVerifier, authCode.codeChallenge)) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }

  return issueTokenPair({
    clientId: authCode.clientId,
    userId: authCode.userId,
    organization: authCode.organization,
    scope: authCode.scope,
    resource: authCode.resource,
  });
}

export async function exchangeRefreshToken(params: {
  refreshToken: string;
  clientId: string;
}): Promise<TokenResponse> {
  const client = await getOAuthClientById(params.clientId);
  if (!client) {
    throw new OAuthError("invalid_client", "Unknown client_id");
  }

  const tokenHash = hashToken(params.refreshToken);
  const existing = await findRefreshToken(tokenHash);
  if (!existing) {
    throw new OAuthError("invalid_grant", "Refresh token is invalid");
  }
  if (existing.expiresAt.getTime() <= Date.now()) {
    await deleteRefreshToken(tokenHash);
    throw new OAuthError("invalid_grant", "Refresh token has expired");
  }
  if (existing.clientId !== params.clientId) {
    throw new OAuthError("invalid_grant", "client_id mismatch");
  }

  // End the grant if the user was removed from the org after consent.
  const orgs = await findOrganizationsByMemberId(existing.userId);
  if (!orgs.some((o) => o.id === existing.organization)) {
    await deleteRefreshTokensForGrant(
      existing.clientId,
      existing.userId,
      existing.organization,
    );
    await disableAccessTokensForGrant(
      existing.clientId,
      existing.userId,
      existing.organization,
    );
    throw new OAuthError(
      "invalid_grant",
      "User is no longer a member of this organization",
    );
  }

  // Rotate: delete old refresh token before issuing a new pair
  await deleteRefreshToken(tokenHash);

  return issueTokenPair({
    clientId: existing.clientId,
    userId: existing.userId,
    organization: existing.organization,
    scope: existing.scope,
    resource: existing.resource,
  });
}

export async function revokeToken(params: {
  token: string;
  clientId?: string;
}): Promise<void> {
  // Try as refresh token first, then access token (apikeys)
  const tokenHash = hashToken(params.token);
  const refresh = await findRefreshToken(tokenHash);
  if (refresh) {
    if (params.clientId && refresh.clientId !== params.clientId) return;
    await deleteRefreshTokensForGrant(
      refresh.clientId,
      refresh.userId,
      refresh.organization,
    );
    await disableAccessTokensForGrant(
      refresh.clientId,
      refresh.userId,
      refresh.organization,
    );
    return;
  }

  if (params.token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
    const apiKey = await getCollection<ApiKeyInterface>(
      API_KEY_COLLECTION,
    ).findOne({ key: tokenHash });
    if (!apiKey) return;
    if (
      params.clientId &&
      apiKey.oauthClientId &&
      apiKey.oauthClientId !== params.clientId
    ) {
      return;
    }

    if (apiKey.oauthClientId && apiKey.userId && apiKey.organization) {
      await deleteRefreshTokensForGrant(
        apiKey.oauthClientId,
        apiKey.userId,
        apiKey.organization,
      );
      await disableAccessTokensForGrant(
        apiKey.oauthClientId,
        apiKey.userId,
        apiKey.organization,
      );
      return;
    }

    await getCollection<ApiKeyInterface>(API_KEY_COLLECTION).updateOne(
      { key: tokenHash },
      { $set: { disabled: true } },
    );
  }
}

async function disableAccessTokensForGrant(
  clientId: string,
  userId: string,
  organization: string,
): Promise<void> {
  await getCollection<ApiKeyInterface>(API_KEY_COLLECTION).updateMany(
    {
      oauthClientId: clientId,
      userId,
      organization,
      disabled: { $ne: true },
    },
    { $set: { disabled: true } },
  );
}

interface IssueParams {
  clientId: string;
  userId: string;
  organization: string;
  scope?: string;
  resource?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

async function issueTokenPair(params: IssueParams): Promise<TokenResponse> {
  const accessToken = OAUTH_ACCESS_TOKEN_PREFIX + randomUrlSafe(32);
  const refreshToken = OAUTH_REFRESH_TOKEN_PREFIX + randomUrlSafe(32);
  const now = new Date();
  const accessExpires = new Date(
    now.getTime() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
  );
  const refreshExpires = new Date(
    now.getTime() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
  );

  const apiKeyDoc: ApiKeyInterface = {
    id: `key_${crypto.randomBytes(12).toString("hex")}`,
    key: hashToken(accessToken),
    organization: params.organization,
    dateCreated: now,
    dateUpdated: now,
    secret: true,
    userId: params.userId,
    role: "user",
    description: `OAuth access token (${params.clientId})`,
    environment: "",
    project: "",
    encryptSDK: false,
    limitAccessByEnvironment: false,
    environments: [],
    expiresAt: accessExpires,
    oauthClientId: params.clientId,
    scopes: params.scope ? params.scope.split(/\s+/).filter(Boolean) : [],
    lastUsed: null,
  };

  // Raw insert: token endpoint has no ReqContext / ApiKeyModel instance.
  await getCollection(API_KEY_COLLECTION).insertOne(
    apiKeyDoc as unknown as Record<string, unknown>,
  );

  await insertRefreshToken({
    tokenHash: hashToken(refreshToken),
    clientId: params.clientId,
    userId: params.userId,
    organization: params.organization,
    scope: params.scope,
    resource: params.resource,
    expiresAt: refreshExpires,
    dateCreated: now,
  });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: params.scope,
  };
}

export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly errorDescription?: string,
    public readonly status = 400,
  ) {
    super(errorDescription || error);
    this.name = "OAuthError";
  }
}
