import { APP_ORIGIN, IS_CLOUD, JWT_SECRET, SSO_CONFIG } from "../util/secrets";
import jwtExpress from "express-jwt";
import jwt from "jsonwebtoken";
import jwks from "jwks-rsa";
import { NextFunction, Request, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { markUserAsVerified, UserModel } from "../models/UserModel";
import {
  getDefaultPermissions,
  getOrganizationById,
  getPermissionsByRole,
  getRole,
} from "./organizations";
import { MemberRole } from "../../types/organization";
import { UserInterface } from "../../types/user";
import { AuditInterface } from "../../types/audit";
import { insertAudit } from "./audit";
import { getUserByEmail, getUserById } from "./users";
import { hasOrganization } from "../models/OrganizationModel";
import {
  SSOConnectionInterface,
  UnauthenticatedResponse,
} from "../../types/sso-connection";
import { getSSOConnectionById } from "../models/SSOConnectionModel";
import { Issuer, IssuerMetadata, generators, Client } from "openid-client";
import {
  AuthRefreshModel,
  createRefreshToken,
  getUserIdFromAuthRefreshToken,
} from "../models/AuthRefreshModel";

type JWTInfo = {
  email?: string;
  verified?: boolean;
  name?: string;
};

type IdToken = {
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  sub?: string;
};

function days(n: number) {
  return n * 24 * 60 * 60 * 1000;
}
function minutes(n: number) {
  return n * 60 * 1000;
}

class Cookie {
  private key: string;
  private expires: number;
  constructor(key: string, expires: number) {
    this.key = key;
    this.expires = expires;
  }

  setValue(value: string, req: Request, res: Response, maxAge: number = 0) {
    if (!value) {
      res.clearCookie(this.key, {
        httpOnly: true,
        maxAge: maxAge || this.expires,
        secure: req.secure,
      });
    } else {
      res.cookie(this.key, value, {
        httpOnly: true,
        maxAge: maxAge || this.expires,
        secure: req.secure,
      });
    }
  }

  getValue(req: Request) {
    return req.cookies[this.key] || "";
  }
}

export const SSOConnectionIdCookie = new Cookie("SSO_CONNECTION_ID", days(30));
export const RefreshTokenCookie = new Cookie("AUTH_REFRESH_TOKEN", days(30));
export const IdTokenCookie = new Cookie("AUTH_ID_TOKEN", minutes(15));
export const CodeVerifierCookie = new Cookie("CODE_VERIFIER", minutes(10));

type TokensResponse = {
  idToken: string;
  refreshToken: string;
  expiresIn: number;
};

export interface AuthConnection {
  refresh(
    req: Request,
    res: Response,
    refreshToken: string
  ): Promise<TokensResponse>;
  getUnauthenticatedResponse(
    req: Request,
    res: Response
  ): Promise<UnauthenticatedResponse>;
  middleware(req: AuthRequest, res: Response, next: NextFunction): void;
  processCallback(
    req: Request,
    res: Response,
    data: unknown
  ): Promise<TokensResponse>;
  logout(req: Request, res: Response): Promise<string>;
}

export function getAuthConnection(): AuthConnection {
  return usingOpenId() ? new OpenIdAuth() : new LocalAuth();
}

export class LocalAuth implements AuthConnection {
  middleware(req: Request, res: Response, next: NextFunction): void {
    if (!JWT_SECRET) {
      throw new Error("Must specify JWT_SECRET environment variable");
    }
    const jwtCheck = jwtExpress({
      secret: JWT_SECRET,
      audience: "https://api.growthbook.io",
      issuer: "https://api.growthbook.io",
      algorithms: ["HS256"],
    });
    jwtCheck(req, res, next);
  }
  async processCallback(
    req: Request,
    res: Response,
    user: UserInterface
  ): Promise<TokensResponse> {
    const idToken = this.generateJWT(user);
    const refreshToken = await createRefreshToken(req, user);
    return { idToken, refreshToken, expiresIn: 1800 };
  }
  async logout(req: Request): Promise<string> {
    const refreshToken = RefreshTokenCookie.getValue(req);
    if (refreshToken) {
      await AuthRefreshModel.deleteOne({
        token: refreshToken,
      });
    }
    return "";
  }
  async getUnauthenticatedResponse(): Promise<UnauthenticatedResponse> {
    const newInstallation = await isNewInstallation();
    return {
      showLogin: true,
      newInstallation,
    };
  }
  async refresh(
    req: Request,
    res: Response,
    refreshToken: string
  ): Promise<TokensResponse> {
    const userId = await getUserIdFromAuthRefreshToken(refreshToken);
    if (!userId) {
      throw new Error("No user found with that refresh token");
    }

    const user = await getUserById(userId);
    if (!user) {
      throw new Error("Invalid user id - " + userId);
    }

    return {
      idToken: this.generateJWT(user),
      refreshToken,
      expiresIn: 1800,
    };
  }
  private generateJWT(user: UserInterface) {
    return jwt.sign(
      {
        scope: "profile openid email",
        email: user.email,
        given_name: user.name,
        email_verified: false,
      },
      JWT_SECRET,
      {
        algorithm: "HS256",
        audience: "https://api.growthbook.io",
        issuer: "https://api.growthbook.io",
        subject: user.id,
        // 30 minutes
        expiresIn: 1800,
      }
    );
  }
}

const ssoConnectionCache: Map<string, SSOConnectionInterface> = new Map();
const ssoClientCache: Map<string, Client> = new Map();
export class OpenIdAuth implements AuthConnection {
  async getUnauthenticatedResponse(
    req: Request,
    res: Response
  ): Promise<UnauthenticatedResponse> {
    const ssoConnection = await getConnectionFromRequest(req);
    if (!ssoConnection) {
      throw new Error("Could not find SSO connection for this request");
    }
    const redirectURI = this.getRedirectURI(ssoConnection, req, res);
    return {
      redirectURI,
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
      expiresIn: tokenSet.expires_in || 0,
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
    const codeVerifier = CodeVerifierCookie.getValue(req);
    CodeVerifierCookie.setValue("", req, res);

    const params = client.callbackParams(req.originalUrl);
    const tokenSet = await client.callback(
      `${APP_ORIGIN}/oauth/callback`,
      params,
      {
        code_verifier: codeVerifier,
      }
    );

    return {
      idToken: tokenSet?.id_token || "",
      refreshToken: tokenSet?.refresh_token || "",
      expiresIn: tokenSet?.expires_in || 0,
    };
  }
  async logout(req: Request, res: Response): Promise<string> {
    const ssoConnection = await getConnectionFromRequest(req);
    SSOConnectionIdCookie.setValue("", req, res);

    if (ssoConnection?.metadata?.end_session_endpoint) {
      const client = this.getOpenIdClient(ssoConnection);
      return client.endSessionUrl();
    }

    return "";
  }

  private getRedirectURI(
    ssoConnection: SSOConnectionInterface,
    req: Request,
    res: Response
  ) {
    const client = this.getOpenIdClient(ssoConnection);

    const code_verifier = generators.codeVerifier();
    const code_challenge = generators.codeChallenge(code_verifier);

    CodeVerifierCookie.setValue(code_verifier, req, res);

    let url = client.authorizationUrl({
      scope: `openid email profile ${
        ssoConnection.additionalScope || ""
      }`.trim(),
      code_challenge,
      code_challenge_method: "S256",
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

async function getUserFromJWT(token: IdToken): Promise<null | UserInterface> {
  if (!token.email) {
    throw new Error("Id token does not contain email address");
  }
  const user = await getUserByEmail(String(token.email));
  if (!user) return null;
  return user.toJSON();
}
function getInitialDataFromJWT(user: IdToken): JWTInfo {
  return {
    verified: user.email_verified || false,
    email: user.email || "",
    name: user.given_name || "",
  };
}

export async function processJWT(
  // eslint-disable-next-line
  req: AuthRequest & { user: any },
  res: Response,
  next: NextFunction
) {
  const { email, name, verified } = getInitialDataFromJWT(req.user);

  req.email = email || "";
  req.name = name || "";
  req.verified = verified || false;
  req.permissions = getDefaultPermissions();

  // Throw error if permissions don't pass
  req.checkPermissions = (...permissions) => {
    for (let i = 0; i < permissions.length; i++) {
      if (!req.permissions[permissions[i]]) {
        throw new Error("You do not have permission to complete that action.");
      }
    }
  };

  const user = await getUserFromJWT(req.user);

  if (user) {
    req.email = user.email;
    req.userId = user.id;
    req.name = user.name;
    req.admin = !!user.admin;

    if (IS_CLOUD && user.verified && !req.verified) {
      return res.status(406).json({
        status: 406,
        message: "You must verify your email address before using GrowthBook",
      });
    }

    if (!user.verified && req.verified) {
      await markUserAsVerified(user.id);
    }

    if (req.headers["x-organization"]) {
      req.organization =
        (await getOrganizationById("" + req.headers["x-organization"])) ||
        undefined;

      if (req.organization) {
        // Make sure member is part of the organization
        if (
          !req.admin &&
          !req.organization.members.filter((m) => m.id === req.userId).length
        ) {
          return res.status(403).json({
            status: 403,
            message: "You do not have access to that organization",
          });
        }

        // Make sure this is a valid login method for the organization
        if (req.organization.restrictLoginMethod) {
          if (req.loginMethod?.id !== req.organization.restrictLoginMethod) {
            return res.status(403).json({
              status: 403,
              message: "Must login with Enterprise SSO.",
            });
          }
        }

        const role: MemberRole = req.admin
          ? "admin"
          : getRole(req.organization, user.id);
        req.permissions = getPermissionsByRole(role);
      } else {
        return res.status(404).json({
          status: 404,
          message: "Organization not found",
        });
      }
    }

    req.audit = async (data: Partial<AuditInterface>) => {
      await insertAudit({
        ...data,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        organization: req.organization?.id,
        dateCreated: new Date(),
      });
    };
  } else {
    req.audit = async () => {
      throw new Error("No user in request");
    };
  }

  next();
}

export function validatePasswordFormat(password?: string): string {
  if (!password) {
    throw new Error("Password cannot be empty");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  return password;
}

async function checkNewInstallation() {
  const doc = await hasOrganization();
  if (doc) {
    return false;
  }

  const doc2 = await UserModel.findOne();
  if (doc2) {
    return false;
  }

  return true;
}

let newInstallationPromise: Promise<boolean>;
export function isNewInstallation() {
  if (!newInstallationPromise) {
    newInstallationPromise = checkNewInstallation();
  }
  return newInstallationPromise;
}
export function markInstalled() {
  newInstallationPromise = new Promise((resolve) => resolve(false));
}

export function usingOpenId() {
  if (IS_CLOUD) return true;
  if (SSO_CONFIG) return true;
  return false;
}
