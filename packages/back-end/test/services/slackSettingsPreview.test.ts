import { previewNotificationEventNames } from "shared/notifications";
import { sendEventWebhook } from "back-end/src/events/handlers/webhooks/sendEventWebhook";
import { renderNotificationCard } from "back-end/src/services/notificationCards/renderNotificationCard";
import { ReqContext } from "back-end/types/request";
import {
  buildSlackSettingsPreview,
  sendSlackSettingsTest,
} from "back-end/src/services/slack/slackSettingsPreview";
import { getEventWebHookById } from "back-end/src/models/EventWebhookModel";
import {
  uploadSlackImageFile,
  postSlackMessageResult,
} from "back-end/src/services/slack/slackWebApi";
jest.mock("back-end/src/events/handlers/webhooks/sendEventWebhook", () => ({
  sendEventWebhook: jest.fn(),
}));
jest.mock("back-end/src/models/EventModel", () => ({
  getEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock("back-end/src/models/EventWebhookModel", () => ({
  getEventWebHookById: jest.fn(),
}));
jest.mock("back-end/src/util/slackToken", () => ({
  decryptSlackBotToken: jest.fn().mockReturnValue("test-token"),
}));
jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  ...jest.requireActual("back-end/src/services/slack/slackWebApi"),
  uploadSlackImageFile: jest.fn(),
  postSlackMessageResult: jest.fn(),
}));
jest.mock(
  "back-end/src/services/notificationCards/renderNotificationCard",
  () => ({
    renderNotificationCard: jest.fn().mockImplementation(async (event) =>
      event.event === "experiment.warning"
        ? {
            png: Buffer.from("png"),
            objectUrl: "https://example.com/experiment",
            objectName: "Test",
            altText: "Warning",
          }
        : null,
    ),
  }),
);
const context = {
  org: { id: "org_test" },
  permissions: {
    canManageIntegrations: () => true,
    throwPermissionError: () => {
      throw new Error("Forbidden");
    },
  },
  models: {
    webhookSecrets: {
      getBackEndSecretsReplacer: jest.fn().mockResolvedValue({}),
    },
    slackWorkspaceConnections: {
      getByTeamId: jest
        .fn()
        .mockResolvedValue({ encryptedBotAccessToken: "encrypted" }),
    },
  },
} as unknown as ReqContext;
beforeEach(() => jest.clearAllMocks());
it.each(previewNotificationEventNames)(
  "renders a real Slack message for sample %s",
  async (event) => {
    const preview = await buildSlackSettingsPreview(context, event, {
      type: "text",
    });
    expect(preview.message.text).toBeTruthy();
    expect(preview.card?.png).toBeUndefined();
    expect(JSON.stringify(preview.message)).not.toContain("undefined");
  },
);
it("uses the production renderer to decide which events have images", async () => {
  expect(
    (
      await buildSlackSettingsPreview(context, "experiment.warning", {
        type: "image",
        cardFormat: "light",
      })
    ).card?.png,
  ).not.toBeUndefined();
  expect(
    (
      await buildSlackSettingsPreview(context, "experiment.info.significance", {
        type: "image",
        cardFormat: "light",
      })
    ).card?.png,
  ).toBeUndefined();
});
it("rejects preview requests without integration management permission", async () => {
  const denied = {
    ...context,
    permissions: { ...context.permissions, canManageIntegrations: () => false },
  } as ReqContext;
  await expect(
    buildSlackSettingsPreview(denied, "experiment.warning", {
      type: "image",
      cardFormat: "light",
    }),
  ).rejects.toThrow("Forbidden");
});
it("does not deliver to an absent or another organization's channel", async () => {
  jest.mocked(getEventWebHookById).mockResolvedValue(null);
  await expect(
    sendSlackSettingsTest(context, "other-channel", "experiment.warning", {
      type: "image",
      cardFormat: "light",
    }),
  ).rejects.toThrow("Slack channel not found");
  expect(getEventWebHookById).toHaveBeenCalledWith(
    "other-channel",
    context.org.id,
  );
  expect(postSlackMessageResult).not.toHaveBeenCalled();
  expect(uploadSlackImageFile).not.toHaveBeenCalled();
});
it("falls back to the same text sample if the image upload fails", async () => {
  jest.mocked(getEventWebHookById).mockResolvedValue({
    payloadType: "slack",
    url: "https://slack.com",
    slack: { teamId: "T1", channelId: "C1" },
  } as Awaited<ReturnType<typeof getEventWebHookById>>);
  jest.mocked(uploadSlackImageFile).mockResolvedValue(null);
  jest
    .mocked(postSlackMessageResult)
    .mockResolvedValue({ ok: true, ts: "1", error: null });
  expect(
    await sendSlackSettingsTest(context, "channel", "experiment.warning", {
      type: "image",
      cardFormat: "light",
    }),
  ).toEqual({ deliveredAs: "text" });
  expect(postSlackMessageResult).toHaveBeenCalledWith(
    expect.objectContaining({
      channel: "C1",
      text: expect.stringContaining("Test notification — sample data"),
    }),
  );
});

it.each(["digest:scorecard", "digest:feature"])(
  "rejects the removed digest preview %s",
  async (name) => {
    expect(previewNotificationEventNames).not.toContain(name);
    await expect(
      buildSlackSettingsPreview(context, name, { type: "text" }),
    ).rejects.toThrow("Unsupported test event");
  },
);

it("picks up new image producers without a preview-specific event gate", async () => {
  const card = {
    png: Buffer.from("png"),
    objectUrl: "https://example.com/experiment",
    objectName: "Test",
    altText: "Significance",
  };
  jest.mocked(renderNotificationCard).mockResolvedValueOnce(card);
  expect(
    (
      await buildSlackSettingsPreview(context, "experiment.info.significance", {
        type: "image",
        cardFormat: "dark",
      })
    ).card,
  ).toBe(card);
  expect(renderNotificationCard).toHaveBeenLastCalledWith(
    expect.objectContaining({ event: "experiment.info.significance" }),
    "dark",
  );
});
it("test sends preserve the incoming webhook transport used in production", async () => {
  const url = "https://hooks.slack.com/services/test";
  jest.mocked(getEventWebHookById).mockResolvedValue({
    payloadType: "slack",
    url,
    slack: { teamId: "T1", channelId: "C1" },
  } as Awaited<ReturnType<typeof getEventWebHookById>>);
  jest.mocked(sendEventWebhook).mockResolvedValue({
    result: "success",
    statusCode: 200,
    responseBody: "ok",
  });
  expect(
    await sendSlackSettingsTest(context, "channel", "experiment.warning", {
      type: "image",
      cardFormat: "light",
    }),
  ).toEqual({ deliveredAs: "text" });
  expect(sendEventWebhook).toHaveBeenCalledWith(
    expect.objectContaining({
      eventWebHook: expect.objectContaining({ url }),
      method: "POST",
      payload: expect.objectContaining({
        text: expect.stringContaining("Test notification — sample data"),
      }),
    }),
  );
  expect(postSlackMessageResult).not.toHaveBeenCalled();
  expect(uploadSlackImageFile).not.toHaveBeenCalled();
  expect(
    context.models.slackWorkspaceConnections.getByTeamId,
  ).not.toHaveBeenCalled();
});
it("test sends share the production image delivery path", async () => {
  jest.mocked(getEventWebHookById).mockResolvedValue({
    payloadType: "slack",
    url: "https://slack.com",
    slack: { teamId: "T1", channelId: "C1" },
  } as Awaited<ReturnType<typeof getEventWebHookById>>);
  jest.mocked(uploadSlackImageFile).mockResolvedValue("file-1");
  expect(
    await sendSlackSettingsTest(context, "channel", "experiment.warning", {
      type: "image",
      cardFormat: "light",
    }),
  ).toEqual({ deliveredAs: "card" });
  // The test prefix rides above the footer in the share message's blocks.
  expect(uploadSlackImageFile).toHaveBeenCalledWith(
    expect.objectContaining({
      channelId: "C1",
      blocks: [
        expect.objectContaining({
          text: expect.objectContaining({
            text: expect.stringContaining("Test notification — sample data"),
          }),
        }),
        expect.objectContaining({ type: "context" }),
      ],
      initialComment: expect.stringContaining(
        "Test notification — sample data",
      ),
    }),
  );
  expect(postSlackMessageResult).not.toHaveBeenCalled();
});

it("checks permissions before looking up a test destination", async () => {
  const denied = {
    ...context,
    permissions: { ...context.permissions, canManageIntegrations: () => false },
  } as ReqContext;
  await expect(
    sendSlackSettingsTest(denied, "channel", "experiment.warning", {
      type: "text",
    }),
  ).rejects.toThrow("Forbidden");
  expect(getEventWebHookById).not.toHaveBeenCalled();
});

it("previews sample data without sending it", async () => {
  await buildSlackSettingsPreview(context, "experiment.warning", {
    type: "image",
    cardFormat: "light",
  });
  expect(getEventWebHookById).not.toHaveBeenCalled();
  expect(sendEventWebhook).not.toHaveBeenCalled();
  expect(postSlackMessageResult).not.toHaveBeenCalled();
  expect(uploadSlackImageFile).not.toHaveBeenCalled();
});

it("sends text settings without rendering an image", async () => {
  jest.mocked(getEventWebHookById).mockResolvedValue({
    payloadType: "slack",
    url: "https://slack.com",
    slack: { teamId: "T1", channelId: "C1" },
  } as Awaited<ReturnType<typeof getEventWebHookById>>);
  jest
    .mocked(postSlackMessageResult)
    .mockResolvedValue({ ok: true, ts: "1", error: null });
  await expect(
    sendSlackSettingsTest(context, "channel", "experiment.warning", {
      type: "text",
    }),
  ).resolves.toEqual({ deliveredAs: "text" });
  expect(renderNotificationCard).not.toHaveBeenCalled();
  expect(uploadSlackImageFile).not.toHaveBeenCalled();
});
