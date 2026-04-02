import { Request, Response } from "express";

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
