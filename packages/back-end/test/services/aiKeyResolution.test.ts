import { AICredentialInterface } from "shared/validators";
import { AIProvider } from "shared/ai";

// Env vars are captured at module load in util/secrets, so they have to be set
// before the module graph is required. Each test builds its own module instance
// via jest.isolateModules to get a clean env AND a clean per-request cache.
type AICredentialsModule = typeof import("back-end/src/services/aiCredentials");
type AIKeyContext = Parameters<AICredentialsModule["getResolvedAIKeys"]>[0];

const loadModule = (env: Record<string, string>): AICredentialsModule => {
  let mod: AICredentialsModule | undefined;
  jest.isolateModules(() => {
    const previous = { ...process.env };
    Object.assign(process.env, env);
    mod = jest.requireActual<AICredentialsModule>(
      "back-end/src/services/aiCredentials",
    );
    process.env = previous;
  });
  if (!mod) throw new Error("Could not load aiCredentials module");
  return mod;
};

const credential = (
  provider: AIProvider,
  encryptedKey: string,
  last4: string,
): AICredentialInterface => ({
  organization: "org_1",
  provider,
  encryptedKey,
  last4,
  updatedByEmail: "admin@example.com",
  dateCreated: new Date(),
  dateUpdated: new Date(),
});

// Minimal stand-in for ReqContext. getResolvedAIKeys only touches
// aiCredentials.getAll() and hasPremiumFeature(), and the WeakMap cache keys off
// object identity, so a plain object is a faithful stub. BYOK defaults to
// allowed so the precedence tests stay about precedence.
const makeContext = (
  credentials: AICredentialInterface[],
  { canUseOwnKeys = true }: { canUseOwnKeys?: boolean } = {},
) => {
  const getAll = jest.fn().mockResolvedValue(credentials);
  const hasPremiumFeature = jest.fn().mockReturnValue(canUseOwnKeys);
  return {
    context: {
      models: { aiCredentials: { getAll } },
      hasPremiumFeature,
    } as unknown as AIKeyContext,
    getAll,
    hasPremiumFeature,
  };
};

const resolve = (mod: AICredentialsModule, context: AIKeyContext) =>
  mod.getResolvedAIKeys(context);

describe("getResolvedAIKeys", () => {
  it("prefers an org-stored key over the environment variable on Cloud", async () => {
    // Cloud's managed keys are env vars, so BYOK only means anything if a
    // stored key outranks them.
    const mod = loadModule({
      ANTHROPIC_API_KEY: "env-anthropic",
      IS_CLOUD: "true",
    });
    const { context } = makeContext([
      credential("anthropic", mod.encryptAIKey("org-anthropic"), "opic"),
    ]);

    const keys = await resolve(mod, context);

    expect(keys.anthropic).toEqual({
      key: "org-anthropic",
      source: "organization",
    });
  });

  it("prefers the environment variable over a stored key when self-hosted", async () => {
    // Self-hosted, the env var is the deployment's own configuration and the
    // settings UI won't offer to override it, so a stored key for the same
    // provider is a leftover and must not take effect.
    const mod = loadModule({ ANTHROPIC_API_KEY: "env-anthropic" });
    const { context } = makeContext([
      credential("anthropic", mod.encryptAIKey("org-anthropic"), "opic"),
    ]);

    const keys = await resolve(mod, context);

    expect(keys.anthropic).toEqual({ key: "env-anthropic", source: "env" });
  });

  it("uses a stored key self-hosted when no env var is set", async () => {
    const mod = loadModule({});
    const { context } = makeContext([
      credential("anthropic", mod.encryptAIKey("org-anthropic"), "opic"),
    ]);

    const keys = await resolve(mod, context);

    expect(keys.anthropic).toEqual({
      key: "org-anthropic",
      source: "organization",
    });
  });

  it("falls back to the environment variable when nothing is stored", async () => {
    const mod = loadModule({ OPENAI_API_KEY: "env-openai" });
    const { context } = makeContext([]);

    const keys = await resolve(mod, context);

    expect(keys.openai).toEqual({ key: "env-openai", source: "env" });
  });

  it("reports no key when neither source has one", async () => {
    const mod = loadModule({});
    const { context } = makeContext([]);

    const keys = await resolve(mod, context);

    expect(keys.mistral).toEqual({ key: "", source: "none" });
  });

  it("resolves each provider independently", async () => {
    const mod = loadModule({ OPENAI_API_KEY: "env-openai" });
    const { context } = makeContext([
      credential("google", mod.encryptAIKey("org-google"), "ogle"),
    ]);

    const keys = await resolve(mod, context);

    expect(keys.google.source).toBe("organization");
    expect(keys.openai.source).toBe("env");
    expect(keys.xai.source).toBe("none");
  });

  it("keeps the env fallback when a stored key cannot be decrypted", async () => {
    // ENCRYPTION_KEY changed without running the migration script, so the
    // stored ciphertext decrypts to "". Handing an empty key to the provider
    // would surface as an opaque 401, so the env key must survive instead.
    const mod = loadModule({ ANTHROPIC_API_KEY: "env-anthropic" });
    const { context } = makeContext([
      credential("anthropic", "garbage-not-decryptable", "1234"),
    ]);

    const keys = await resolve(mod, context);

    expect(keys.anthropic).toEqual({ key: "env-anthropic", source: "env" });
  });

  it("rejects decrypted text that does not match the stored fingerprint", async () => {
    const mod = loadModule({ ANTHROPIC_API_KEY: "env-anthropic" });
    const { context } = makeContext([
      credential("anthropic", mod.encryptAIKey("wrong-plaintext"), "real"),
    ]);

    expect((await resolve(mod, context)).anthropic).toEqual({
      key: "env-anthropic",
      source: "env",
    });
  });

  it("falls back to env keys when the credential query fails", async () => {
    const mod = loadModule({ OPENAI_API_KEY: "env-openai" });
    const getAll = jest.fn().mockRejectedValue(new Error("mongo is down"));
    const context = {
      models: { aiCredentials: { getAll } },
      hasPremiumFeature: () => true,
    } as unknown as AIKeyContext;

    const keys = await resolve(mod, context);

    expect(keys.openai).toEqual({ key: "env-openai", source: "env" });
  });

  it("queries once per request no matter how many callers ask", async () => {
    const mod = loadModule({});
    const { context, getAll } = makeContext([]);

    await Promise.all([
      resolve(mod, context),
      resolve(mod, context),
      resolve(mod, context),
    ]);
    await resolve(mod, context);

    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it("does not share cached keys between two contexts", async () => {
    const mod = loadModule({});
    const first = makeContext([
      credential("openai", mod.encryptAIKey("first-org-key"), "-key"),
    ]);
    const second = makeContext([
      credential("openai", mod.encryptAIKey("second-org-key"), "-key"),
    ]);

    expect((await resolve(mod, first.context)).openai.key).toBe(
      "first-org-key",
    );
    expect((await resolve(mod, second.context)).openai.key).toBe(
      "second-org-key",
    );
  });

  it("re-reads after the cache is cleared", async () => {
    const mod = loadModule({});
    const { context, getAll } = makeContext([]);

    await resolve(mod, context);
    mod.clearResolvedAIKeysCache(context);
    await resolve(mod, context);

    expect(getAll).toHaveBeenCalledTimes(2);
  });

  it("treats GOOGLE_AI_API_KEY as preferred over the legacy GEMINI_API_KEY", async () => {
    const mod = loadModule({
      GOOGLE_AI_API_KEY: "preferred",
      GEMINI_API_KEY: "legacy",
    });
    const { context } = makeContext([]);

    expect((await resolve(mod, context)).google.key).toBe("preferred");
  });

  it("still accepts the legacy GEMINI_API_KEY on its own", async () => {
    const mod = loadModule({ GEMINI_API_KEY: "legacy" });
    const { context } = makeContext([]);

    expect((await resolve(mod, context)).google).toEqual({
      key: "legacy",
      source: "env",
    });
  });

  it("ignores a stored key when the plan does not include BYOK", async () => {
    const mod = loadModule({ IS_CLOUD: "true" });
    const { context, hasPremiumFeature } = makeContext(
      [credential("anthropic", mod.encryptAIKey("org-anthropic"), "opic")],
      { canUseOwnKeys: false },
    );

    const keys = await resolve(mod, context);

    expect(hasPremiumFeature).toHaveBeenCalledWith("ai-byok");
    expect(keys.anthropic).toEqual({ key: "", source: "none" });
  });

  it("falls back to the managed key when the plan does not include BYOK", async () => {
    // Downgrade on Cloud: still works on the managed key, and because the
    // source is no longer "organization" it is metered and capped again.
    const mod = loadModule({
      ANTHROPIC_API_KEY: "env-anthropic",
      IS_CLOUD: "true",
    });
    const { context } = makeContext(
      [credential("anthropic", mod.encryptAIKey("org-anthropic"), "opic")],
      { canUseOwnKeys: false },
    );

    expect((await resolve(mod, context)).anthropic).toEqual({
      key: "env-anthropic",
      source: "env",
    });
  });

  it("does not query for credentials at all when the plan does not include BYOK", async () => {
    const mod = loadModule({});
    const { context, getAll } = makeContext([], { canUseOwnKeys: false });

    await resolve(mod, context);

    expect(getAll).not.toHaveBeenCalled();
  });
});
