import type { NotificationEvent } from "shared/types/events/notification-events";
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
import { renderExperimentNotificationCard } from "back-end/src/services/notificationCards/experimentEventCard";
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
  "back-end/src/services/notificationCards/experimentEventCard",
  () => ({
    renderExperimentNotificationCard: jest.fn(),
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
  slackOptions,
}: {
  url: string;
  slack?: { channelId: string; teamId?: string };
  slackOptions?: { experimentCardFormat?: "none" | "compact" | "detailed" };
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
    slackOptions,
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
    jest.mocked(renderExperimentNotificationCard).mockResolvedValue(null);
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

  it.each(["incoming webhook", "workspace bot"])(
    "delivers experiment alerts through the %s with the real Slack formatter",
    async (delivery) => {
      const formatter = jest.requireActual<
        typeof import("back-end/src/events/handlers/slack/slack-event-handler-utils")
      >(
        "back-end/src/events/handlers/slack/slack-event-handler-utils",
      ).getSlackMessageForNotificationEvent;
      jest
        .mocked(getSlackMessageForNotificationEvent)
        .mockImplementation(formatter);
      const url =
        delivery === "workspace bot"
          ? SLACK_WORKSPACE_PLACEHOLDER_URL
          : "https://hooks.slack.com/services/T000/B000/test";
      setWebhook({ url, slack: { channelId: "C123", teamId: "T123" } });
      getSlackWorkspaceConnectionByTeamId.mockResolvedValue({
        teamId: "T123",
        encryptedBotAccessToken: "xoxb-token",
      });
      jest
        .mocked(postSlackMessageResult)
        .mockResolvedValue({ ok: true, ts: "123.456", error: null });

      const base = { experimentId: "exp-1", experimentName: "Checkout" };
      const events = [
        {
          event: "experiment.health.srm",
          data: { object: { ...base, type: "srm", threshold: 0.001 } },
        },
        {
          event: "experiment.health.multipleExposures",
          data: {
            object: {
              ...base,
              type: "multiple-exposures",
              usersCount: 10,
              percent: 0.1,
            },
          },
        },
        {
          event: "experiment.health.updateFailure",
          data: {
            object: {
              ...base,
              type: "update-failed",
              cause: "query",
              errorMessage: "secret SQL",
            },
          },
        },
        {
          event: "experiment.metric.guardrailFailure",
          data: {
            object: {
              ...base,
              type: "guardrail-failed",
              failedMetrics: [
                { id: "revenue", name: "Revenue", variationName: "Express" },
              ],
            },
          },
        },
        {
          event: "experiment.status.started",
          data: { object: { ...base, type: "started", linkedFeatureCount: 2 } },
        },
      ] as NotificationEvent[];

      for (const event of events) {
        jest.mocked(getEvent).mockResolvedValue({
          id: "event-1",
          organizationId: "org-1",
          version: 1,
          event: event.event,
          data: event,
        });
        await runAgendaJob();
        const message = await formatter(event, "event-1");
        expect(message).not.toBeNull();
        expect(message?.text).not.toContain("secret SQL");
        if (delivery === "workspace bot") {
          expect(postSlackMessageResult).toHaveBeenLastCalledWith({
            token: "xoxb-token",
            channel: "C123",
            ...message,
          });
          expect(cancellableFetch).not.toHaveBeenCalled();
        } else {
          expect(cancellableFetch).toHaveBeenLastCalledWith(
            url,
            expect.objectContaining({ body: JSON.stringify(message) }),
            expect.any(Object),
          );
          expect(postSlackMessageResult).not.toHaveBeenCalled();
        }
      }
      expect(updateEventWebHookStatus).toHaveBeenCalledTimes(events.length);
    },
  );

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

  it("uploads an experiment card instead of posting the text message", async () => {
    setWebhook({
      url: SLACK_WORKSPACE_PLACEHOLDER_URL,
      slack: { channelId: "C123", teamId: "T123" },
      slackOptions: { experimentCardFormat: "detailed" },
    });
    getSlackWorkspaceConnectionByTeamId.mockResolvedValue({
      teamId: "T123",
      encryptedBotAccessToken: "xoxb-token",
    });
    jest.mocked(renderExperimentNotificationCard).mockResolvedValue({
      png: Buffer.from("png"),
      altText: "Checkout test — experiment results",
      caption: "Experiment stopped",
      experimentId: "exp-1",
    });
    jest.mocked(uploadSlackImageFile).mockResolvedValue("F123");

    await runAgendaJob();

    expect(renderExperimentNotificationCard).toHaveBeenCalledWith(
      {},
      "org-1",
      "detailed",
    );
    expect(uploadSlackImageFile).toHaveBeenCalledWith({
      token: "xoxb-token",
      png: Buffer.from("png"),
      filename: "experiment-card.png",
      title: "Experiment stopped",
      channelId: "C123",
      initialComment: "Experiment stopped",
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
    jest.mocked(renderExperimentNotificationCard).mockResolvedValue({
      png: Buffer.from("png"),
      altText: "Checkout test — experiment results",
      caption: "Health alert",
      experimentId: "exp-1",
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
