import {
  isCurrentSlackApproval,
  slackConversationId,
  slackTaskKey,
} from "back-end/src/services/slack/slackTaskSafety";

test("stale and absent approvals cannot confirm a newer action", () => {
  expect(isCurrentSlackApproval("new", "old")).toBe(false);
  expect(isCurrentSlackApproval(undefined, "old")).toBe(false);
  expect(isCurrentSlackApproval("new", "new")).toBe(true);
});

test("delivery keys preserve field boundaries", () => {
  expect(slackTaskKey(["a:b", "c"])).not.toBe(slackTaskKey(["a", "b:c"]));
});

test("conversation identity separates Slack users, orgs, threads, accounts, and consent generations", () => {
  const original = {
    teamId: "T1",
    channelId: "D1",
    rootTs: "123.456",
    organizationId: "org1",
    slackUserId: "U1",
    userId: "user1",
    linkId: "link1",
  };
  const id = slackConversationId(original);
  for (const overrides of [
    { organizationId: "org2" },
    { slackUserId: "U2" },
    { userId: "user2" },
    { linkId: "link2" },
    { rootTs: "1234.56" },
    { channelId: "C1" },
    { teamId: "T2" },
  ]) {
    expect(slackConversationId({ ...original, ...overrides })).not.toBe(id);
  }
  expect(slackConversationId(original)).toBe(id);
});
