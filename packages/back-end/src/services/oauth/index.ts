import crypto from "crypto";
import { Request } from "express";
import { OAuthDcrRequest } from "shared/validators";
import { OrganizationInterface } from "shared/types/organization";
import {
  APP_ORIGIN,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_ISSUER,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
} from "back-end/src/util/secrets";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import { OAuthAuthCodeModel } from "back-end/src/models/OAuthAuthCodeModel";
import {
  createOAuthClient,
  getOAuthClientById,
} from "back-end/src/models/OAuthModels";
import { OAuthRefreshTokenModel } from "back-end/src/models/OAuthRefreshTokenModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import {
  getContextForAgendaJobByOrgObject,
  getContextForUserIdInOrg,
} from "back-end/src/services/organizations";
import { ApiReqContext } from "back-end/types/api";
import {
  hashToken,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
  verifyPkceS256,
} from "back-end/src/util/oauth-token.util";

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

async function getOrgForGrant(
  organizationId: string,
): Promise<OrganizationInterface> {
  const org = await findOrganizationById(organizationId);
  if (!org) {
    throw new OAuthError("invalid_grant", "Organization no longer exists");
  }
  return org;
}

/**
 * Build a ReqContext for grant teardown (revoke / cleanup). Prefers a
 * user-attributed context for the audit trail, but falls back to a system
 * agenda context so revocation still works after the user leaves the org.
 *
 * Token issuance intentionally has no such fallback: it requires a
 * user-attributed context from `getContextForUserIdInOrg`, which doubles as
 * the membership check (returns null when the user no longer exists or was
 * removed from the org).
 */
async function getTeardownContext(
  org: OrganizationInterface,
  userId: string,
): Promise<ApiReqContext> {
  const userContext = await getContextForUserIdInOrg(org, userId);
  if (userContext) return userContext;
  return getContextForAgendaJobByOrgObject(org);
}

async function tearDownGrant(
  context: ApiReqContext,
  clientId: string,
  userId: string,
): Promise<void> {
  await context.models.oauthRefreshTokens.deleteForGrant(clientId, userId);
  await ApiKeyModel.dangerousDisableOAuthGrant(
    clientId,
    userId,
    context.org.id,
  );
}

export interface ConnectedApp {
  clientId: string;
  clientName: string;
  clientUri?: string;
  scopes: string[];
  firstAuthorizedAt: Date;
  lastAuthorizedAt: Date;
}

/**
 * The OAuth apps a user has an active grant with in the current org, one row
 * per client. Built from refresh tokens (the durable per-grant record) and
 * enriched with client metadata. This is the read side of the "Connected Apps"
 * settings surface — the user-facing counterpart to the hidden access-token
 * API keys.
 */
export async function listConnectedApps(
  context: ApiReqContext,
): Promise<ConnectedApp[]> {
  if (!context.userId) return [];
  const tokens = await context.models.oauthRefreshTokens.getByUser(
    context.userId,
  );

  const byClient = new Map<string, ConnectedApp>();
  for (const token of tokens) {
    const created = token.dateCreated ?? new Date();
    const existing = byClient.get(token.clientId);
    const scopes = token.scope ? token.scope.split(/\s+/).filter(Boolean) : [];
    if (existing) {
      existing.firstAuthorizedAt = new Date(
        Math.min(existing.firstAuthorizedAt.getTime(), created.getTime()),
      );
      existing.lastAuthorizedAt = new Date(
        Math.max(existing.lastAuthorizedAt.getTime(), created.getTime()),
      );
      existing.scopes = Array.from(new Set([...existing.scopes, ...scopes]));
    } else {
      byClient.set(token.clientId, {
        clientId: token.clientId,
        clientName: token.clientId,
        scopes,
        firstAuthorizedAt: created,
        lastAuthorizedAt: created,
      });
    }
  }

  // Enrich with client metadata. A missing client (e.g. an old grant whose
  // client record was removed) still lists, falling back to the clientId.
  await Promise.all(
    Array.from(byClient.values()).map(async (app) => {
      const client = await getOAuthClientById(app.clientId);
      if (client) {
        app.clientName = client.clientName || client.clientId;
        app.clientUri = client.clientUri;
      }
    }),
  );

  return Array.from(byClient.values()).sort(
    (a, b) => b.lastAuthorizedAt.getTime() - a.lastAuthorizedAt.getTime(),
  );
}

/**
 * Revoke a user's grant with one OAuth client in the current org: deletes the
 * refresh tokens and disables the access-token API keys for that grant. Same
 * teardown the token endpoint uses, but keyed to the authenticated user so a
 * user can only ever revoke their own grants.
 */
export async function revokeConnectedApp(
  context: ApiReqContext,
  clientId: string,
): Promise<void> {
  if (!context.userId) {
    throw new OAuthError("access_denied", "Must be authenticated");
  }
  await tearDownGrant(context, clientId, context.userId);
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

  const org = await getOrgForGrant(params.organization);
  const context = await getContextForUserIdInOrg(org, params.userId);
  if (!context) {
    throw new OAuthError(
      "access_denied",
      "User is not a member of this organization",
    );
  }
  const code = randomUrlSafe(32);
  const now = new Date();
  await context.models.oauthAuthCodes.create({
    codeHash: hashToken(code),
    clientId: info.clientId,
    userId: params.userId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: "S256",
    scope: params.scope,
    resource: params.resource,
    used: false,
    expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
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

  // Bootstrap: hash lookup before org is known.
  const authCode = await OAuthAuthCodeModel.dangerousConsumeByHash(
    hashToken(params.code),
  );
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

  const org = await getOrgForGrant(authCode.organization);
  const context = await getContextForUserIdInOrg(org, authCode.userId);
  if (!context) {
    throw new OAuthError(
      "invalid_grant",
      "User is no longer a member of this organization",
    );
  }

  return issueTokenPair(context, {
    clientId: authCode.clientId,
    userId: authCode.userId,
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

  // Bootstrap: hash lookup before org is known.
  const tokenHash = hashToken(params.refreshToken);
  const existing = await OAuthRefreshTokenModel.dangerousFindByHash(tokenHash);
  if (!existing) {
    throw new OAuthError("invalid_grant", "Refresh token is invalid");
  }
  if (existing.clientId !== params.clientId) {
    throw new OAuthError("invalid_grant", "client_id mismatch");
  }
  // Check expiry before building an org context so a deleted org can't mask
  // the real error. The TTL index cleans up the expired doc.
  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new OAuthError("invalid_grant", "Refresh token has expired");
  }

  const org = await getOrgForGrant(existing.organization);

  // The member context doubles as the membership check: null means the user
  // was removed from the org after consent, so end the grant.
  const context = await getContextForUserIdInOrg(org, existing.userId);
  if (!context) {
    await tearDownGrant(
      getContextForAgendaJobByOrgObject(org),
      existing.clientId,
      existing.userId,
    );
    throw new OAuthError(
      "invalid_grant",
      "User is no longer a member of this organization",
    );
  }

  // Rotate: delete old refresh token (re-read org-scoped) before issuing a
  // new pair.
  const doc = await context.models.oauthRefreshTokens.getByTokenHash(tokenHash);
  if (doc) await context.models.oauthRefreshTokens.delete(doc);

  return issueTokenPair(context, {
    clientId: existing.clientId,
    userId: existing.userId,
    scope: existing.scope,
    resource: existing.resource,
  });
}

export async function revokeToken(params: {
  token: string;
  clientId?: string;
}): Promise<void> {
  const tokenHash = hashToken(params.token);

  // Try as refresh token first, then access token (apikeys)
  const refresh = await OAuthRefreshTokenModel.dangerousFindByHash(tokenHash);
  if (refresh) {
    // Require ownership: the caller must present the client_id the token was
    // issued to. A missing client_id (undefined) can't match the stored id,
    // so omitting it is a no-op and can't be used to bypass the check.
    if (refresh.clientId !== params.clientId) return;
    const org = await getOrgForGrant(refresh.organization);
    const context = await getTeardownContext(org, refresh.userId);
    await tearDownGrant(context, refresh.clientId, refresh.userId);
    return;
  }

  if (params.token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
    const apiKey = await ApiKeyModel.dangerousFindByKeyHash(tokenHash);
    if (!apiKey) return;

    // OAuth-issued access tokens carry their owning client. Same ownership
    // rule as refresh tokens: the caller must present the matching client_id,
    // and omitting it must not tear down another client's grant.
    if (apiKey.oauthClientId) {
      if (apiKey.oauthClientId !== params.clientId) return;
      if (apiKey.userId && apiKey.organization) {
        const org = await getOrgForGrant(apiKey.organization);
        const context = await getTeardownContext(org, apiKey.userId);
        await tearDownGrant(context, apiKey.oauthClientId, apiKey.userId);
        return;
      }
    }

    await ApiKeyModel.dangerousDisableByKeyHash(tokenHash);
  }
}

interface IssueParams {
  clientId: string;
  userId: string;
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

async function issueTokenPair(
  context: ApiReqContext,
  params: IssueParams,
): Promise<TokenResponse> {
  const accessToken = OAUTH_ACCESS_TOKEN_PREFIX + randomUrlSafe(32);
  const refreshToken = OAUTH_REFRESH_TOKEN_PREFIX + randomUrlSafe(32);
  const now = new Date();
  const accessExpires = new Date(
    now.getTime() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
  );
  const refreshExpires = new Date(
    now.getTime() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
  );

  // The context is always user-attributed (issuance requires a member
  // context), so this passes the PAT canCreate rule
  // (`doc.userId === context.userId`) and gets full validation + audit log.
  await context.models.apiKeys.create({
    key: hashToken(accessToken),
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
  });

  await context.models.oauthRefreshTokens.create({
    tokenHash: hashToken(refreshToken),
    clientId: params.clientId,
    userId: params.userId,
    scope: params.scope,
    resource: params.resource,
    expiresAt: refreshExpires,
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
