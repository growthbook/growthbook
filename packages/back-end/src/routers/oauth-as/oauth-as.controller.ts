import { Request, Response } from "express";
import { oauthDcrRequestValidator } from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { findOrganizationsByMemberId } from "back-end/src/models/OrganizationModel";
import {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  getAuthorizationServerMetadata,
  getAuthorizeInfo,
  mintAuthorizationCode,
  OAuthError,
  registerPublicClient,
  revokeToken,
} from "back-end/src/services/oauth";

function sendOAuthError(res: Response, err: unknown) {
  if (err instanceof OAuthError) {
    return res.status(err.status).json({
      error: err.error,
      error_description: err.errorDescription,
    });
  }
  const message = err instanceof Error ? err.message : "server_error";
  return res.status(500).json({
    error: "server_error",
    error_description: message,
  });
}

/** GET /.well-known/oauth-authorization-server */
export async function getAuthorizationServerMetadataHandler(
  req: Request,
  res: Response,
) {
  return res.status(200).json(getAuthorizationServerMetadata(req));
}

/** POST /oauth/register — RFC 7591 Dynamic Client Registration */
export async function postRegister(req: Request, res: Response) {
  try {
    const parsed = oauthDcrRequestValidator.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_client_metadata",
        error_description: parsed.error.message,
      });
    }
    const result = await registerPublicClient(parsed.data);
    return res.status(201).json(result);
  } catch (e) {
    return sendOAuthError(res, e);
  }
}

/** POST /oauth/token */
export async function postToken(req: Request, res: Response) {
  try {
    // Support both JSON and application/x-www-form-urlencoded
    const body = req.body || {};
    const grantType = body.grant_type as string | undefined;

    if (grantType === "authorization_code") {
      const result = await exchangeAuthorizationCode({
        code: String(body.code || ""),
        redirectUri: String(body.redirect_uri || ""),
        clientId: String(body.client_id || ""),
        codeVerifier: String(body.code_verifier || ""),
      });
      return res.status(200).json(result);
    }

    if (grantType === "refresh_token") {
      const result = await exchangeRefreshToken({
        refreshToken: String(body.refresh_token || ""),
        clientId: String(body.client_id || ""),
      });
      return res.status(200).json(result);
    }

    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description:
        "Supported grant_types: authorization_code, refresh_token",
    });
  } catch (e) {
    return sendOAuthError(res, e);
  }
}

/** POST /oauth/revoke — RFC 7009 */
export async function postRevoke(req: Request, res: Response) {
  try {
    const body = req.body || {};
    await revokeToken({
      token: String(body.token || ""),
      clientId: body.client_id ? String(body.client_id) : undefined,
    });
    // RFC 7009: always 200 even if token was invalid
    return res.status(200).json({});
  } catch (e) {
    return sendOAuthError(res, e);
  }
}

/**
 * GET /oauth/authorize/info — authenticated.
 * Validates client + redirect_uri; returns client name + user's orgs for the consent UI.
 */
export async function getAuthorizeInfoHandler(
  req: AuthRequest<
    unknown,
    unknown,
    { client_id?: string; redirect_uri?: string }
  >,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        status: 401,
        message: "Must be authenticated",
      });
    }

    const clientId = String(req.query.client_id || "");
    const redirectUri = String(req.query.redirect_uri || "");
    if (!clientId || !redirectUri) {
      return res.status(400).json({
        status: 400,
        message: "client_id and redirect_uri are required",
      });
    }

    const info = await getAuthorizeInfo({ clientId, redirectUri });
    const orgs = await findOrganizationsByMemberId(req.userId);

    return res.status(200).json({
      status: 200,
      client: {
        clientId: info.clientId,
        clientName: info.clientName,
      },
      redirectUri: info.redirectUri,
      organizations: orgs.map((o) => ({ id: o.id, name: o.name })),
      user: {
        id: req.userId,
        email: req.email,
        name: req.name,
      },
    });
  } catch (e) {
    if (e instanceof OAuthError) {
      return res.status(400).json({
        status: 400,
        message: e.errorDescription || e.error,
      });
    }
    throw e;
  }
}

/**
 * POST /oauth/authorize — authenticated.
 * Mints an auth code and returns the redirect URL for the consent page.
 */
export async function postAuthorize(
  req: AuthRequest<{
    client_id?: string;
    redirect_uri?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    state?: string;
    scope?: string;
    resource?: string;
    organization?: string;
  }>,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        status: 401,
        message: "Must be authenticated",
      });
    }

    const body = req.body || {};
    const organization = String(body.organization || "");
    if (!organization) {
      return res.status(400).json({
        status: 400,
        message: "organization is required",
      });
    }

    // Verify the user is a member of the chosen org
    const orgs = await findOrganizationsByMemberId(req.userId);
    if (!orgs.some((o) => o.id === organization) && !req.superAdmin) {
      return res.status(403).json({
        status: 403,
        message: "You do not have access to that organization",
      });
    }

    const { redirectTo } = await mintAuthorizationCode({
      clientId: String(body.client_id || ""),
      redirectUri: String(body.redirect_uri || ""),
      codeChallenge: String(body.code_challenge || ""),
      codeChallengeMethod: String(body.code_challenge_method || "S256"),
      userId: req.userId,
      organization,
      scope: body.scope ? String(body.scope) : undefined,
      resource: body.resource ? String(body.resource) : undefined,
      state: body.state ? String(body.state) : undefined,
    });

    return res.status(200).json({ status: 200, redirectTo });
  } catch (e) {
    if (e instanceof OAuthError) {
      return res.status(400).json({
        status: 400,
        message: e.errorDescription || e.error,
      });
    }
    throw e;
  }
}
