import { claimSlackTask } from "back-end/src/services/slack/slackTaskSafety";
import {
  updateSlackMessage,
  postSlackMessage,
} from "back-end/src/services/slack/slackWebApi";
import { handleSlackAssistantConfirmation } from "back-end/src/services/slack/slackAssistant";
import { runAgentTurnToCompletion } from "back-end/src/enterprise/services/agent-handler";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";

jest.mock("back-end/src/enterprise/services/agent-handler", () => ({
  runAgentTurnToCompletion: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackIdentity", () => ({
  resolveSlackAssistantTarget: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackTaskSafety", () => ({
  claimSlackTask: jest.fn().mockResolvedValue(true),
  slackTaskKey: jest.fn().mockReturnValue("key"),
  isCurrentSlackApproval: jest.fn().mockReturnValue(true),
}));
jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  postSlackMessage: jest.fn(),
  postSlackEphemeralMessage: jest.fn(),
  updateSlackMessage: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackAgent", () => ({
  slackAgentConfig: {},
}));
jest.mock(
  "back-end/src/services/notificationCards/experimentCardData",
  () => ({}),
);
jest.mock(
  "back-end/src/services/notificationCards/experimentCards",
  () => ({}),
);
jest.mock("back-end/src/services/slack/cardDelivery", () => ({}));

const conversationId = "conv_slack_T1_org1_C1_123456_user1";
const getById = jest.fn().mockResolvedValue({ pendingAction: { id: "first" } });

beforeEach(() => {
  jest.clearAllMocks();
  // Only the fields consumed by this service are needed in the mocked context.
  jest.mocked(resolveSlackAssistantTarget).mockImplementation(
    async () =>
      ({
        ok: true,
        context: { models: { aiConversations: { getById } } },
        userId: "user1",
        organizationId: "org1",
        botToken: "token",
        assistantEnabled: true,
        unfurlEnabled: false,
        eventWebHookId: "webhook1",
      }) as unknown as Awaited<ReturnType<typeof resolveSlackAssistantTarget>>,
  );
});

it.each(["confirm", "cancel"] as const)(
  "offers fresh approval controls when a %s continuation parks another action",
  async (decision) => {
    jest.mocked(runAgentTurnToCompletion).mockResolvedValue({
      ok: true,
      conversationId,
      reply: "Next I can update the rule.",
      pendingAction: {
        id: "second",
        summary: "Update the rule",
      } as NonNullable<
        Extract<
          Awaited<ReturnType<typeof runAgentTurnToCompletion>>,
          { ok: true }
        >["pendingAction"]
      >,
      experimentCardIds: [],
    });
    await handleSlackAssistantConfirmation({
      teamId: "T1",
      channelId: "C1",
      slackUserId: "U1",
      conversationId,
      actionId: "first",
      decision,
      threadTs: "123.456",
      buttonsMessageTs: "123.457",
    });
    expect(postSlackMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C1",
        threadTs: "123.456",
        text: "Confirm this change?",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "actions",
            elements: expect.arrayContaining([
              expect.objectContaining({
                action_id: "gb_confirm_action",
                value: JSON.stringify({
                  c: conversationId,
                  a: "second",
                  t: "123.456",
                }),
              }),
              expect.objectContaining({ action_id: "gb_cancel_action" }),
            ]),
          }),
        ]),
      }),
    );
  },
);

it.each([
  { channelId: "C2", threadTs: "123.456" },
  { channelId: "C1", threadTs: "999.456" },
  { channelId: "C1", threadTs: undefined },
])(
  "rejects approval outside its original channel/thread: %p",
  async (location) => {
    await handleSlackAssistantConfirmation({
      teamId: "T1",
      slackUserId: "U1",
      conversationId,
      actionId: "first",
      decision: "confirm",
      ...location,
    });
    expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
  },
);

it("keeps controls retryable before dispatch but blocks replay after an uncertain mutation failure", async () => {
  const input = {
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    conversationId,
    actionId: "first",
    decision: "confirm" as const,
    threadTs: "123.456",
    buttonsMessageTs: "123.457",
  };
  jest.mocked(runAgentTurnToCompletion).mockResolvedValueOnce({
    ok: false,
    status: 429,
    message: "Limit reached",
  });
  await handleSlackAssistantConfirmation(input);
  expect(claimSlackTask).not.toHaveBeenCalled();
  expect(updateSlackMessage).not.toHaveBeenCalled();
  const dispatch = jest
    .fn()
    .mockRejectedValue(new Error("Unknown mutation outcome"));
  jest
    .mocked(runAgentTurnToCompletion)
    .mockImplementation(async ({ beforeResolvePendingAction }) => {
      await beforeResolvePendingAction?.();
      return dispatch();
    });
  jest
    .mocked(claimSlackTask)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  await handleSlackAssistantConfirmation(input);
  await handleSlackAssistantConfirmation(input);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(updateSlackMessage).toHaveBeenCalledTimes(1);
  expect(postSlackMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      text: expect.stringContaining("already been submitted"),
    }),
  );
});
