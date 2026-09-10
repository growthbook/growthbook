import { vi } from "vitest";
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
} from "back-end/src/services/slack/slackWebApi";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { cancellableFetch } from "back-end/src/util/http.util";
import { getEventWebHookSignatureForPayload } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import { secretsReplacer } from "back-end/src/util/secrets";

vi.mock("back-end/src/models/EventModel", () => ({
  getEvent: vi.fn(),
}));

vi.mock("back-end/src/models/EventWebhookModel", () => ({
  getEventWebHookById: vi.fn(),
  updateEventWebHookStatus: vi.fn(),
}));

vi.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationById: vi.fn(),
}));

vi.mock("back-end/src/models/EventWebHookLogModel", () => ({
  createEventWebHookLog: vi.fn(),
}));

vi.mock("back-end/src/events/handlers/slack/slack-event-handler-utils", () => ({
  getSlackMessageForLegacyNotificationEvent: vi.fn(),
  getSlackMessageForNotificationEvent: vi.fn(),
}));

vi.mock("back-end/src/services/slack/slackWebApi", async () => ({
  ...(await vi.importActual<
    typeof import("back-end/src/services/slack/slackWebApi")
  >("back-end/src/services/slack/slackWebApi")),
  postSlackMessageResult: vi.fn(),
}));

vi.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: vi.fn(),
}));

vi.mock("back-end/src/util/http.util", () => ({
  cancellableFetch: vi.fn(),
}));

vi.mock("back-end/src/util/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("back-end/src/events/handlers/webhooks/event-webhooks-utils", () => ({
  getEventWebHookSignatureForPayload: vi.fn(),
}));

const getSlackWorkspaceConnectionByTeamId = vi.fn();

const runAgendaJob = async () => {
  const job = {
    attrs: {
      data: {
        eventId: "event-1",
        eventWebHookId: "webhook-1",
        retryCount: 0,
      },
    },
    save: vi.fn(),
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
}: {
  url: string;
  slack?: { channelId: string; teamId?: string };
}) => {
  vi.mocked(getEventWebHookById).mockResolvedValue({
    id: "webhook-1",
    organizationId: "org-1",
    enabled: true,
    payloadType: "slack",
    method: "POST",
    url,
    signingKey: "signing-key",
    headers: {},
    slack,
  });
};

describe("Slack EventWebHook delivery compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEvent).mockResolvedValue({
      id: "event-1",
      organizationId: "org-1",
      event: "feature.updated",
      version: 1,
      data: {},
    });
    vi.mocked(findOrganizationById).mockResolvedValue({
      id: "org-1",
    });
    vi.mocked(getSlackMessageForNotificationEvent).mockReturnValue({
      text: "Feature updated",
      blocks: [],
    });
    getSlackWorkspaceConnectionByTeamId.mockResolvedValue(null);
    vi.mocked(getContextForAgendaJobByOrgObject).mockReturnValue({
      models: {
        slackWorkspaceConnections: {
          getByTeamId: getSlackWorkspaceConnectionByTeamId,
        },
        webhookSecrets: {
          getBackEndSecretsReplacer: vi
            .fn()
            .mockResolvedValue(secretsReplacer({})),
        },
      },
    });
    vi.mocked(getEventWebHookSignatureForPayload).mockReturnValue("signature");
    vi.mocked(cancellableFetch).mockResolvedValue({
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
    vi.mocked(postSlackMessageResult).mockResolvedValue({
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
});
