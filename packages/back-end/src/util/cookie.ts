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

  // cookie-parser JSON-decodes any cookie whose value starts with `j:`, so
  // req.cookies can hold arbitrary attacker-controlled objects. Never hand one
  // to a caller — an object reaching a Mongo filter turns into an operator
  // injection (e.g. `j:{"$ne":""}` matching any refresh token).
  getValue(req: Request): string {
    const value = req.cookies[this.key];
    return typeof value === "string" ? value : "";
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

// One cookie per in-flight login so concurrent tabs can't overwrite each other's state
const AUTH_CHECKS_PREFIX = "AUTH_CHECKS_";
// Long enough to sit on the IdP's login page for a while before coming back
const AUTH_CHECKS_TTL = minutes(60);
const MAX_PENDING_AUTH_CHECKS = 10;

// Creation time is stored alongside the value so the cap can evict oldest-first
type PendingAuthChecks = { t: number; v: string };

function authChecksCookie(state: string) {
  return new Cookie(AUTH_CHECKS_PREFIX + state, AUTH_CHECKS_TTL);
}

function readPendingAuthChecks(
  req: Request,
): Record<string, PendingAuthChecks> {
  const pending: Record<string, PendingAuthChecks> = {};
  for (const [name, value] of Object.entries(req.cookies)) {
    if (!name.startsWith(AUTH_CHECKS_PREFIX) || typeof value !== "string") {
      continue;
    }
    try {
      const parsed = JSON.parse(value) as Partial<PendingAuthChecks> | null;
      if (typeof parsed?.t === "number" && typeof parsed?.v === "string") {
        pending[name.slice(AUTH_CHECKS_PREFIX.length)] = {
          t: parsed.t,
          v: parsed.v,
        };
      }
    } catch (e) {
      // ignore malformed cookies
    }
  }
  return pending;
}

export function getPendingAuthChecks(req: Request): Record<string, string> {
  return Object.fromEntries(
    Object.entries(readPendingAuthChecks(req)).map(([s, c]) => [s, c.v]),
  );
}

export function setPendingAuthChecks(
  state: string,
  value: string,
  req: Request,
  res: Response,
) {
  // Abandoned flows expire on their own; past the cap, evict the oldest
  const oldestFirst = Object.entries(readPendingAuthChecks(req)).sort(
    (a, b) => a[1].t - b[1].t,
  );
  const excess = oldestFirst.length + 1 - MAX_PENDING_AUTH_CHECKS;
  for (const [s] of oldestFirst.slice(0, Math.max(0, excess))) {
    clearPendingAuthChecks(req, res, s);
  }
  authChecksCookie(state).setValue(
    JSON.stringify({ t: Date.now(), v: value }),
    req,
    res,
  );
}

export function clearPendingAuthChecks(
  req: Request,
  res: Response,
  state?: string,
) {
  const states = state ? [state] : Object.keys(readPendingAuthChecks(req));
  for (const s of states) {
    authChecksCookie(s).setValue("", req, res);
  }
}

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
