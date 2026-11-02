import { AI_PROVIDER_META, AI_PROVIDERS } from "shared/ai";

type AICredentialsModule = typeof import("back-end/src/services/aiCredentials");

const AI_ENV_VARS = [
  ...AI_PROVIDERS.map((provider) => AI_PROVIDER_META[provider].baseUrlEnvVar),
  "AI_CUSTOM_MODELS",
  "IS_CLOUD",
];

const mockFetch = jest.fn();

// Env vars are captured at module load in util/secrets.
const loadModule = (env: Record<string, string>): AICredentialsModule => {
  let mod: AICredentialsModule | undefined;
  jest.isolateModules(() => {
    jest.doMock("back-end/src/util/http.util", () => ({
      ...jest.requireActual("back-end/src/util/http.util"),
      fetch: mockFetch,
    }));
    const previous = { ...process.env };
    AI_ENV_VARS.forEach((name) => delete process.env[name]);
    Object.assign(process.env, env);
    try {
      mod = jest.requireActual<AICredentialsModule>(
        "back-end/src/services/aiCredentials",
      );
    } finally {
      process.env = previous;
    }
  });
  if (!mod) throw new Error("Could not load aiCredentials module");
  return mod;
};

const respond = (status: number) =>
  mockFetch.mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
  });

const GATEWAY = "https://gateway.example.com/v1";

describe("AI endpoint env vars", () => {
  beforeEach(() => mockFetch.mockReset());

  it("uses a provider's base URL when self-hosted", () => {
    const mod = loadModule({ OPENAI_BASE_URL: `${GATEWAY}/` });
    expect(mod.getEnvBaseUrl("openai")).toBe(GATEWAY);
    expect(mod.getAIClientOptions("openai", "sk")).toEqual({
      apiKey: "sk",
      baseURL: GATEWAY,
    });
    expect(mod.getAIClientOptions("anthropic", "sk")).toEqual({ apiKey: "sk" });
  });

  it("ignores base URLs and custom models on Cloud", () => {
    const mod = loadModule({
      IS_CLOUD: "true",
      OPENAI_BASE_URL: GATEWAY,
      AI_CUSTOM_MODELS: '[{"provider":"anthropic","id":"my-claude"}]',
    });
    expect(mod.getEnvBaseUrl("openai")).toBe("");
    expect(mod.getEnvCustomModels()).toEqual([]);
  });

  it("ignores a base URL that isn't http(s)", () => {
    const mod = loadModule({ OPENAI_BASE_URL: "ftp://gateway.example.com" });
    expect(mod.getEnvBaseUrl("openai")).toBe("");
  });

  it("parses custom models", () => {
    const mod = loadModule({
      AI_CUSTOM_MODELS: JSON.stringify([
        { provider: "openai", id: "qwen/qwen3", apiFormat: "chat" },
        { provider: "anthropic", id: "my-claude", vision: true },
      ]),
    });
    expect(mod.getEnvCustomModels()).toEqual([
      { provider: "openai", id: "qwen/qwen3", apiFormat: "chat" },
      { provider: "anthropic", id: "my-claude", vision: true },
    ]);
  });

  it.each([
    ["invalid JSON", "[{"],
    [
      "an OpenAI model without an API format",
      '[{"provider":"openai","id":"x"}]',
    ],
    ["an unknown provider", '[{"provider":"acme","id":"x"}]'],
  ])("ignores custom models with %s", (_, value) => {
    const mod = loadModule({ AI_CUSTOM_MODELS: value });
    expect(mod.getEnvCustomModels()).toEqual([]);
  });
});

describe("verifyAIKey", () => {
  beforeEach(() => mockFetch.mockReset());

  it("accepts a key the provider's own API confirms, with no warning", async () => {
    respond(200);
    const mod = loadModule({});
    expect(await mod.verifyAIKey("openai", "sk-test")).toEqual({
      valid: true,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.anything(),
    );
  });

  it("checks against the base URL and warns it can't fully verify", async () => {
    respond(200);
    const mod = loadModule({ OPENAI_BASE_URL: GATEWAY });
    const result = await mod.verifyAIKey("openai", "sk-test");
    expect(mockFetch).toHaveBeenCalledWith(
      `${GATEWAY}/models`,
      expect.anything(),
    );
    expect(result.valid).toBe(true);
    expect(result.message).toMatch(/can't be fully verified/);
  });

  it("still rejects a key the gateway refuses", async () => {
    respond(401);
    const mod = loadModule({ OPENAI_BASE_URL: GATEWAY });
    expect((await mod.verifyAIKey("openai", "sk-test")).valid).toBe(false);
  });
});
