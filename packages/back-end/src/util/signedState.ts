import { createHmac, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { JWT_SECRET } from "back-end/src/util/secrets";

const sign = (payload: string) =>
  createHmac("sha256", JWT_SECRET).update(payload).digest("base64url");

/**
 * Encodes a payload as `base64url(json).hmac` so it can travel through a URL
 * or an OAuth `state` parameter and come back unmodified. The payload carries
 * its own `createdAt` so verification can reject stale states.
 */
export function signState<T extends { createdAt: number }>(payload: T): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export type VerifiedState<T> =
  | { status: "valid"; data: T }
  | { status: "invalid" }
  | { status: "expired" };

/**
 * Checks the signature before decoding anything, then the schema, then that
 * `createdAt` lies within `maxAgeMs` of now. A future `createdAt` is expired.
 */
export function verifySignedState<T extends { createdAt: number }>(
  state: string,
  schema: z.ZodType<T>,
  maxAgeMs: number,
): VerifiedState<T> {
  const parts = state.split(".");
  if (parts.length !== 2) return { status: "invalid" };
  const [payload, signature] = parts;
  if (!payload || !signature) return { status: "invalid" };
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return { status: "invalid" };

  let input: unknown;
  try {
    input = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { status: "invalid" };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const age = Date.now() - parsed.data.createdAt;
  if (age < 0 || age > maxAgeMs) return { status: "expired" };
  return { status: "valid", data: parsed.data };
}
