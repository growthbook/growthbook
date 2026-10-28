import { AES, enc } from "crypto-js";
import { AIProvider, AI_PROVIDERS, AI_PROVIDER_META } from "shared/ai";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ANTHROPIC_API_KEY,
  ANTHROPIC_BASE_URL,
  ENCRYPTION_KEY,
  GEMINI_API_KEY,
  GOOGLE_AI_API_KEY,
  GOOGLE_AI_BASE_URL,
  IS_CLOUD,
  MISTRAL_API_KEY,
  MISTRAL_BASE_URL,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  XAI_API_KEY,
  XAI_BASE_URL,
} from "back-end/src/util/secrets";
import { fetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import {
  getAIEndpointFetch,
  normalizeAIBaseUrl,
} from "back-end/src/services/aiEndpoint";

type Context = ReqContext | ApiReqContext;

export type AIKeySource = "organization" | "env" | "none";

export type ResolvedAIKey = {
  key: string;
  source: AIKeySource;
  // "" means the provider's own API.
  baseUrl: string;
};

export type ResolvedAIKeys = Record<AIProvider, ResolvedAIKey>;

export function encryptAIKey(plaintext: string): string {
  return AES.encrypt(plaintext, ENCRYPTION_KEY).toString();
}

// crypto-js may return "" or throw when given the wrong key.
export function decryptAIKey(ciphertext: string): string {
  try {
    return AES.decrypt(ciphertext, ENCRYPTION_KEY).toString(enc.Utf8);
  } catch {
    return "";
  }
}

export function getKeyLast4(plaintext: string): string {
  return plaintext.length >= 8 ? plaintext.slice(-4) : "";
}

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

function getEnvBaseUrl(provider: AIProvider): string {
  const raw = {
    openai: OPENAI_BASE_URL,
    anthropic: ANTHROPIC_BASE_URL,
    xai: XAI_BASE_URL,
    mistral: MISTRAL_BASE_URL,
    google: GOOGLE_AI_BASE_URL,
  }[provider];
  if (!raw) return "";
  const { baseUrl, error } = normalizeAIBaseUrl(raw, { cloud: false });
  if (error !== undefined) {
    logger.error(
      `aiCredentials: ignoring ${AI_PROVIDER_META[provider].baseUrlEnvVar}: ${error}`,
    );
    return "";
  }
  return baseUrl;
}

const emptyResolvedKeys = (): ResolvedAIKeys =>
  AI_PROVIDERS.reduce((acc, provider) => {
    acc[provider] = { key: "", source: "none", baseUrl: "" };
    return acc;
  }, {} as ResolvedAIKeys);

// Share credential resolution across calls in the same request.
const requestCache = new WeakMap<object, Promise<ResolvedAIKeys>>();

async function loadResolvedAIKeys(context: Context): Promise<ResolvedAIKeys> {
  const resolved = emptyResolvedKeys();

  for (const provider of AI_PROVIDERS) {
    const envKey = getEnvKey(provider);
    if (envKey) {
      resolved[provider] = {
        key: envKey,
        source: "env",
        // Cloud's env keys are GrowthBook's own and always use the provider's API.
        baseUrl: IS_CLOUD ? "" : getEnvBaseUrl(provider),
      };
    }
  }

  if (!context.hasPremiumFeature("ai-byok")) {
    return resolved;
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
    const key = decryptAIKey(credential.encryptedKey);
    if (!key || getKeyLast4(key) !== credential.last4) {
      logger.error(
        `aiCredentials: the stored ${credential.provider} key for organization ${credential.organization} could not be decrypted with the current ENCRYPTION_KEY`,
      );
      continue;
    }
    // Stored keys override managed Cloud keys, but not self-hosted env keys.
    if (!IS_CLOUD && resolved[credential.provider].source === "env") {
      continue;
    }

    resolved[credential.provider] = {
      key,
      source: "organization",
      // Self-hosted: a stored key without its own base URL follows the env var.
      baseUrl:
        credential.baseUrl ||
        (IS_CLOUD ? "" : getEnvBaseUrl(credential.provider)),
    };
  }

  return resolved;
}

export function getResolvedAIKeys(context: Context): Promise<ResolvedAIKeys> {
  const cached = requestCache.get(context);
  if (cached) return cached;

  const promise = loadResolvedAIKeys(context).catch((e) => {
    requestCache.delete(context);
    throw e;
  });
  requestCache.set(context, promise);
  return promise;
}

export function clearResolvedAIKeysCache(context: Context): void {
  requestCache.delete(context);
}

export function canOrgChooseProviderModels(
  keySource: Record<AIProvider, AIKeySource>,
  provider: AIProvider,
): boolean {
  if (!IS_CLOUD) return true;
  return keySource[provider] === "organization";
}

export function missingAIKeyMessage(provider: AIProvider): string {
  const { label, envVar } = AI_PROVIDER_META[provider];
  return `No ${label} API key is configured. Add one under Settings → AI & Prompts, or set the ${envVar} environment variable.`;
}

// Each path is appended to the provider's base URL.
const VERIFY_ENDPOINTS: Record<
  AIProvider,
  { path: string; headers: (key: string) => Record<string, string> }
> = {
  openai: {
    path: "/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    path: "/models",
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
  },
  google: {
    // The key goes in a header, not the documented `?key=` query param, so it
    // can't end up in a proxy or error log.
    path: "/models",
    headers: (key) => ({ "x-goog-api-key": key }),
  },
  xai: {
    path: "/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  mistral: {
    path: "/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};

// Only proven authentication failures reject a key.
export async function verifyAIKey(
  provider: AIProvider,
  key: string,
  baseUrl: string = "",
): Promise<{ valid: boolean; message?: string }> {
  const { label: providerLabel, defaultBaseUrl } = AI_PROVIDER_META[provider];
  const label = baseUrl ? `${providerLabel} endpoint` : providerLabel;
  const { path, headers } = VERIFY_ENDPOINTS[provider];
  const url = `${baseUrl || defaultBaseUrl}${path}`;

  let status: number;
  let ok: boolean;
  try {
    const guardedFetch = getAIEndpointFetch(baseUrl);
    if (guardedFetch) {
      const res = await guardedFetch(url, {
        method: "GET",
        headers: headers(key),
        signal: AbortSignal.timeout(10000),
      });
      ({ status, ok } = res);
    } else {
      const res = await fetch(url, {
        method: "GET",
        headers: headers(key),
        timeout: 10000,
      });
      ({ status, ok } = res);
    }
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

  if (status === 401 || status === 403) {
    return {
      valid: false,
      message: `${label} rejected this API key. Double-check that you copied it correctly and that it is still active.`,
    };
  }

  if (!ok) {
    logger.warn(
      `aiCredentials: ${label} returned ${status} while verifying an API key`,
    );
    return {
      valid: true,
      message: `${label} returned an unexpected response (${status}), so the key was saved unchecked.`,
    };
  }

  // Many gateways answer this check without looking at the key.
  if (baseUrl) {
    return {
      valid: true,
      message:
        "Saved, but keys sent through a custom endpoint can't be fully verified. Try an AI feature to confirm it works.",
    };
  }

  return { valid: true };
}
