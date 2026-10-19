import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  IS_CLOUD: true,
}));
jest.mock("back-end/src/services/growthbook", () => ({
  ...jest.requireActual("back-end/src/services/growthbook"),
  trackAIUsage: jest.fn(),
}));
jest.mock("back-end/src/models/AITokenUsageModel", () => ({
  ...jest.requireActual("back-end/src/models/AITokenUsageModel"),
  updateTokenUsage: jest.fn(),
}));
jest.mock("back-end/src/services/licenseServerManagedClickhouse", () => ({
  logCloudAIUsage: jest.fn(),
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { trackAIUsage } from "back-end/src/services/growthbook";
import { updateTokenUsage } from "back-end/src/models/AITokenUsageModel";
import { logCloudAIUsage } from "back-end/src/services/licenseServerManagedClickhouse";
import { logger } from "back-end/src/util/logger";
import { usageRecorder } from "back-end/src/enterprise/services/ai";

const context = {
  org: { id: "org_1" },
  userId: "u_1",
} as unknown as ReqContext;

const recorder = (ownKey: boolean) =>
  usageRecorder({
    context,
    model: "claude-haiku-5-5",
    ownKey,
    type: "chat-autocomplete",
    isDefaultPrompt: true,
  });

// The mock factory's object is what the service reads; its flag can be
// flipped per test. (A namespace import is a read-only interop wrapper.)
const setCloud = (isCloud: boolean) =>
  Object.assign(jest.requireMock("back-end/src/util/secrets"), {
    IS_CLOUD: isCloud,
  });

beforeEach(() => {
  setCloud(true);
  jest.clearAllMocks();
});

describe("usageRecorder", () => {
  it("tracks, meters and logs a managed-key call on Cloud", async () => {
    await recorder(false)({
      usage: { inputTokens: 10, outputTokens: 5 },
      totalTokens: 15,
      spendUsd: 0.001,
      outcome: "success",
    });
    expect(trackAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        numPromptTokensUsed: 10,
        numCompletionTokensUsed: 5,
        usedOwnKey: false,
        outcome: "success",
      }),
    );
    expect(updateTokenUsage).toHaveBeenCalledWith({
      numTokensUsed: 15,
      organization: context.org,
    });
    expect(logCloudAIUsage).toHaveBeenCalledTimes(1);
  });

  it("does not meter an org's own key, but still tracks and logs", async () => {
    await recorder(true)({ totalTokens: 15, outcome: "success" });
    expect(updateTokenUsage).not.toHaveBeenCalled();
    expect(trackAIUsage).toHaveBeenCalledTimes(1);
    expect(logCloudAIUsage).toHaveBeenCalledTimes(1);
  });

  it("records a cancelled call with its lower-bound usage", async () => {
    await recorder(false)({
      usage: { inputTokens: 40 },
      totalTokens: 40,
      outcome: "aborted",
    });
    expect(trackAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "aborted", numPromptTokensUsed: 40 }),
    );
    expect(updateTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({ numTokensUsed: 40 }),
    );
  });

  it("logs a metering failure instead of throwing", async () => {
    jest
      .mocked(updateTokenUsage)
      .mockRejectedValueOnce(new Error("mongo down"));
    await expect(
      recorder(false)({ totalTokens: 15, outcome: "success" }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logCloudAIUsage).toHaveBeenCalledTimes(1);
  });

  it("only tracks on self-hosted", async () => {
    setCloud(false);
    await recorder(false)({ totalTokens: 15, outcome: "success" });
    expect(trackAIUsage).toHaveBeenCalledTimes(1);
    expect(updateTokenUsage).not.toHaveBeenCalled();
    expect(logCloudAIUsage).not.toHaveBeenCalled();
  });
});
