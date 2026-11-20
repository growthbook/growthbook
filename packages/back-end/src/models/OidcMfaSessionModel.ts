import crypto from "crypto";
import mongoose from "mongoose";
import { LruCache } from "back-end/src/services/cache";

// IdP sessions whose login used MFA, since Auth0 leaves `amr` off refreshed id tokens
const oidcMfaSessionSchema = new mongoose.Schema({
  key: {
    type: String,
    unique: true,
  },
  createdAt: {
    type: Date,
    // Matches the local refresh-token lifetime; after that, MFA is asked for again
    expires: 30 * 24 * 60 * 60,
  },
});

const OidcMfaSessionModel = mongoose.model<{ key: string; createdAt: Date }>(
  "OidcMfaSession",
  oidcMfaSessionSchema,
);

type IdpSessionClaims = { iss?: unknown; sub?: unknown; sid?: unknown };

function getSessionKey({ iss, sub, sid }: IdpSessionClaims): string | null {
  if (!iss || !sub || !sid) return null;
  if (typeof iss !== "string" || typeof sub !== "string") return null;
  if (typeof sid !== "string") return null;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([iss, sub, sid]))
    .digest("hex");
}

const CACHE_TTL_MS = 60 * 1000;
const cache = new LruCache<{ mfa: boolean; expires: number }, string>(10000);

export async function recordOidcMfaSession(claims: IdpSessionClaims) {
  const key = getSessionKey(claims);
  if (!key) return;
  await OidcMfaSessionModel.updateOne(
    { key },
    // A fresh MFA login restarts the 30 days
    { $set: { createdAt: new Date() } },
    { upsert: true },
  );
  cache.put(key, { mfa: true, expires: Date.now() + CACHE_TTL_MS });
}

export async function isOidcMfaSession(
  claims: IdpSessionClaims,
): Promise<boolean> {
  const key = getSessionKey(claims);
  if (!key) return false;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.mfa;
  const mfa = !!(await OidcMfaSessionModel.exists({ key: { $eq: key } }));
  cache.put(key, { mfa, expires: Date.now() + CACHE_TTL_MS });
  return mfa;
}
