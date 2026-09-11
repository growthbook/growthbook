import { ReqContext } from "back-end/types/request";
import {
  buildSlackSettingsPreview,
  sendSlackSettingsTest,
  slackPreviewEventNames,
} from "back-end/src/services/slack/slackSettingsPreview";
import { getSlackOAuthIntegrationById } from "back-end/src/services/slackIntegration";
import {
  uploadSlackImageFile,
  postSlackMessageResult,
} from "back-end/src/services/slack/slackWebApi";
jest.mock("back-end/src/models/EventModel", () => ({
  getEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock("back-end/src/services/slackIntegration", () => ({
  getSlackOAuthIntegrationById: jest.fn(),
}));
jest.mock("back-end/src/util/slackToken", () => ({
  decryptSlackBotToken: jest.fn().mockReturnValue("test-token"),
}));
jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  uploadSlackImageFile: jest.fn(),
  postSlackMessageResult: jest.fn(),
}));
jest.mock("back-end/src/services/notificationCards/experimentCards", () => ({
  renderExperimentCard: jest.fn().mockResolvedValue(Buffer.from("png")),
}));
const context = {
  org: { id: "org_test" },
  permissions: {
    canManageIntegrations: () => true,
    throwPermissionError: () => {
      throw new Error("Forbidden");
    },
  },
  models: {
    slackWorkspaceConnections: {
      getByTeamId: jest
        .fn()
        .mockResolvedValue({ encryptedBotAccessToken: "encrypted" }),
    },
  },
} as unknown as ReqContext;
beforeEach(() => jest.clearAllMocks());
it.each(slackPreviewEventNames.filter((name) => !name.startsWith("digest:")))(
  "renders a real Slack message for sample %s",
  async (event) => {
    const preview = await buildSlackSettingsPreview(context, event, "none");
    expect(preview.message.text).toBeTruthy();
    expect(preview.png).toBeNull();
    expect(JSON.stringify(preview.message)).not.toContain("undefined");
  },
);
it("only uses an image for supported SRM cards", async () => {
  expect(
    (await buildSlackSettingsPreview(context, "experiment.warning", "compact"))
      .png,
  ).not.toBeNull();
  expect(
    (
      await buildSlackSettingsPreview(
        context,
        "experiment.info.significance",
        "compact",
      )
    ).png,
  ).toBeNull();
});
it("rejects preview requests without integration management permission", async () => {
  const denied = {
    ...context,
    permissions: { ...context.permissions, canManageIntegrations: () => false },
  } as ReqContext;
  await expect(
    buildSlackSettingsPreview(denied, "experiment.warning", "compact"),
  ).rejects.toThrow("Forbidden");
});
it("does not deliver to an absent or another organization's channel", async () => {
  jest.mocked(getSlackOAuthIntegrationById).mockResolvedValue(null);
  await expect(
    sendSlackSettingsTest(
      context,
      "other-channel",
      "experiment.warning",
      "compact",
    ),
  ).rejects.toThrow("Slack channel not found");
  expect(getSlackOAuthIntegrationById).toHaveBeenCalledWith({
    context,
    id: "other-channel",
  });
  expect(postSlackMessageResult).not.toHaveBeenCalled();
  expect(uploadSlackImageFile).not.toHaveBeenCalled();
});
it("falls back to the same text sample if the image upload fails", async () => {
  jest
    .mocked(getSlackOAuthIntegrationById)
    .mockResolvedValue({ slack: { teamId: "T1", channelId: "C1" } } as Awaited<
      ReturnType<typeof getSlackOAuthIntegrationById>
    >);
  jest.mocked(uploadSlackImageFile).mockResolvedValue(null);
  jest
    .mocked(postSlackMessageResult)
    .mockResolvedValue({ ok: true, ts: "1", error: null });
  expect(
    await sendSlackSettingsTest(
      context,
      "channel",
      "experiment.warning",
      "compact",
    ),
  ).toEqual({ delivery: "text" });
  expect(postSlackMessageResult).toHaveBeenCalledWith(
    expect.objectContaining({
      channel: "C1",
      text: expect.stringContaining("Test notification — sample data"),
    }),
  );
});

it.each(["digest:scorecard", "digest:feature"])(
  "renders an image for %s independently of individual card format",
  async (name) => {
    const preview = await buildSlackSettingsPreview(context, name, "none");
    expect(preview.png?.subarray(0, 8).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
    expect(preview.message.text).toContain("sample data");
  },
);
