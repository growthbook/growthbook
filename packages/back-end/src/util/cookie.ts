import { Request, Response } from "express";
import jwt from "jsonwebtoken";

class Cookie {
  private key: string;
  private expires: number;
  private path?: string;
  constructor(key: string, expires: number, path?: string) {
    this.key = key;
    this.expires = expires;
    this.path = path;
  }

  setValue(value: string, req: Request, res: Response, maxAge: number = 0) {
    const opts: {
      httpOnly: boolean;
      maxAge: number;
      secure: boolean;
      path?: string;
    } = {
      httpOnly: true,
      maxAge: maxAge || this.expires,
      secure: req.secure,
    };
    if (this.path) {
      opts.path = this.path;
    }

    if (!value) {
      res.clearCookie(this.key, opts);
    } else {
      res.cookie(this.key, value, opts);
    }

    // Clear any legacy cookie at the default path during transition
    if (this.path) {
      res.clearCookie(this.key, {
        httpOnly: true,
        secure: req.secure,
      });
    }

    req.cookies[this.key] = value;
  }

  getValue(req: Request) {
    return req.cookies[this.key] || "";
  }
}

function days(n: number) {
  return n * 24 * 60 * 60 * 1000;
}
function minutes(n: number) {
  return n * 60 * 1000;
}
export const SSOConnectionIdCookie = new Cookie("SSO_CONNECTION_ID", days(30));
export const RefreshTokenCookie = new Cookie(
  "AUTH_REFRESH_TOKEN",
  days(30),
  "/auth",
);
export const IdTokenCookie = new Cookie("AUTH_ID_TOKEN", minutes(15));
export const AuthChecksCookie = new Cookie("AUTH_CHECKS", minutes(10));

// Read the JWT's `exp` claim without verifying the signature — we only trust
// the cookie value once a downstream middleware has verified it.
function getJwtExpMs(idToken: string): number | null {
  if (!idToken) return null;
  try {
    const decoded = jwt.decode(idToken) as { exp?: number } | null;
    if (decoded?.exp) return decoded.exp * 1000;
  } catch (_) {
    // fall through
  }
  return null;
}

// Set the AUTH_ID_TOKEN cookie that expires based on the JWT's `exp` claim
export function setIdTokenCookie(idToken: string, req: Request, res: Response) {
  const expMs = getJwtExpMs(idToken);
  // If the token is already expired, don't store it, clear instead.
  if (expMs !== null && expMs <= Date.now()) {
    IdTokenCookie.setValue("", req, res);
    return;
  }
  // Fall back to 15 minutes if the `exp` claim is not present.
  const maxAge = expMs ? expMs - Date.now() : minutes(15);
  IdTokenCookie.setValue(idToken, req, res, maxAge);
}

export function isIdTokenExpired(idToken: string): boolean {
  const expMs = getJwtExpMs(idToken);
  if (expMs === null) return false;
  return expMs <= Date.now();
}
