import type { NotificationSettings } from "shared/validators";
import { EventWebHookNotifier } from "back-end/src/events/handlers/webhooks/EventWebHookNotifier";
import { slackEventHandler } from "back-end/src/events/handlers/slack/slackEventHandler";
import { getSlackIntegrationsForFilters } from "back-end/src/models/SlackIntegrationModel";
import { getEvent } from "back-end/src/models/EventModel";
import {
  getEventWebHookById,
  updateEventWebHookStatus,
} from "back-end/src/models/EventWebhookModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { createEventWebHookLog } from "back-end/src/models/EventWebHookLogModel";
import {
  getSlackMessageForNotificationEvent,
  getSlackMessageForLegacyNotificationEvent,
} from "back-end/src/events/handlers/slack/slack-event-handler-utils";
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

jest.mock("back-end/src/models/SlackIntegrationModel", () => ({
  getSlackIntegrationsForFilters: jest.fn(),
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
    ...jest.requireActual(
      "back-end/src/events/handlers/slack/slack-event-handler-utils",
    ),
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
  enabled = true,
}: {
  url: string;
  slack?: { channelId: string; teamId?: string };
  notificationSettings?: NotificationSettings;
  enabled?: boolean;
}) => {
  jest.mocked(getEventWebHookById).mockResolvedValue({
    id: "webhook-1",
    organizationId: "org-1",
    enabled,
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

  it("does not deliver a subscription disabled after it was queued", async () => {
    setWebhook({ url: SLACK_WORKSPACE_PLACEHOLDER_URL, enabled: false });

    await runAgendaJob();

    expect(renderNotificationCard).not.toHaveBeenCalled();
    expect(getSlackMessageForNotificationEvent).not.toHaveBeenCalled();
    expect(postSlackMessageResult).not.toHaveBeenCalled();
    expect(cancellableFetch).not.toHaveBeenCalled();
    expect(updateEventWebHookStatus).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "keeps ignored events silent with workspace credentials = %s",
    async (hasCredentials) => {
      setWebhook({
        url: SLACK_WORKSPACE_PLACEHOLDER_URL,
        slack: { channelId: "C123", teamId: "T123" },
      });
      if (hasCredentials) {
        getSlackWorkspaceConnectionByTeamId.mockResolvedValue({
          encryptedBotAccessToken: "xoxb-token",
        });
      }
      jest.mocked(getSlackMessageForNotificationEvent).mockResolvedValue(null);

      const job = await runAgendaJob();

      expect(postSlackMessageResult).not.toHaveBeenCalled();
      expect(updateEventWebHookStatus).not.toHaveBeenCalled();
      expect(createEventWebHookLog).not.toHaveBeenCalled();
      expect(job.save).not.toHaveBeenCalled();
    },
  );

  it("keeps unversioned events on the legacy text path", async () => {
    setWebhook({
      url: SLACK_WORKSPACE_PLACEHOLDER_URL,
      slack: { channelId: "C123", teamId: "T123" },
    });
    jest.mocked(getEvent).mockResolvedValue({
      id: "event-1",
      organizationId: "org-1",
      event: "feature.updated",
      data: {},
    });
    getSlackWorkspaceConnectionByTeamId.mockResolvedValue({
      encryptedBotAccessToken: "xoxb-token",
    });
    jest.mocked(getSlackMessageForLegacyNotificationEvent).mockReturnValue({
      text: "Legacy event",
      blocks: [],
    });
    jest.mocked(postSlackMessageResult).mockResolvedValue({
      ok: true,
      ts: "123.456",
      error: null,
    });

    await runAgendaJob();

    expect(renderNotificationCard).not.toHaveBeenCalled();
    expect(postSlackMessageResult).toHaveBeenCalledWith({
      token: "xoxb-token",
      channel: "C123",
      text: "Legacy event",
      blocks: [],
    });
  });

  it("records missing workspace credentials without attempting delivery", async () => {
    setWebhook({
      url: SLACK_WORKSPACE_PLACEHOLDER_URL,
      slack: { channelId: "C123", teamId: "T123" },
    });

    const job = await runAgendaJob();

    expect(renderNotificationCard).not.toHaveBeenCalled();
    expect(postSlackMessageResult).not.toHaveBeenCalled();
    expect(cancellableFetch).not.toHaveBeenCalled();
    expect(updateEventWebHookStatus).toHaveBeenCalledWith(
      "webhook-1",
      "org-1",
      {
        state: "error",
        error: expect.stringContaining("no bot token or channel"),
      },
    );
    expect(job.save).toHaveBeenCalled();
  });

  it("delivers an image even when the text builder does not support the event", async () => {
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
      objectUrl: "http://app/experiment/exp-1",
      objectName: "Checkout test",
      eventLabel: "Experiment stopped",
    });
    jest.mocked(uploadSlackImageFile).mockResolvedValue("F123");
    jest.mocked(getSlackMessageForNotificationEvent).mockReturnValue(null);

    await runAgendaJob();

    expect(renderNotificationCard).toHaveBeenCalledWith(
      {},
      "detailed",
      expect.any(Object),
    );
    expect(getSlackMessageForNotificationEvent).not.toHaveBeenCalled();
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
    expect(createEventWebHookLog).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          text: "<http://app/experiment/exp-1|Checkout test> - Experiment stopped",
        },
      }),
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
      objectUrl: "http://app/experiment/exp-1",
      objectName: "Checkout test",
      eventLabel: "Health issue",
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

  it("escapes caption text without escaping the link or plain file title", async () => {
    setWebhook({
      url: SLACK_WORKSPACE_PLACEHOLDER_URL,
      slack: { channelId: "C123", teamId: "T123" },
    });
    getSlackWorkspaceConnectionByTeamId.mockResolvedValue({
      encryptedBotAccessToken: "xoxb-token",
    });
    jest.mocked(renderNotificationCard).mockResolvedValue({
      png: Buffer.from("png"),
      altText: "Checkout <v2> & test - Health issue",
      objectUrl: "http://app/experiment/exp-1",
      objectName: "Checkout <v2> & test",
      eventLabel: "Health issue <!channel>",
    });
    jest.mocked(uploadSlackImageFile).mockResolvedValue("F123");

    await runAgendaJob();

    expect(uploadSlackImageFile).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Checkout <v2> & test - Health issue",
        initialComment:
          "<http://app/experiment/exp-1|Checkout &lt;v2&gt; &amp; test> - Health issue &lt;!channel&gt;",
      }),
    );
    expect(postSlackMessageResult).not.toHaveBeenCalled();
  });

  it.each([1, undefined])(
    "preserves the separate legacy Slack handler for event version %s",
    async (version) => {
      const actualMessages = jest.requireActual<
        typeof import("back-end/src/events/handlers/slack/slack-event-handler-utils")
      >("back-end/src/events/handlers/slack/slack-event-handler-utils");
      const object = {
        type: "underpowered",
        experimentId: "exp-1",
        experimentName: "Checkout",
      };
      const notification = {
        id: "event-1",
        organizationId: "org-1",
        version,
        event: "experiment.warning",
        data: {
          event: "experiment.warning",
          data: version ? { object } : object,
          tags: ["checkout"],
          projects: ["project-1"],
          environments: ["production"],
        },
      };
      const integration = {
        id: "slack-1",
        name: "Release alerts",
        slackIncomingWebHook: "https://hooks.slack.com/services/legacy",
        environments: ["production"],
      };
      jest
        .mocked(getSlackIntegrationsForFilters)
        .mockResolvedValue([
          integration,
          { ...integration, id: "slack-2", environments: ["staging"] },
        ]);
      const expected =
        await actualMessages.getSlackDataForNotificationEvent(notification);
      if (!expected) throw new Error("Expected a legacy Slack notification");

      await slackEventHandler(
        notification,
        getContextForAgendaJobByOrgObject({ id: "org-1" }),
      );

      expect(getSlackIntegrationsForFilters).toHaveBeenCalledWith({
        organizationId: "org-1",
        eventName: "experiment.warning",
        tags: ["checkout"],
        projects: ["project-1"],
      });
      expect(cancellableFetch).toHaveBeenCalledTimes(1);
      expect(cancellableFetch).toHaveBeenCalledWith(
        integration.slackIncomingWebHook,
        expect.objectContaining({
          body: JSON.stringify({
            ...expected.slackMessage,
            blocks: [
              ...expected.slackMessage.blocks,
              actualMessages.getSlackIntegrationContextBlock(integration),
            ],
          }),
        }),
        expect.any(Object),
      );
      expect(renderNotificationCard).not.toHaveBeenCalled();
      expect(postSlackMessageResult).not.toHaveBeenCalled();
    },
  );

  describe.each([
    SLACK_WORKSPACE_PLACEHOLDER_URL,
    "https://hooks.slack.com/services/T000/B000/legacy",
  ])("real text builders via %s", (url) => {
    const experiment = { experimentId: "exp-1", experimentName: "Checkout" };
    const warnings = [
      { type: "no-data" },
      { type: "underpowered" },
      { type: "auto-update", success: false },
      { type: "multiple-exposures", usersCount: 42, percent: 0.1 },
      {
        type: "scheduled-status-update-failed",
        scheduledStatusUpdateType: "stop",
        attempts: 3,
        maxAttempts: 3,
        willRetry: false,
        reason: "No results",
      },
    ];

    it.each([
      { event: "feature.updated", object: { id: "checkout-flag" } },
      {
        event: "feature.revision.approved",
        object: { featureId: "checkout-flag", version: 2 },
      },
      { event: "savedGroup.updated", object: { id: "group-1", name: "Beta" } },
      {
        event: "constant.updated",
        object: { key: "timeout", name: "Timeout" },
      },
      {
        event: "config.updated",
        object: { key: "checkout", name: "Checkout" },
      },
      {
        event: "experiment.created",
        object: { id: "exp-1", name: "Checkout" },
      },
      ...warnings.map((warning) => ({
        event: "experiment.warning",
        object: { ...experiment, ...warning },
      })),
      ...["ship", "rollback", "review"].map((decision) => ({
        event: `experiment.decision.${decision}`,
        object: { ...experiment, source: "analysis" },
      })),
      {
        event: "experiment.info.significance",
        object: {
          ...experiment,
          metricId: "metric-1",
          metricName: "Conversion",
          variationId: "variation-1",
          variationName: "Treatment",
          statsEngine: "bayesian",
          criticalValue: 0.98,
          winning: true,
        },
      },
      {
        event: "experiment.info.scheduled-status-update",
        object: { ...experiment, action: "stopped", shipped: false },
      },
      {
        event: "feature.saferollout.ship",
        object: {
          featureId: "checkout-flag",
          safeRolloutId: "rollout-1",
          environment: "production",
        },
      },
      { event: "webhook.test", object: { webhookId: "webhook-1" } },
    ])("preserves $event text and blocks", async ({ event, object }) => {
      const actualMessages = jest.requireActual<
        typeof import("back-end/src/events/handlers/slack/slack-event-handler-utils")
      >("back-end/src/events/handlers/slack/slack-event-handler-utils");
      const actualCards = jest.requireActual<
        typeof import("back-end/src/services/notificationCards/renderNotificationCard")
      >("back-end/src/services/notificationCards/renderNotificationCard");
      jest
        .mocked(getSlackMessageForNotificationEvent)
        .mockImplementation(actualMessages.getSlackMessageForNotificationEvent);
      jest
        .mocked(renderNotificationCard)
        .mockImplementation(actualCards.renderNotificationCard);
      const notification = {
        id: "event-1",
        organizationId: "org-1",
        event,
        version: 1,
        data: { event, data: { object }, user: { type: "system" } },
      };
      jest.mocked(getEvent).mockResolvedValue(notification);
      setWebhook({ url, slack: { channelId: "C123", teamId: "T123" } });
      getSlackWorkspaceConnectionByTeamId.mockResolvedValue({
        encryptedBotAccessToken: "xoxb-token",
      });
      jest.mocked(postSlackMessageResult).mockResolvedValue({
        ok: true,
        ts: "123.456",
        error: null,
      });
      const expected = await actualMessages.getSlackMessageForNotificationEvent(
        notification.data,
        notification.id,
      );
      expect(expected?.text).toBeTruthy();
      expect(expected?.blocks.length).toBeGreaterThan(0);

      await runAgendaJob();

      expect(uploadSlackImageFile).not.toHaveBeenCalled();
      if (url === SLACK_WORKSPACE_PLACEHOLDER_URL) {
        expect(postSlackMessageResult).toHaveBeenCalledWith({
          token: "xoxb-token",
          channel: "C123",
          ...expected,
        });
        expect(cancellableFetch).not.toHaveBeenCalled();
      } else {
        expect(postSlackMessageResult).not.toHaveBeenCalled();
        expect(cancellableFetch).toHaveBeenCalledWith(
          url,
          expect.objectContaining({ body: JSON.stringify(expected) }),
          expect.any(Object),
        );
      }
    });
  });
});
