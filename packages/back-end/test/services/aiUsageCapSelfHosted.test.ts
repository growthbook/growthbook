import { MockedFunction, vi } from "vitest";
// Companion to aiUsageCap.test.ts. IS_CLOUD is mocked per file, so the
// self-hosted half of the gate needs its own module instance.
vi.mock("back-end/src/util/secrets", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/util/secrets")>(
    "back-end/src/util/secrets",
  )),
  IS_CLOUD: false,
}));
vi.mock("back-end/src/services/organizations", () => ({
  getAISettingsForOrg: vi.fn(),
  getAllowedAIModel: vi.fn(),
}));
vi.mock("back-end/src/models/AITokenUsageModel", () => ({
  getTokensUsedByOrganization: vi.fn(),
  updateTokenUsage: vi.fn(),
}));

import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { getTokensUsedByOrganization } from "back-end/src/models/AITokenUsageModel";
import { ReqContext } from "back-end/types/request";
import {
  secondsUntilAICanBeUsedAgainForEmbeddings,
  secondsUntilAICanBeUsedAgainForModel,
  secondsUntilAICanBeUsedAgainForProvider,
} from "back-end/src/enterprise/services/ai";

const mockedSettings = getAISettingsForOrg as MockedFunction<
  typeof getAISettingsForOrg
>;
const mockedTokens = getTokensUsedByOrganization as MockedFunction<
  typeof getTokensUsedByOrganization
>;

const context = { org: { id: "org_1" } } as unknown as ReqContext;

describe("AI usage cap when self-hosted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedTokens.mockResolvedValue({
      numTokensUsed: 100,
      dailyLimit: 10,
      nextResetAt: Date.now() + 60_000,
    });
  });

  it("never rate limits, whatever the counter says", async () => {
    expect(await secondsUntilAICanBeUsedAgainForModel(context)).toBe(0);
    expect(await secondsUntilAICanBeUsedAgainForEmbeddings(context)).toBe(0);
    expect(
      await secondsUntilAICanBeUsedAgainForProvider(context, "openai"),
    ).toBe(0);
  });

  it("does not read settings or the counter", async () => {
    await secondsUntilAICanBeUsedAgainForModel(context, "gpt-4o-mini");

    expect(mockedSettings).not.toHaveBeenCalled();
    expect(mockedTokens).not.toHaveBeenCalled();
  });
});
