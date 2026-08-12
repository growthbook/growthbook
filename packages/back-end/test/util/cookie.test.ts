import jwt from "jsonwebtoken";
import { Request, Response } from "express";
import { isIdTokenExpired, setIdTokenCookie } from "back-end/src/util/cookie";

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
