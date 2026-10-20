import { AES, enc } from "crypto-js";
import { AIProvider, AI_PROVIDERS, AI_PROVIDER_META } from "shared/ai";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ANTHROPIC_API_KEY,
  ENCRYPTION_KEY,
  GEMINI_API_KEY,
  GOOGLE_AI_API_KEY,
  IS_CLOUD,
  MISTRAL_API_KEY,
  OPENAI_API_KEY,
  XAI_API_KEY,
} from "back-end/src/util/secrets";
import { fetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

type Context = ReqContext | ApiReqContext;

export type AIKeySource = "organization" | "env" | "none";

export type ResolvedAIKey = {
  key: string;
  source: AIKeySource;
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

const emptyResolvedKeys = (): ResolvedAIKeys =>
  AI_PROVIDERS.reduce((acc, provider) => {
    acc[provider] = { key: "", source: "none" };
    return acc;
  }, {} as ResolvedAIKeys);

// Share credential resolution across calls in the same request.
const requestCache = new WeakMap<object, Promise<ResolvedAIKeys>>();

async function loadResolvedAIKeys(context: Context): Promise<ResolvedAIKeys> {
  const resolved = emptyResolvedKeys();

  for (const provider of AI_PROVIDERS) {
    const envKey = getEnvKey(provider);
    if (envKey) {
      resolved[provider] = { key: envKey, source: "env" };
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

    resolved[credential.provider] = { key, source: "organization" };
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

// Only proven authentication failures reject a key.
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
