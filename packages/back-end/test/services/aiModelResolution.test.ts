import {
  AUTOCOMPLETE_AI_MODEL,
  CLOUD_MANAGED_AI_MODEL,
  CLOUD_MANAGED_VISUAL_EDITOR_AI_MODEL,
  SELF_HOSTED_DEFAULT_AI_MODELS,
} from "shared/ai";
import type { AIProvider } from "shared/ai";
import type { AIKeySource } from "back-end/src/services/aiCredentials";

// IS_CLOUD is captured at module load, so each case builds its own module
// instance with the flag already set.
type OrganizationsModule = typeof import("back-end/src/services/organizations");
type AISettingsContext = Parameters<
  OrganizationsModule["getAISettingsForOrg"]
>[0];

const loadModule = (isCloud: boolean, owned: AIProvider[]) => {
  let mod: OrganizationsModule | undefined;
  jest.isolateModules(() => {
    jest.doMock("back-end/src/util/secrets", () => ({
      ...jest.requireActual("back-end/src/util/secrets"),
      IS_CLOUD: isCloud,
    }));
    jest.doMock("back-end/src/services/aiCredentials", () => ({
      ...jest.requireActual("back-end/src/services/aiCredentials"),
      getResolvedAIKeys: jest.fn().mockResolvedValue(
        Object.fromEntries(
          (
            ["openai", "anthropic", "google", "xai", "mistral"] as AIProvider[]
          ).map((p) => [
            p,
            {
              key: owned.includes(p) ? "key" : "",
              source: owned.includes(p) ? "organization" : "none",
            },
          ]),
        ),
      ),
      canOrgChooseProviderModels: (
        source: Record<AIProvider, AIKeySource>,
        provider: AIProvider,
      ) => (isCloud ? source[provider] === "organization" : true),
    }));
    mod = jest.requireActual<OrganizationsModule>(
      "back-end/src/services/organizations",
    );
  });
  if (!mod) throw new Error("Could not load organizations module");
  return mod;
};

const makeContext = (settings: Record<string, unknown>): AISettingsContext =>
  ({
    org: { id: "org_1", settings: { aiEnabled: true, ...settings } },
  }) as unknown as AISettingsContext;

describe("getAISettingsForOrg model resolution", () => {
  it("keeps the Visual Editor on Sonnet when a Cloud org sets its own default", async () => {
    const mod = loadModule(true, ["anthropic"]);
    const settings = await mod.getAISettingsForOrg(
      makeContext({ defaultAIModel: "claude-sonnet-4-6" }),
    );

    expect(settings.defaultAIModel).toBe("claude-sonnet-4-6");
    expect(settings.visualEditorAIModel).toBe(
      CLOUD_MANAGED_VISUAL_EDITOR_AI_MODEL,
    );
  });

  it("still honors an explicit Visual Editor model", async () => {
    const mod = loadModule(true, ["anthropic"]);
    const settings = await mod.getAISettingsForOrg(
      makeContext({ visualEditorAIModel: "claude-opus-4-8" }),
    );

    expect(settings.visualEditorAIModel).toBe("claude-opus-4-8");
  });

  it("falls back to the managed model when a Cloud org sets no default", async () => {
    const mod = loadModule(true, []);
    const settings = await mod.getAISettingsForOrg(makeContext({}));

    expect(settings.defaultAIModel).toBe(CLOUD_MANAGED_AI_MODEL);
    expect(settings.visualEditorAIModel).toBe(
      CLOUD_MANAGED_VISUAL_EDITOR_AI_MODEL,
    );
  });

  it("ignores a Cloud model the org holds no key for", async () => {
    const mod = loadModule(true, ["anthropic"]);
    const settings = await mod.getAISettingsForOrg(
      makeContext({ defaultAIModel: "gpt-5.2" }),
    );

    expect(settings.defaultAIModel).toBe(CLOUD_MANAGED_AI_MODEL);
  });

  it("defaults self-hosted to a provider the org has a key for", async () => {
    const mod = loadModule(false, ["anthropic"]);
    const settings = await mod.getAISettingsForOrg(makeContext({}));

    const expected = SELF_HOSTED_DEFAULT_AI_MODELS.find(
      ([provider]) => provider === "anthropic",
    )?.[1];
    expect(settings.defaultAIModel).toBe(expected);
  });

  it("runs autocomplete on the cheap tier when an Anthropic key exists", async () => {
    expect(
      (
        await loadModule(true, ["anthropic"]).getAISettingsForOrg(
          makeContext({}),
        )
      ).autocompleteAIModel,
    ).toBe(AUTOCOMPLETE_AI_MODEL);
    expect(
      (
        await loadModule(false, ["openai"]).getAISettingsForOrg(
          makeContext({ defaultAIModel: "gpt-5.2" }),
        )
      ).autocompleteAIModel,
    ).toBe("gpt-5.2");
    expect(
      (
        await loadModule(false, ["anthropic"]).getAISettingsForOrg(
          makeContext({ aiAutocompleteModel: "claude-sonnet-4-6" }),
        )
      ).autocompleteAIModel,
    ).toBe("claude-sonnet-4-6");
  });

  it("follows the org default on self-hosted", async () => {
    const mod = loadModule(false, []);
    const settings = await mod.getAISettingsForOrg(
      makeContext({ defaultAIModel: "gpt-5.2" }),
    );

    expect(settings.defaultAIModel).toBe("gpt-5.2");
    expect(settings.visualEditorAIModel).toBe("gpt-5.2");
  });

  it("uses a custom model the org defines", async () => {
    const mod = loadModule(true, ["openai"]);
    const settings = await mod.getAISettingsForOrg(
      makeContext({
        defaultAIModel: "custom:openai:my-gpt",
        aiCustomModels: [
          {
            provider: "openai",
            id: "my-gpt",
            apiFormat: "chat",
            vision: false,
          },
        ],
      }),
    );

    expect(settings.defaultAIModel).toBe("custom:openai:my-gpt");
  });

  it("ignores a custom model that is no longer defined", async () => {
    const mod = loadModule(false, ["openai"]);
    const settings = await mod.getAISettingsForOrg(
      makeContext({ defaultAIModel: "custom:openai:gone", aiCustomModels: [] }),
    );

    expect(settings.defaultAIModel).toBe("gpt-5.4-mini");
  });

  it("ignores a Cloud custom model whose provider runs on the managed key", async () => {
    const mod = loadModule(true, ["anthropic"]);
    const settings = await mod.getAISettingsForOrg(
      makeContext({
        defaultAIModel: "custom:openai:my-gpt",
        aiCustomModels: [
          {
            provider: "openai",
            id: "my-gpt",
            apiFormat: "chat",
            vision: false,
          },
        ],
      }),
    );

    expect(settings.defaultAIModel).toBe(CLOUD_MANAGED_AI_MODEL);
  });
});
