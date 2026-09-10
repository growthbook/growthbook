import {
  claimSlackTask,
  releaseSlackTask,
  isCurrentSlackApproval,
  slackTaskKey,
} from "back-end/src/services/slack/slackTaskSafety";
import { getCollection } from "back-end/src/util/mongo.util";

jest.mock("back-end/src/util/mongo.util", () => ({ getCollection: jest.fn() }));

const claimed = new Set<string>();
const insertOne = jest.fn(async ({ _id }: { _id: string }) => {
  if (claimed.has(_id))
    throw Object.assign(new Error("duplicate"), { code: 11000 });
  claimed.add(_id);
});
const deleteOne = jest.fn(async ({ _id }: { _id: string }) => {
  claimed.delete(_id);
});

beforeEach(() => {
  claimed.clear();
  jest.clearAllMocks();
  jest
    .mocked(getCollection)
    .mockReturnValue({ insertOne, deleteOne } as unknown as ReturnType<
      typeof getCollection
    >);
});

test("concurrent approval claims allow only one dispatch and completed claims stay consumed", async () => {
  const key = `action:${slackTaskKey(["team", "org", "conversation", "action"])}`;
  expect(await Promise.all([claimSlackTask(key), claimSlackTask(key)])).toEqual(
    [true, false],
  );
  expect(await claimSlackTask(key)).toBe(false);
});

test("thread claim is exclusive until explicitly released", async () => {
  expect(await claimSlackTask("thread:one")).toBe(true);
  expect(await claimSlackTask("thread:one")).toBe(false);
  await releaseSlackTask("thread:one");
  expect(await claimSlackTask("thread:one")).toBe(true);
});

test("database failure cannot be mistaken for an accepted duplicate", async () => {
  insertOne.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(claimSlackTask("action:one")).rejects.toThrow(
    "database unavailable",
  );
});

test("stale and absent approvals cannot confirm a newer action", () => {
  expect(isCurrentSlackApproval("new", "old")).toBe(false);
  expect(isCurrentSlackApproval(undefined, "old")).toBe(false);
  expect(isCurrentSlackApproval("new", "new")).toBe(true);
});

test("delivery keys preserve field boundaries", () => {
  expect(slackTaskKey(["a:b", "c"])).not.toBe(slackTaskKey(["a", "b:c"]));
});
