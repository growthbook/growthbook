// Companion to aiUsageCap.test.ts. IS_CLOUD is mocked per file, so the
// self-hosted half of the gate needs its own module instance.
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  IS_CLOUD: false,
}));
jest.mock("back-end/src/services/organizations", () => ({
  getAISettingsForOrg: jest.fn(),
  getAllowedAIModel: jest.fn(),
}));
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const context = { org: { id: "org_1" } } as any;

describe("AI usage cap when self-hosted", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Well over any limit — self-hosted should not look at this at all.
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
