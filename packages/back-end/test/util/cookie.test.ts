import jwt from "jsonwebtoken";
import { Request, Response } from "express";
import {
  IdTokenCookie,
  RefreshTokenCookie,
  clearPendingAuthChecks,
  getPendingAuthChecks,
  isIdTokenExpired,
  setIdTokenCookie,
  setPendingAuthChecks,
} from "back-end/src/util/cookie";

function makeReqRes() {
  const cookieCalls: {
    name: string;
    value: string;
    opts: { maxAge: number };
  }[] = [];
  const clearCalls: { name: string }[] = [];
  const req = { cookies: {}, secure: false } as unknown as Request;
  const res = {
    cookie: (name: string, value: string, opts: { maxAge: number }) => {
      cookieCalls.push({ name, value, opts });
    },
    clearCookie: (name: string) => {
      clearCalls.push({ name });
    },
  } as unknown as Response;
  return { req, res, cookieCalls, clearCalls };
}

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

describe("setIdTokenCookie", () => {
  it("sets cookie maxAge to match the JWT's exp claim", () => {
    const tenHoursMs = 10 * 60 * 60 * 1000;
    const token = jwt.sign({}, "secret", { expiresIn: 10 * 60 * 60 });
    const { req, res, cookieCalls } = makeReqRes();

    setIdTokenCookie(token, req, res);

    expect(cookieCalls).toHaveLength(1);
    expect(cookieCalls[0].name).toBe("AUTH_ID_TOKEN");
    // Should be ~10h, allow a small clock-drift window
    expect(cookieCalls[0].opts.maxAge).toBeGreaterThan(tenHoursMs - 5_000);
    expect(cookieCalls[0].opts.maxAge).toBeLessThanOrEqual(tenHoursMs);
  });

  it("falls back to 15 minutes when the JWT has no exp claim", () => {
    const token = jwt.sign({ foo: "bar" }, "secret"); // no expiresIn
    const { req, res, cookieCalls } = makeReqRes();

    setIdTokenCookie(token, req, res);

    expect(cookieCalls).toHaveLength(1);
    expect(cookieCalls[0].opts.maxAge).toBe(FIFTEEN_MIN_MS);
  });

  it("falls back to 15 minutes for a non-JWT string", () => {
    const { req, res, cookieCalls } = makeReqRes();

    setIdTokenCookie("not-a-jwt", req, res);

    expect(cookieCalls).toHaveLength(1);
    expect(cookieCalls[0].opts.maxAge).toBe(FIFTEEN_MIN_MS);
  });

  it("clears the cookie for an already-expired JWT instead of storing it", () => {
    // Build a token whose exp is 1 hour in the past
    const token = jwt.sign(
      { exp: Math.floor(Date.now() / 1000) - 3600 },
      "secret",
    );
    const { req, res, cookieCalls, clearCalls } = makeReqRes();

    setIdTokenCookie(token, req, res);

    expect(cookieCalls).toHaveLength(0);
    expect(clearCalls.some((c) => c.name === "AUTH_ID_TOKEN")).toBe(true);
  });
});

describe("Cookie.getValue", () => {
  function reqWithCookies(cookies: Record<string, unknown>) {
    return { cookies } as unknown as Request;
  }

  it("returns the value for a normal string cookie", () => {
    const req = reqWithCookies({ AUTH_REFRESH_TOKEN: "abc123" });
    expect(RefreshTokenCookie.getValue(req)).toBe("abc123");
  });

  it("returns an empty string when the cookie is missing", () => {
    expect(RefreshTokenCookie.getValue(reqWithCookies({}))).toBe("");
  });

  // cookie-parser turns `AUTH_REFRESH_TOKEN=j:{"$ne":""}` into an object. If it
  // reached the Mongo filter it would match any refresh token, so it must be
  // dropped here.
  it("drops a JSON-decoded object instead of passing it through", () => {
    const req = reqWithCookies({ AUTH_REFRESH_TOKEN: { $ne: "" } });
    expect(RefreshTokenCookie.getValue(req)).toBe("");
  });

  it("drops JSON-decoded arrays and numbers", () => {
    expect(
      RefreshTokenCookie.getValue(reqWithCookies({ AUTH_REFRESH_TOKEN: [1] })),
    ).toBe("");
    expect(
      RefreshTokenCookie.getValue(reqWithCookies({ AUTH_REFRESH_TOKEN: 42 })),
    ).toBe("");
  });

  it("applies to every cookie, not just the refresh token", () => {
    const req = reqWithCookies({ AUTH_ID_TOKEN: { $ne: "" } });
    expect(IdTokenCookie.getValue(req)).toBe("");
  });
});

describe("pending auth checks", () => {
  it("keeps one cookie per flow so concurrent logins don't overwrite each other", () => {
    const { req, res, cookieCalls } = makeReqRes();

    setPendingAuthChecks("s1", "a", req, res);
    setPendingAuthChecks("s2", "b", req, res);

    expect(cookieCalls.map((c) => c.name)).toEqual([
      "AUTH_CHECKS_s1",
      "AUTH_CHECKS_s2",
    ]);
    expect(getPendingAuthChecks(req)).toEqual({ s1: "a", s2: "b" });
  });

  it("clears only the consumed flow", () => {
    const { req, res, clearCalls } = makeReqRes();
    setPendingAuthChecks("s1", "a", req, res);
    setPendingAuthChecks("s2", "b", req, res);

    clearPendingAuthChecks(req, res, "s1");

    expect(clearCalls).toEqual([{ name: "AUTH_CHECKS_s1" }]);
    expect(getPendingAuthChecks(req)).toEqual({ s2: "b" });
  });

  it("sweeps every pending flow once too many pile up", () => {
    const { req, res, clearCalls } = makeReqRes();
    for (let i = 0; i < 10; i++) {
      setPendingAuthChecks(`s${i}`, "x", req, res);
    }
    expect(clearCalls).toHaveLength(0);

    setPendingAuthChecks("s10", "y", req, res);

    expect(clearCalls).toHaveLength(10);
    expect(getPendingAuthChecks(req)).toEqual({ s10: "y" });
  });

  it("ignores unrelated, empty, and JSON-decoded object cookies", () => {
    const req = {
      cookies: {
        AUTH_CHECKS_a: "ok",
        AUTH_CHECKS_b: "",
        AUTH_CHECKS_c: { $ne: "" },
        AUTH_REFRESH_TOKEN: "abc",
      },
    } as unknown as Request;

    expect(getPendingAuthChecks(req)).toEqual({ a: "ok" });
  });
});

describe("isIdTokenExpired", () => {
  it("returns true for an expired token", () => {
    const token = jwt.sign(
      { exp: Math.floor(Date.now() / 1000) - 60 },
      "secret",
    );
    expect(isIdTokenExpired(token)).toBe(true);
  });

  it("returns false for a token whose exp is in the future", () => {
    const token = jwt.sign({}, "secret", { expiresIn: 600 });
    expect(isIdTokenExpired(token)).toBe(false);
  });

  it("returns false for a token without an exp claim (cannot tell)", () => {
    const token = jwt.sign({ foo: "bar" }, "secret");
    expect(isIdTokenExpired(token)).toBe(false);
  });

  it("returns false for a non-JWT string", () => {
    expect(isIdTokenExpired("not-a-jwt")).toBe(false);
  });
});
