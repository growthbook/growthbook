import type Agenda from "agenda";
import {
  claimSlackTask,
  getSlackTaskClaimAge,
  releaseSlackTask,
} from "back-end/src/services/slack/slackTaskSafety";
import { handleSlackAssistantMention } from "back-end/src/services/slack/slackAssistant";
import addSlackAssistantJobs, {
  queueSlackAssistantMention,
  queueSlackAssistantConfirmation,
} from "back-end/src/jobs/slackAssistantTasks";

jest.mock("back-end/src/services/slack/slackAssistant", () => ({
  handleSlackAssistantMention: jest.fn(),
  handleSlackAssistantConfirmation: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackUnfurl", () => ({
  handleSlackLinkShared: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackIdentity", () => ({
  resolveSlackAssistantTarget: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  postSlackEphemeralMessage: jest.fn(),
}));

jest.mock("back-end/src/services/slack/slackTaskSafety", () => ({
  ...jest.requireActual("back-end/src/services/slack/slackTaskSafety"),
  claimSlackTask: jest.fn(),
  getSlackTaskClaimAge: jest.fn(),
  releaseSlackTask: jest.fn(),
}));

const createIndex = jest.fn(async () => "index");
const unique = jest.fn();
const schedule = jest.fn();
const save = jest.fn(async () => undefined);
const agenda = {
  define: jest.fn(),
  _collection: { createIndex },
  create: jest.fn(() => ({ unique, schedule, save })),
};
const mention = {
  teamId: "team",
  channelId: "channel",
  slackUserId: "user",
  messageTs: "123.456",
  text: "hello",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(claimSlackTask).mockResolvedValue(true);
  jest.mocked(getSlackTaskClaimAge).mockResolvedValue(100);
  addSlackAssistantJobs(agenda as unknown as Agenda);
});

test("retains a completed delivery instead of scheduling it again", async () => {
  await queueSlackAssistantMention(mention, "event");
  await queueSlackAssistantMention(mention, "event");
  expect(unique).toHaveBeenCalledWith(
    expect.objectContaining({ "data.dedupeKey": expect.any(String) }),
    { insertOnly: true },
  );
  expect(unique.mock.calls[0]).toEqual(unique.mock.calls[1]);
  expect(createIndex).toHaveBeenCalledWith(
    { name: 1, "data.dedupeKey": 1 },
    expect.objectContaining({ unique: true }),
  );
});

test("propagates failed durable enqueue so the router can return503", async () => {
  save.mockRejectedValueOnce(new Error("write failed"));
  await expect(queueSlackAssistantMention(mention, "event")).rejects.toThrow(
    "write failed",
  );
});

test("accepts a concurrent duplicate insert as already queued", async () => {
  save.mockRejectedValueOnce(
    Object.assign(new Error("duplicate"), { code: 11000 }),
  );
  await expect(
    queueSlackAssistantMention(mention, "event"),
  ).resolves.toBeUndefined();
});

test("busy thread retries without running another turn", async () => {
  jest.mocked(claimSlackTask).mockResolvedValue(false);
  const process = agenda.define.mock.calls[0][1];
  await process({
    attrs: { data: { kind: "mention", mention } },
    schedule,
    save,
  });
  expect(handleSlackAssistantMention).not.toHaveBeenCalled();
  expect(schedule).toHaveBeenCalledWith(expect.any(Date));
  expect(save).toHaveBeenCalled();
});

test("handler failure releases the thread for future messages", async () => {
  jest
    .mocked(handleSlackAssistantMention)
    .mockRejectedValueOnce(new Error("failed turn"));
  const process = agenda.define.mock.calls[0][1];
  await expect(
    process({ attrs: { data: { kind: "mention", mention } }, schedule, save }),
  ).rejects.toThrow("failed turn");
  expect(releaseSlackTask).toHaveBeenCalledTimes(1);
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
