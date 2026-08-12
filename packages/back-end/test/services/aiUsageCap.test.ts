import { AIProvider } from "shared/ai";
import { AIKeySource } from "back-end/src/services/aiCredentials";

// The cap only exists on Cloud, so every case here is a Cloud case.
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  IS_CLOUD: true,
}));
jest.mock("back-end/src/services/organizations", () => {
  // Mirrors getAllowedAIModel's Cloud rule. requireActual on the real module
  // cycles through OrganizationModel, and the rule is one line.
  const { getProviderForAIModel } = jest.requireActual("shared/ai");
  return {
    getAISettingsForOrg: jest.fn(),
    getAllowedAIModel: (
      kind: "text" | "embedding" | "image",
      model: string | undefined,
      keySource: Record<string, string>,
    ) => {
      if (!model) return undefined;
      const provider = getProviderForAIModel(kind, model);
      return provider && keySource[provider] === "organization"
        ? model
        : undefined;
    },
  };
});
jest.mock("back-end/src/models/AITokenUsageModel", () => ({
  getTokensUsedByOrganization: jest.fn(),
  updateTokenUsage: jest.fn(),
}));

import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { getTokensUsedByOrganization } from "back-end/src/models/AITokenUsageModel";
import {
  secondsUntilAICanBeUsedAgainForEmbeddings,
  secondsUntilAICanBeUsedAgainForModel,
  secondsUntilAICanBeUsedAgainForProvider,
} from "back-end/src/enterprise/services/ai";

const mockedSettings = getAISettingsForOrg as jest.MockedFunction<
  typeof getAISettingsForOrg
>;
const mockedTokens = getTokensUsedByOrganization as jest.MockedFunction<
  typeof getTokensUsedByOrganization
>;

const keySources = (
  overrides: Partial<Record<AIProvider, AIKeySource>>,
): Record<AIProvider, AIKeySource> => ({
  openai: "none",
  anthropic: "none",
  xai: "none",
  mistral: "none",
  google: "none",
  ...overrides,
});

// Only the fields the cap helpers read. The full settings object is large and
// unrelated to the cap decision.
const setSettings = (settings: {
  keySource: Record<AIProvider, AIKeySource>;
  defaultAIModel?: string;
  embeddingModel?: string;
}) => {
  mockedSettings.mockResolvedValue({
    defaultAIModel: "gpt-4o-mini",
    embeddingModel: "text-embedding-ada-002",
    ...settings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
};

// Over the daily cap, resetting in one minute.
const setOverCap = () => {
  mockedTokens.mockResolvedValue({
    numTokensUsed: 100,
    dailyLimit: 10,
    nextResetAt: Date.now() + 60_000,
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const context = { org: { id: "org_1" } } as any;

describe("provider-exact AI usage cap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setOverCap();
  });

  it("exempts a model whose provider the org pays for itself", async () => {
    setSettings({ keySource: keySources({ anthropic: "organization" }) });

    expect(
      await secondsUntilAICanBeUsedAgainForModel(context, "claude-sonnet-4-6"),
    ).toBe(0);
  });

  it("still caps a managed-key provider when a different provider is org-owned", async () => {
    setSettings({ keySource: keySources({ anthropic: "organization" }) });

    // The org brought its own Anthropic key; this OpenAI model still runs on
    // GrowthBook's managed key, so it stays capped.
    expect(
      await secondsUntilAICanBeUsedAgainForModel(context, "gpt-4o-mini"),
    ).toBeGreaterThan(0);
  });

  it("caps a provider whose key came from the environment", async () => {
    setSettings({ keySource: keySources({ openai: "env" }) });

    expect(
      await secondsUntilAICanBeUsedAgainForModel(context, "gpt-4o-mini"),
    ).toBeGreaterThan(0);
  });

  it("falls back to the org default model when none is passed", async () => {
    setSettings({
      keySource: keySources({ google: "organization" }),
      defaultAIModel: "gemini-2.5-flash",
    });

    expect(await secondsUntilAICanBeUsedAgainForModel(context)).toBe(0);
  });

  it("meters an unrecognized model against the default it falls back to", async () => {
    setSettings({
      keySource: keySources({ anthropic: "organization" }),
      defaultAIModel: "gpt-4o-mini",
    });

    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await secondsUntilAICanBeUsedAgainForModel(context, "not-a-model" as any),
    ).toBeGreaterThan(0);
  });

  it("exempts a stale override that execution would drop for an org-owned default", async () => {
    // The OpenAI key is gone, so the call drops the GPT override and runs the
    // org's own Claude. Gating the stale GPT would 429 a request that never
    // touches a managed key.
    setSettings({
      keySource: keySources({ anthropic: "organization" }),
      defaultAIModel: "claude-sonnet-4-6",
    });

    expect(await secondsUntilAICanBeUsedAgainForModel(context, "gpt-5.2")).toBe(
      0,
    );
  });

  it("still meters an override the org does key when the default is managed", async () => {
    setSettings({
      keySource: keySources({ anthropic: "organization" }),
      defaultAIModel: "gpt-4o-mini",
    });

    expect(
      await secondsUntilAICanBeUsedAgainForModel(context, "claude-sonnet-4-6"),
    ).toBe(0);
  });

  it("uses the embedding model's own provider lookup", async () => {
    setSettings({
      keySource: keySources({ google: "organization" }),
      embeddingModel: "gemini-embedding-001",
    });

    expect(await secondsUntilAICanBeUsedAgainForEmbeddings(context)).toBe(0);
  });

  it("caps embeddings when their provider is not org-owned", async () => {
    setSettings({
      keySource: keySources({ google: "organization" }),
      embeddingModel: "text-embedding-ada-002",
    });

    expect(
      await secondsUntilAICanBeUsedAgainForEmbeddings(context),
    ).toBeGreaterThan(0);
  });

  it("meters when the provider cannot be determined", async () => {
    setSettings({ keySource: keySources({ openai: "organization" }) });

    expect(
      await secondsUntilAICanBeUsedAgainForProvider(context, undefined),
    ).toBeGreaterThan(0);
  });

  it("does not consult the cap counter for an exempt provider", async () => {
    setSettings({ keySource: keySources({ xai: "organization" }) });

    await secondsUntilAICanBeUsedAgainForProvider(context, "xai");

    expect(mockedTokens).not.toHaveBeenCalled();
  });
});
