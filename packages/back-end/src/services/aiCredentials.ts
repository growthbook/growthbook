import { AES, enc } from "crypto-js";
import { AIProvider, AI_PROVIDERS, AI_PROVIDER_META } from "shared/ai";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ANTHROPIC_API_KEY,
  ENCRYPTION_KEY,
  GEMINI_API_KEY,
  GOOGLE_AI_API_KEY,
  MISTRAL_API_KEY,
  OPENAI_API_KEY,
  XAI_API_KEY,
} from "back-end/src/util/secrets";
import { fetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

type Context = ReqContext | ApiReqContext;

// Where the key actually being used came from. Surfaced to the settings UI so
// admins can tell "configured in GrowthBook" from "inherited from the
// environment", and used on Cloud to decide whether the org is spending its own
// money (and so shouldn't be rate limited).
export type AIKeySource = "organization" | "env" | "none";

export type ResolvedAIKey = {
  key: string;
  source: AIKeySource;
};

export type ResolvedAIKeys = Record<AIProvider, ResolvedAIKey>;

// ---- encryption (at rest) ----
// Same scheme as Data Source params and Figma tokens: symmetric AES with the
// install's ENCRYPTION_KEY. Rotating that key requires re-encrypting, which
// scripts/migrate-encryption-key.ts handles.
export function encryptAIKey(plaintext: string): string {
  return AES.encrypt(plaintext, ENCRYPTION_KEY).toString();
}

/**
 * Decrypts a stored key, or returns "" when it can't be decrypted with the
 * current ENCRYPTION_KEY.
 *
 * crypto-js offers no "wrong key" signal: AES.decrypt happily produces garbage
 * bytes, and `.toString(enc.Utf8)` then either returns an empty string or throws
 * "Malformed UTF-8 data", depending on whether those particular bytes happen to
 * be valid UTF-8. Both mean the same thing to every caller, so collapse them
 * into "" — otherwise the contract varies with the byte content of a failure.
 */
export function decryptAIKey(ciphertext: string): string {
  try {
    return AES.decrypt(ciphertext, ENCRYPTION_KEY).toString(enc.Utf8);
  } catch {
    return "";
  }
}

// Last 4 characters, for masked display. Short keys (which are almost certainly
// invalid anyway) get an empty mask rather than leaking most of themselves.
export function getKeyLast4(plaintext: string): string {
  return plaintext.length >= 8 ? plaintext.slice(-4) : "";
}

// Env fallbacks, read via secrets.ts so process.env stays confined there.
function getEnvKey(provider: AIProvider): string {
  switch (provider) {
    case "openai":
      return OPENAI_API_KEY;
    case "anthropic":
      return ANTHROPIC_API_KEY;
    case "xai":
      return XAI_API_KEY;
    case "mistral":
      return MISTRAL_API_KEY;
    case "google":
      // GEMINI_API_KEY is the legacy name; GOOGLE_AI_API_KEY wins.
      return GOOGLE_AI_API_KEY || GEMINI_API_KEY;
  }
}

const emptyResolvedKeys = (): ResolvedAIKeys =>
  AI_PROVIDERS.reduce((acc, provider) => {
    acc[provider] = { key: "", source: "none" };
    return acc;
  }, {} as ResolvedAIKeys);

// Per-request memoization. Keyed on the context object itself, which lives
// exactly as long as one request (or one background job), so the cache expires
// on its own and can never serve a stale key to a later request — no TTL to
// tune and no cross-instance invalidation problem. A single AI request touches
// getAISettingsForOrg several times, and this collapses those into one query.
const requestCache = new WeakMap<object, Promise<ResolvedAIKeys>>();

async function loadResolvedAIKeys(context: Context): Promise<ResolvedAIKeys> {
  const resolved = emptyResolvedKeys();

  // Fill in env fallbacks first so a failed DB read degrades to the previous
  // behaviour instead of disabling AI outright.
  for (const provider of AI_PROVIDERS) {
    const envKey = getEnvKey(provider);
    if (envKey) {
      resolved[provider] = { key: envKey, source: "env" };
    }
  }

  let credentials: Awaited<
    ReturnType<Context["models"]["aiCredentials"]["getAll"]>
  > = [];
  try {
    credentials = await context.models.aiCredentials.getAll();
  } catch (e) {
    logger.error(
      e,
      "aiCredentials: could not load org AI credentials; falling back to environment keys",
    );
    return resolved;
  }

  for (const credential of credentials) {
    let key = "";
    try {
      key = decryptAIKey(credential.encryptedKey);
    } catch (e) {
      logger.error(
        e,
        `aiCredentials: could not decrypt the ${credential.provider} key for organization ${credential.organization}`,
      );
      continue;
    }
    // decryptAIKey returns "" for anything it can't decrypt. Treat that as
    // "unusable" and keep the env fallback rather than handing an empty key to
    // the provider, which would surface as a confusing 401 from the vendor. In
    // practice this means ENCRYPTION_KEY changed without running
    // scripts/migrate-encryption-key.ts.
    if (!key) {
      logger.error(
        `aiCredentials: the stored ${credential.provider} key for organization ${credential.organization} could not be decrypted with the current ENCRYPTION_KEY`,
      );
      continue;
    }
    resolved[credential.provider] = { key, source: "organization" };
  }

  return resolved;
}

/**
 * Resolve every provider's API key for this org, org-stored key first and env
 * var second. Memoized per request.
 */
export function getResolvedAIKeys(context: Context): Promise<ResolvedAIKeys> {
  const cached = requestCache.get(context);
  if (cached) return cached;

  // Cache the promise, not the result, so concurrent callers within one request
  // share a single query instead of racing.
  const promise = loadResolvedAIKeys(context).catch((e) => {
    // Don't let a rejected promise stay cached for the rest of the request.
    requestCache.delete(context);
    throw e;
  });
  requestCache.set(context, promise);
  return promise;
}

/**
 * Drop the memoized keys for a context. Call after writing a credential so a
 * follow-up read in the same request sees the new value.
 */
export function clearResolvedAIKeysCache(context: Context): void {
  requestCache.delete(context);
}

/**
 * Error message for a provider with no usable key. Names the env var only when
 * the environment is actually a route to fixing it.
 */
export function missingAIKeyMessage(provider: AIProvider): string {
  const { label, envVar } = AI_PROVIDER_META[provider];
  return `No ${label} API key is configured. Add one under Settings → AI & Prompts, or set the ${envVar} environment variable.`;
}

// Each provider's cheapest "is this key valid" probe: list the models the key
// can see. No tokens are generated, so a verify costs nothing.
const VERIFY_ENDPOINTS: Record<
  AIProvider,
  { url: string; headers: (key: string) => Record<string, string> }
> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
  },
  google: {
    // The key goes in a header, not the documented `?key=` query param, so it
    // can't end up in a proxy or error log.
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (key) => ({ "x-goog-api-key": key }),
  },
  xai: {
    url: "https://api.x.ai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};

/**
 * Check a key against the provider before storing it, so a typo surfaces here
 * instead of days later inside an experiment analysis.
 *
 * Network or provider-side failures resolve to `valid: true` with a warning —
 * a flaky provider or an egress-restricted install must not block an admin from
 * saving a key we can't prove is bad.
 */
export async function verifyAIKey(
  provider: AIProvider,
  key: string,
): Promise<{ valid: boolean; message?: string }> {
  const { label } = AI_PROVIDER_META[provider];
  const { url, headers } = VERIFY_ENDPOINTS[provider];

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: headers(key),
      timeout: 10000,
    });
  } catch (e) {
    logger.warn(
      e,
      `aiCredentials: could not reach ${label} to verify the API key`,
    );
    return {
      valid: true,
      message: `Could not reach ${label} to verify this key, so it was saved unchecked.`,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      valid: false,
      message: `${label} rejected this API key. Double-check that you copied it correctly and that it is still active.`,
    };
  }

  if (!response.ok) {
    logger.warn(
      `aiCredentials: ${label} returned ${response.status} while verifying an API key`,
    );
    return {
      valid: true,
      message: `${label} returned an unexpected response (${response.status}), so the key was saved unchecked.`,
    };
  }

  return { valid: true };
}
