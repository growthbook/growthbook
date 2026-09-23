import { vi } from "vitest";
import type Agenda from "agenda";
import { SlackThreadBusyError } from "back-end/src/services/slack/slackTaskSafety";
import { handleSlackAssistantMention } from "back-end/src/services/slack/slackAssistant";
import { handleSlackAppHomeOpened } from "back-end/src/services/slack/slackAppHome";
import addSlackAssistantJobs, {
  queueSlackAssistantMention,
  queueSlackAssistantConfirmation,
  queueSlackAppHomeOpened,
} from "back-end/src/jobs/slackAssistantJobs";
vi.mock("back-end/src/services/slack/slackAppHome", async () => ({
  ...(await vi.importActual<
    typeof import("back-end/src/services/slack/slackAppHome")
  >("back-end/src/services/slack/slackAppHome")),
  handleSlackAppHomeOpened: vi.fn(),
}));
vi.mock("back-end/src/services/slack/slackAssistant", async () => ({
  ...(await vi.importActual<
    typeof import("back-end/src/services/slack/slackAssistant")
  >("back-end/src/services/slack/slackAssistant")),
  handleSlackAssistantMention: vi.fn(),
  handleSlackAssistantConfirmation: vi.fn(),
}));

const createIndex = vi.fn(async () => "index");
const unique = vi.fn();
const schedule = vi.fn();
const save = vi.fn(async () => undefined);
const agenda = {
  define: vi.fn(),
  _collection: { createIndex },
  create: vi.fn(() => ({ unique, schedule, save })),
};
const mention = {
  teamId: "team",
  channelId: "channel",
  slackUserId: "user",
  messageTs: "123.456",
  text: "hello",
};

beforeEach(() => {
  vi.clearAllMocks();
  addSlackAssistantJobs(agenda as unknown as Agenda);
});

test("retains a completed delivery instead of scheduling it again", async () => {
  await queueSlackAssistantMention({ eventId: "event", mention });
  await queueSlackAssistantMention({ eventId: "event", mention });
  expect(unique).toHaveBeenCalledWith(
    expect.objectContaining({ "data.dedupeKey": expect.any(String) }),
    { insertOnly: true },
  );
  expect(unique.mock.calls[0]).toEqual(unique.mock.calls[1]);
});

test("builds the delivery index when the job is registered, not per enqueue", async () => {
  expect(createIndex).toHaveBeenCalledTimes(1);
  expect(createIndex).toHaveBeenCalledWith(
    { name: 1, "data.dedupeKey": 1 },
    expect.objectContaining({ unique: true }),
  );
  await queueSlackAssistantMention({ eventId: "event", mention });
  expect(createIndex).toHaveBeenCalledTimes(1);
});

test("keeps enqueueing when the delivery index can't be built", async () => {
  createIndex.mockRejectedValueOnce(
    new Error("unique index needs an empty collection"),
  );
  addSlackAssistantJobs(agenda as unknown as Agenda);
  await queueSlackAssistantMention({ eventId: "event", mention });
  expect(save).toHaveBeenCalledTimes(1);
});

test("deduplicates app opens by event and workspace while allowing a later open", async () => {
  const appHome = { teamId: "team", channelId: "dm", eventId: "event" };
  await queueSlackAppHomeOpened(appHome);
  await queueSlackAppHomeOpened(appHome);
  await queueSlackAppHomeOpened({ ...appHome, eventId: "next-event" });
  await queueSlackAppHomeOpened({ ...appHome, teamId: "other-team" });
  expect(unique.mock.calls[0]).toEqual(unique.mock.calls[1]);
  expect(unique.mock.calls[0]).not.toEqual(unique.mock.calls[2]);
  expect(unique.mock.calls[0]).not.toEqual(unique.mock.calls[3]);
});

test("processes an app open without claiming a thread or starting an AI turn", async () => {
  const appHome = { teamId: "team", channelId: "dm", eventId: "event" };
  const process = agenda.define.mock.calls[0][1];
  await process({
    attrs: { data: { kind: "appHomeOpened", appHome } },
    schedule,
    save,
  });
  expect(handleSlackAppHomeOpened).toHaveBeenCalledWith(appHome);
  expect(handleSlackAssistantMention).not.toHaveBeenCalled();
});

test("propagates failed app-open enqueue so Slack can retry", async () => {
  save.mockRejectedValueOnce(new Error("write failed"));
  await expect(
    queueSlackAppHomeOpened({
      teamId: "team",
      channelId: "dm",
      eventId: "event",
    }),
  ).rejects.toThrow("write failed");
});

test("propagates failed durable enqueue so the router can return503", async () => {
  save.mockRejectedValueOnce(new Error("write failed"));
  await expect(
    queueSlackAssistantMention({ eventId: "event", mention }),
  ).rejects.toThrow("write failed");
});

test("accepts a concurrent duplicate insert as already queued", async () => {
  save.mockRejectedValueOnce(
    Object.assign(new Error("duplicate"), { code: 11000 }),
  );
  await expect(
    queueSlackAssistantMention({ eventId: "event", mention }),
  ).resolves.toBeUndefined();
});

test("reschedules a busy thread and keeps the placeholder for the retry", async () => {
  vi.mocked(handleSlackAssistantMention).mockRejectedValueOnce(
    new SlackThreadBusyError("999.111"),
  );
  const process = agenda.define.mock.calls[0][1];
  const job = { attrs: { data: { kind: "mention", mention } }, schedule, save };
  await process(job);
  expect(handleSlackAssistantMention).toHaveBeenCalledTimes(1);
  expect(job.attrs.data).toEqual({
    kind: "mention",
    mention: { ...mention, placeholderTs: "999.111" },
  });
  expect(schedule).toHaveBeenCalledWith(expect.any(Date));
  expect(save).toHaveBeenCalled();
});

test("normalizes absent mention fields read from MongoDB before running the turn", async () => {
  const process = agenda.define.mock.calls[0][1];
  const optionalFields = {
    threadTs: null,
    botUserId: null,
    placeholderTs: null,
  };
  await process({
    attrs: {
      data: { kind: "mention", mention: { ...mention, ...optionalFields } },
    },
    schedule,
    save,
  });
  expect(handleSlackAssistantMention).toHaveBeenCalledWith({
    ...mention,
    threadTs: undefined,
    botUserId: undefined,
    placeholderTs: undefined,
  });
});

test("handler failure is recorded by Agenda", async () => {
  vi.mocked(handleSlackAssistantMention).mockRejectedValueOnce(
    new Error("failed turn"),
  );
  const process = agenda.define.mock.calls[0][1];
  await expect(
    process({ attrs: { data: { kind: "mention", mention } }, schedule, save }),
  ).rejects.toThrow("failed turn");
});

test("deduplicates redeliveries but lets a fresh approval click retry preflight", async () => {
  const confirmation = {
    teamId: "team",
    channelId: "channel",
    slackUserId: "user",
    conversationId: "conv",
    actionId: "action",
    decision: "confirm" as const,
    interactionTs: "123.456",
  };
  await queueSlackAssistantConfirmation(confirmation);
  await queueSlackAssistantConfirmation(confirmation);
  await queueSlackAssistantConfirmation({
    ...confirmation,
    interactionTs: "123.457",
  });
  expect(unique.mock.calls[0]).toEqual(unique.mock.calls[1]);
  expect(unique.mock.calls[2]).not.toEqual(unique.mock.calls[1]);
});
