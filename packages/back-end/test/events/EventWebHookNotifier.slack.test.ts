import type { NotificationSettings } from "shared/validators";
import { EventWebHookNotifier } from "back-end/src/events/handlers/webhooks/EventWebHookNotifier";
import { getEvent } from "back-end/src/models/EventModel";
import {
  getEventWebHookById,
  updateEventWebHookStatus,
} from "back-end/src/models/EventWebhookModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { createEventWebHookLog } from "back-end/src/models/EventWebHookLogModel";
import { getSlackMessageForNotificationEvent } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import {
  postSlackMessageResult,
  SLACK_WORKSPACE_PLACEHOLDER_URL,
  uploadSlackImageFile,
} from "back-end/src/services/slack/slackWebApi";
import { renderNotificationCard } from "back-end/src/services/notificationCards/renderNotificationCard";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { cancellableFetch } from "back-end/src/util/http.util";
import { getEventWebHookSignatureForPayload } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import { secretsReplacer } from "back-end/src/util/secrets";

jest.mock("back-end/src/models/EventModel", () => ({
  getEvent: jest.fn(),
}));

jest.mock("back-end/src/models/EventWebhookModel", () => ({
  getEventWebHookById: jest.fn(),
  updateEventWebHookStatus: jest.fn(),
}));

jest.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationById: jest.fn(),
}));

jest.mock("back-end/src/models/EventWebHookLogModel", () => ({
  createEventWebHookLog: jest.fn(),
}));

jest.mock(
  "back-end/src/events/handlers/slack/slack-event-handler-utils",
  () => ({
    getSlackMessageForLegacyNotificationEvent: jest.fn(),
    getSlackMessageForNotificationEvent: jest.fn(),
  }),
);

jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  ...jest.requireActual("back-end/src/services/slack/slackWebApi"),
  postSlackMessageResult: jest.fn(),
  uploadSlackImageFile: jest.fn(),
}));

jest.mock(
  "back-end/src/services/notificationCards/renderNotificationCard",
  () => ({
    renderNotificationCard: jest.fn(),
  }),
);

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: jest.fn(),
}));

jest.mock("back-end/src/util/http.util", () => ({
  cancellableFetch: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("back-end/src/events/handlers/webhooks/event-webhooks-utils", () => ({
  getEventWebHookSignatureForPayload: jest.fn(),
}));

const getSlackWorkspaceConnectionByTeamId = jest.fn();

const runAgendaJob = async () => {
  const job = {
    attrs: {
      data: {
        eventId: "event-1",
        eventWebHookId: "webhook-1",
        retryCount: 0,
      },
    },
    save: jest.fn(),
  };

  await (
    EventWebHookNotifier as unknown as {
      handleAgendaJob: (job: typeof job) => Promise<void>;
    }
  ).handleAgendaJob(job);

  return job;
};

const setWebhook = ({
  url,
  slack,
  notificationSettings,
}: {
  url: string;
  slack?: { channelId: string; teamId?: string };
  notificationSettings?: NotificationSettings;
}) => {
  jest.mocked(getEventWebHookById).mockResolvedValue({
    id: "webhook-1",
    organizationId: "org-1",
    enabled: true,
    payloadType: "slack",
    method: "POST",
    url,
    signingKey: "signing-key",
    headers: {},
    slack,
    notificationSettings,
  });
};

describe("Slack EventWebHook delivery compatibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getEvent).mockResolvedValue({
      id: "event-1",
      organizationId: "org-1",
      event: "feature.updated",
      version: 1,
      data: {},
    });
    jest.mocked(findOrganizationById).mockResolvedValue({
      id: "org-1",
    });
    jest.mocked(getSlackMessageForNotificationEvent).mockReturnValue({
      text: "Feature updated",
      blocks: [],
    });
    jest.mocked(renderNotificationCard).mockResolvedValue(null);
    getSlackWorkspaceConnectionByTeamId.mockResolvedValue(null);
    jest.mocked(getContextForAgendaJobByOrgObject).mockReturnValue({
      models: {
        slackWorkspaceConnections: {
          getByTeamId: getSlackWorkspaceConnectionByTeamId,
        },
        webhookSecrets: {
          getBackEndSecretsReplacer: jest
            .fn()
            .mockResolvedValue(secretsReplacer({})),
        },
      },
    });
    jest
      .mocked(getEventWebHookSignatureForPayload)
      .mockReturnValue("signature");
    jest.mocked(cancellableFetch).mockResolvedValue({
      responseWithoutBody: { ok: true, status: 200 },
      stringBody: "ok",
    });
  });

  it("preserves legacy incoming-webhook delivery", async () => {
    const url = "https://hooks.slack.com/services/T000/B000/legacy";
    setWebhook({ url });

    await runAgendaJob();

    expect(postSlackMessageResult).not.toHaveBeenCalled();
    expect(cancellableFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "Feature updated", blocks: [] }),
      }),
      expect.any(Object),
    );
  });

  it("preserves custom relay delivery for Slack payloads", async () => {
    const url = "https://relay.example.com/growthbook-slack";
    setWebhook({ url });

    await runAgendaJob();

    expect(postSlackMessageResult).not.toHaveBeenCalled();
    expect(cancellableFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: "POST" }),
      expect.any(Object),
    );
  });

  it("keeps using an incoming webhook after OAuth metadata is added", async () => {
    const url = "https://hooks.slack.com/services/T000/B000/hybrid";
    setWebhook({ url, slack: { channelId: "C123", teamId: "T123" } });

    await runAgendaJob();

    expect(postSlackMessageResult).not.toHaveBeenCalled();
    expect(getSlackWorkspaceConnectionByTeamId).not.toHaveBeenCalled();
    expect(cancellableFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: "POST" }),
      expect.any(Object),
    );
    expect(updateEventWebHookStatus).toHaveBeenCalledTimes(1);
    expect(updateEventWebHookStatus).toHaveBeenCalledWith(
      "webhook-1",
      "org-1",
      { state: "success", responseBody: "ok" },
    );
  });

  it("does not post the workspace placeholder when bot delivery fails", async () => {
    setWebhook({
      url: SLACK_WORKSPACE_PLACEHOLDER_URL,
      slack: { channelId: "C123", teamId: "T123" },
    });
    getSlackWorkspaceConnectionByTeamId.mockResolvedValue({
      teamId: "T123",
      encryptedBotAccessToken: "xoxb-token",
    });
    jest.mocked(postSlackMessageResult).mockResolvedValue({
      ok: false,
      ts: null,
      error: "token_revoked",
    });

    const job = await runAgendaJob();

    expect(cancellableFetch).not.toHaveBeenCalled();
    expect(updateEventWebHookStatus).toHaveBeenCalledWith(
      "webhook-1",
      "org-1",
      { state: "error", error: "Slack delivery failed: token_revoked" },
    );
    expect(createEventWebHookLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventWebHookId: "webhook-1",
        result: expect.objectContaining({ state: "error" }),
      }),
    );
    expect(job.save).toHaveBeenCalled();
  });

  it("does not enter card rendering for text-only notifications", async () => {
    setWebhook({
      url: SLACK_WORKSPACE_PLACEHOLDER_URL,
      slack: { channelId: "C123", teamId: "T123" },
      notificationSettings: { type: "text" },
    });
    getSlackWorkspaceConnectionByTeamId.mockResolvedValue({
      teamId: "T123",
      encryptedBotAccessToken: "xoxb-token",
    });
    jest.mocked(postSlackMessageResult).mockResolvedValue({
      ok: true,
      ts: "123.456",
      error: null,
    });

    await runAgendaJob();

    expect(renderNotificationCard).not.toHaveBeenCalled();
    expect(uploadSlackImageFile).not.toHaveBeenCalled();
    expect(postSlackMessageResult).toHaveBeenCalled();
  });

  it("uploads an experiment card instead of posting the text message", async () => {
    setWebhook({
      url: SLACK_WORKSPACE_PLACEHOLDER_URL,
      slack: { channelId: "C123", teamId: "T123" },
      notificationSettings: { type: "image", cardFormat: "detailed" },
    });
    getSlackWorkspaceConnectionByTeamId.mockResolvedValue({
      teamId: "T123",
      encryptedBotAccessToken: "xoxb-token",
    });
    jest.mocked(renderNotificationCard).mockResolvedValue({
      png: Buffer.from("png"),
      altText: "Checkout test - Experiment stopped",
      caption:
        "<http://app/experiment/exp-1|Checkout test> - Experiment stopped",
    });
    jest.mocked(uploadSlackImageFile).mockResolvedValue("F123");

    await runAgendaJob();

    expect(renderNotificationCard).toHaveBeenCalledWith({}, "detailed");
    expect(uploadSlackImageFile).toHaveBeenCalledWith({
      token: "xoxb-token",
      png: Buffer.from("png"),
      filename: "notification-card.png",
      title: "Checkout test - Experiment stopped",
      channelId: "C123",
      initialComment:
        "<http://app/experiment/exp-1|Checkout test> - Experiment stopped",
    });
    expect(postSlackMessageResult).not.toHaveBeenCalled();
    expect(updateEventWebHookStatus).toHaveBeenCalledWith(
      "webhook-1",
      "org-1",
      { state: "success", responseBody: "F123" },
    );
  });

  it("falls back to text when the workspace cannot upload files", async () => {
    setWebhook({
      url: SLACK_WORKSPACE_PLACEHOLDER_URL,
      slack: { channelId: "C123", teamId: "T123" },
    });
    getSlackWorkspaceConnectionByTeamId.mockResolvedValue({
      teamId: "T123",
      encryptedBotAccessToken: "xoxb-token",
    });
    jest.mocked(renderNotificationCard).mockResolvedValue({
      png: Buffer.from("png"),
      altText: "Checkout test - Health issue",
      caption: "<http://app/experiment/exp-1|Checkout test> - Health issue",
    });
    jest.mocked(uploadSlackImageFile).mockResolvedValue(null);
    jest.mocked(postSlackMessageResult).mockResolvedValue({
      ok: true,
      ts: "123.456",
      error: null,
    });

    await runAgendaJob();

    expect(uploadSlackImageFile).toHaveBeenCalled();
    expect(postSlackMessageResult).toHaveBeenCalledWith({
      token: "xoxb-token",
      channel: "C123",
      text: "Feature updated",
      blocks: [],
    });
    expect(updateEventWebHookStatus).toHaveBeenCalledWith(
      "webhook-1",
      "org-1",
      { state: "success", responseBody: "123.456" },
    );
  });
});
