import {
  isCurrentSlackApproval,
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
