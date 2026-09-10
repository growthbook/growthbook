import Agenda from "agenda";
import { EventInterface } from "shared/types/events/event";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { ReqContext } from "back-end/types/request";
import {
  enqueueCoalescedEvent,
  getCoalesceWindow,
  getCoalescingExperimentId,
  shouldCoalesce,
} from "back-end/src/services/slack/notificationCoalescing";
import { flushSlackNotificationBatch } from "back-end/src/jobs/slackNotificationCoalescing";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getEvent } from "back-end/src/models/EventModel";
import { createEventWebHookLog } from "back-end/src/models/EventWebHookLogModel";
import {
  getEventWebHookById,
  updateEventWebHookStatus,
} from "back-end/src/models/EventWebhookModel";
import { EventWebHookNotifier } from "back-end/src/events/handlers/webhooks/EventWebHookNotifier";
import {
  postSlackMessageResult,
  SLACK_WORKSPACE_PLACEHOLDER_URL,
} from "back-end/src/services/slack/slackWebApi";

jest.mock("back-end/src/models/SlackNotificationBatchModel", () => ({
  SlackNotificationBatchModel: {},
}));
jest.mock("back-end/src/models/EventModel", () => ({ getEvent: jest.fn() }));
jest.mock("back-end/src/models/EventWebhookModel", () => ({
  getEventWebHookById: jest.fn(),
  updateEventWebHookStatus: jest.fn(),
}));
jest.mock("back-end/src/models/EventWebHookLogModel", () => ({
  createEventWebHookLog: jest.fn(),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));
jest.mock("back-end/src/services/slackIntegration", () => ({
  getSlackWorkspaceTokenForTeam: jest.fn().mockResolvedValue("token"),
}));
jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  ...jest.requireActual("back-end/src/services/slack/slackWebApi"),
  postSlackMessageResult: jest.fn(),
}));
jest.mock("back-end/src/util/logger", () => ({ logger: { error: jest.fn() } }));
jest.mock("back-end/src/events/handlers/webhooks/EventWebHookNotifier", () => ({
  EventWebHookNotifier: jest.fn().mockImplementation(() => ({
    enqueue: jest.fn().mockResolvedValue(undefined),
  })),
}));

const event = (id = "event1", overrides: Record<string, unknown> = {}) =>
  ({
    id,
    version: 1,
    organizationId: "org",
    object: "experiment",
    event: "experiment.started",
    data: {
      object: "experiment",
      projects: ["allowed"],
      tags: [],
      environments: [],
      data: { object: { experimentId: "exp", experimentName: "Checkout" } },
    },
    ...overrides,
  }) as unknown as EventInterface;
const webhook = (overrides: Partial<EventWebHookInterface> = {}) =>
  ({
    id: "hook",
    organizationId: "org",
    enabled: true,
    payloadType: "slack",
    url: SLACK_WORKSPACE_PLACEHOLDER_URL,
    slack: { teamId: "team", channelId: "channel" },
    slackOptions: { coalesceNotifications: true },
    projects: ["allowed"],
    tags: [],
    environments: [],
    events: ["experiment.*"],
    ...overrides,
  }) as EventWebHookInterface;
const model = {
  append: jest.fn(),
  claim: jest.fn(),
  finish: jest.fn(),
  release: jest.fn(),
  hasCurrentLease: jest.fn(),
};
const context = {
  models: { slackNotificationBatches: model },
} as unknown as ReqContext;
const save = jest.fn();
const agenda = {
  _collection: { createIndex: jest.fn() },
  create: jest.fn(() => ({ unique: jest.fn(), schedule: jest.fn(), save })),
} as unknown as Agenda;
const job = { bucketId: "batch", organization: "org", attempts: 0 };
const leaseUntil = new Date(Date.now() + 600000);
const batch = {
  id: "batch",
  eventWebHookId: "hook",
  experimentId: "exp",
  eventIds: ["event1", "event2"],
  attempts: 1,
  leaseUntil,
};
beforeEach(() => {
  jest.clearAllMocks();
  model.append.mockReset().mockResolvedValue(true);
  model.claim.mockReset().mockResolvedValue(batch);
  model.hasCurrentLease.mockReset().mockResolvedValue(true);
  save.mockReset().mockResolvedValue(undefined);
  jest.mocked(getContextForAgendaJobByOrgId).mockResolvedValue(context);
  jest.mocked(getEventWebHookById).mockReset().mockResolvedValue(webhook());
  jest
    .mocked(getEvent)
    .mockReset()
    .mockImplementation(async (id) => event(id));
  jest
    .mocked(postSlackMessageResult)
    .mockReset()
    .mockResolvedValue({ ok: true, ts: "123" });
});

it("gets immutable experiment identity for richer and legacy-shaped versioned events", () => {
  expect(getCoalescingExperimentId(event())).toBe("exp");
  expect(
    getCoalescingExperimentId(
      event("old", {
        data: { object: "experiment", data: { object: { id: "old-exp" } } },
      }),
    ),
  ).toBe("old-exp");
  expect(
    getCoalescingExperimentId(
      event("feature", { data: { object: "feature" } }),
    ),
  ).toBeNull();
  expect(
    getCoalescingExperimentId(event("legacy", { version: undefined })),
  ).toBeNull();
});
it("requires explicit opt-in and leaves legacy webhooks alone", () => {
  expect(shouldCoalesce(event(), webhook())).toBe(true);
  expect(shouldCoalesce(event(), webhook({ slackOptions: undefined }))).toBe(
    false,
  );
  expect(shouldCoalesce(event(), webhook({ enabled: false }))).toBe(false);
  expect(
    shouldCoalesce(
      event(),
      webhook({ url: "https://hooks.slack.com/services/legacy" }),
    ),
  ).toBe(false);
});
it("isolates buckets by organization, webhook, experiment, and minute", () => {
  const now = new Date("2026-09-10T12:30:20Z");
  const first = getCoalesceWindow("org", "hook", "exp", now);
  expect(first.flushAt).toEqual(new Date("2026-09-10T12:31:00Z"));
  const keys = [
    first.id,
    getCoalesceWindow("other", "hook", "exp", now).id,
    getCoalesceWindow("org", "other", "exp", now).id,
    getCoalesceWindow("org", "hook", "other", now).id,
    getCoalesceWindow("org", "hook", "exp", first.flushAt).id,
  ];
  expect(new Set(keys).size).toBe(keys.length);
});
it("falls back to ordinary delivery on DB errors or a sealed/full bucket", async () => {
  model.append.mockRejectedValueOnce(new Error("db"));
  expect(await enqueueCoalescedEvent(event(), webhook(), context, agenda)).toBe(
    false,
  );
  model.append.mockResolvedValueOnce(false);
  expect(await enqueueCoalescedEvent(event(), webhook(), context, agenda)).toBe(
    false,
  );
  expect(agenda.create).not.toHaveBeenCalled();
});
it("retains durable acceptance if Agenda scheduling fails, for recovery", async () => {
  save.mockRejectedValueOnce(new Error("scheduler"));
  expect(await enqueueCoalescedEvent(event(), webhook(), context, agenda)).toBe(
    true,
  );
});
it("does nothing when another worker owns the batch", async () => {
  model.claim.mockResolvedValueOnce(null);
  await flushSlackNotificationBatch(job, agenda);
  expect(getEventWebHookById).not.toHaveBeenCalled();
  expect(postSlackMessageResult).not.toHaveBeenCalled();
});
it("filters before counting and delivers a remaining single event normally", async () => {
  jest
    .mocked(getEvent)
    .mockResolvedValueOnce(event())
    .mockResolvedValueOnce(event("event2", { organizationId: "other" }));
  await flushSlackNotificationBatch(job, agenda);
  expect(EventWebHookNotifier).toHaveBeenCalledWith(
    { eventId: "event1", eventWebHookId: "hook", bypassCoalescing: true },
    agenda,
  );
  expect(postSlackMessageResult).not.toHaveBeenCalled();
  expect(model.finish).toHaveBeenCalledWith("batch", leaseUntil, "sent");
});
it("releases without sending when settings change during delivery", async () => {
  jest
    .mocked(getEventWebHookById)
    .mockResolvedValueOnce(webhook())
    .mockResolvedValueOnce(webhook({ enabled: false }));
  await expect(flushSlackNotificationBatch(job, agenda)).rejects.toThrow(
    "settings changed",
  );
  expect(postSlackMessageResult).not.toHaveBeenCalled();
  expect(model.release).toHaveBeenCalledWith("batch", leaseUntil);
});
it("sends one bounded plain-text summary and completes the owning lease", async () => {
  await flushSlackNotificationBatch(job, agenda);
  expect(postSlackMessageResult).toHaveBeenCalledTimes(1);
  const payload = jest.mocked(postSlackMessageResult).mock.calls[0][0];
  expect(payload.blocks).toEqual([
    {
      type: "section",
      text: {
        type: "plain_text",
        text: expect.stringContaining("2 experiment updates"),
      },
    },
  ]);
  expect(model.finish).toHaveBeenCalledWith("batch", leaseUntil, "sent");
  expect(model.release).not.toHaveBeenCalled();
});
it("releases transient Slack failures for retry", async () => {
  jest
    .mocked(postSlackMessageResult)
    .mockResolvedValueOnce({ ok: false, error: "ratelimited" });
  await expect(flushSlackNotificationBatch(job, agenda)).rejects.toThrow(
    "ratelimited",
  );
  expect(model.release).toHaveBeenCalledWith("batch", leaseUntil);
  expect(model.finish).not.toHaveBeenCalled();
  expect(updateEventWebHookStatus).toHaveBeenCalledWith("hook", "org", {
    state: "error",
    error: expect.stringContaining("ratelimited"),
  });
  expect(createEventWebHookLog).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: { coalescedEventIds: ["event1", "event2"] },
      result: {
        state: "error",
        responseBody: expect.stringContaining("ratelimited"),
        responseCode: 0,
      },
    }),
  );
});
it("marks terminal delivery failure instead of releasing it again", async () => {
  model.claim.mockResolvedValueOnce({ ...batch, attempts: 4 });
  jest
    .mocked(postSlackMessageResult)
    .mockResolvedValueOnce({ ok: false, error: "channel_not_found" });
  await expect(flushSlackNotificationBatch(job, agenda)).rejects.toThrow(
    "channel_not_found",
  );
  expect(model.finish).toHaveBeenCalledWith("batch", leaseUntil, "failed");
  expect(model.release).not.toHaveBeenCalled();
});

it("does not deliver events outside the channel project filter", async () => {
  const excluded = event("event2", {
    data: {
      object: "experiment",
      projects: ["other-project"],
      data: { object: { experimentId: "exp" } },
    },
  });
  jest
    .mocked(getEvent)
    .mockResolvedValueOnce(event())
    .mockResolvedValueOnce(excluded);
  await flushSlackNotificationBatch(job, agenda);
  expect(EventWebHookNotifier).toHaveBeenCalledTimes(1);
  expect(EventWebHookNotifier).toHaveBeenCalledWith(
    { eventId: "event1", eventWebHookId: "hook", bypassCoalescing: true },
    agenda,
  );
  expect(postSlackMessageResult).not.toHaveBeenCalled();
});
it("does not send after losing its delivery lease", async () => {
  model.hasCurrentLease.mockResolvedValueOnce(false);
  await expect(flushSlackNotificationBatch(job, agenda)).rejects.toThrow(
    "lease expired",
  );
  expect(postSlackMessageResult).not.toHaveBeenCalled();
  expect(model.release).toHaveBeenCalledWith("batch", leaseUntil);
});

it("does not post to Slack after the webhook payload type changes", async () => {
  jest
    .mocked(getEventWebHookById)
    .mockResolvedValueOnce(webhook())
    .mockResolvedValueOnce(webhook({ payloadType: "json" }));
  await expect(flushSlackNotificationBatch(job, agenda)).rejects.toThrow(
    "settings changed",
  );
  expect(postSlackMessageResult).not.toHaveBeenCalled();
});
