import type { ApiReqContext } from "back-end/types/api";
import { claimSlackTask } from "back-end/src/services/slack/slackTaskSafety";
import {
  updateSlackMessage,
  postSlackMessage,
  postSlackEphemeralMessage,
} from "back-end/src/services/slack/slackWebApi";
import {
  handleSlackAssistantConfirmation,
  handleSlackAssistantMention,
  handleSlackOrganizationSelection,
} from "back-end/src/services/slack/slackAssistant";
import { runAgentTurnToCompletion } from "back-end/src/enterprise/services/agent-handler";
import {
  getSlackThread,
  pinSlackThreadOrganization,
  saveSlackOrganizationPicker,
  consumeSlackOrganizationSelection,
  slackConversationId,
} from "back-end/src/services/slack/slackThreadRouting";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";

jest.mock("back-end/src/enterprise/services/agent-handler", () => ({
  runAgentTurnToCompletion: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackIdentity", () => ({
  resolveSlackAssistantTarget: jest.fn(),
  getSlackWorkspaceBotToken: jest.fn().mockResolvedValue("token"),
}));
jest.mock("back-end/src/services/slack/slackTaskSafety", () => ({
  claimSlackTask: jest.fn().mockResolvedValue(true),
  slackTaskKey: jest.requireActual(
    "back-end/src/services/slack/slackTaskSafety",
  ).slackTaskKey,
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

jest.mock("back-end/src/services/slack/slackThreadRouting", () => ({
  ...jest.requireActual("back-end/src/services/slack/slackThreadRouting"),
  getSlackThread: jest.fn(),
  pinSlackThreadOrganization: jest.fn(),
  saveSlackOrganizationPicker: jest.fn(),
  consumeSlackOrganizationSelection: jest.fn(),
}));
const thread = {
  _id: "thread1",
  teamId: "T1",
  channelId: "C1",
  rootTs: "123.456",
  dateUpdated: new Date(),
  status: "selected" as const,
  organizationId: "org1",
};
const conversationId = slackConversationId({
  ...thread,
  slackUserId: "U1",
  userId: "user1",
  linkId: "link1",
});
const getById = jest.fn().mockResolvedValue({ pendingAction: { id: "first" } });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSlackThread).mockResolvedValue(thread);
  jest.mocked(pinSlackThreadOrganization).mockResolvedValue(thread);
  // Only the fields consumed by this service are needed in the mocked context.
  jest.mocked(resolveSlackAssistantTarget).mockImplementation(
    async () =>
      ({
        ok: true,
        context: {
          models: { aiConversations: { getById } },
          getPermissionsFingerprint: () => "permissions",
        },
        userId: "user1",
        linkId: "link1",
        organizationName: "First org",
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

it("rejects approvals from an earlier link generation, even for the same account", async () => {
  const target = await resolveSlackAssistantTarget({
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
  });
  if (!target.ok) throw new Error("Expected a target");
  jest
    .mocked(resolveSlackAssistantTarget)
    .mockResolvedValue({ ...target, linkId: "replacement" });
  await handleSlackAssistantConfirmation({
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    conversationId,
    actionId: "first",
    decision: "confirm",
    threadTs: "123.456",
  });
  expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
});
it.each(["link", "permissions"])(
  "rechecks %s immediately before dispatch",
  async (changed) => {
    const target = await resolveSlackAssistantTarget({
      teamId: "T1",
      channelId: "C1",
      slackUserId: "U1",
    });
    if (!target.ok) throw new Error("Expected a target");
    jest
      .mocked(resolveSlackAssistantTarget)
      .mockResolvedValueOnce(target)
      .mockResolvedValue(
        changed === "link"
          ? { ...target, linkId: "replacement" }
          : {
              ...target,
              context: {
                ...target.context,
                getPermissionsFingerprint: () => "changed-permissions",
              } as ApiReqContext,
            },
      );
    const dispatch = jest.fn();
    jest
      .mocked(runAgentTurnToCompletion)
      .mockImplementation(async ({ beforeResolvePendingAction }) => {
        await beforeResolvePendingAction?.();
        return dispatch();
      });
    await handleSlackAssistantConfirmation({
      teamId: "T1",
      channelId: "C1",
      slackUserId: "U1",
      conversationId,
      actionId: "first",
      decision: "confirm",
      threadTs: "123.456",
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(claimSlackTask).not.toHaveBeenCalled();
  },
);
it("shows ambiguous organization choices instead of dropping the question", async () => {
  const mention = {
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    text: "Question",
    messageTs: "123.456",
  };
  const choices = [
    { organizationId: "org1", name: "First", linkId: "link1" },
    { organizationId: "org2", name: "Second", linkId: "link2" },
  ];
  jest.mocked(getSlackThread).mockResolvedValue(null);
  jest.mocked(resolveSlackAssistantTarget).mockResolvedValue({
    ok: false,
    reason: "ambiguous_org",
    message: "Choose an organization",
    botToken: "token",
    choices,
  });
  jest.mocked(saveSlackOrganizationPicker).mockResolvedValue({
    ...thread,
    status: "pending",
    mention,
    selectionId: "picker",
    choices,
  });
  await handleSlackAssistantMention(mention);
  expect(saveSlackOrganizationPicker).toHaveBeenCalledWith(mention, choices);
  expect(postSlackEphemeralMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      user: "U1",
      blocks: expect.arrayContaining([
        expect.objectContaining({
          accessory: expect.objectContaining({ type: "static_select" }),
        }),
      ]),
    }),
  );
  expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
});
it("does not consume an organization selection after access is revoked", async () => {
  jest.mocked(resolveSlackAssistantTarget).mockResolvedValue({
    ok: false,
    reason: "organization_unavailable",
    message: "No access",
    botToken: "token",
  });
  await handleSlackOrganizationSelection({
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    selectionId: "picker",
    organizationId: "org1",
    threadTs: "123.456",
    interactionTs: "123.999",
  });
  expect(consumeSlackOrganizationSelection).not.toHaveBeenCalled();
  expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
});

it("continues the original question once after an authorized organization choice", async () => {
  const mention = {
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    text: "Original question",
    messageTs: "123.456",
  };
  jest
    .mocked(consumeSlackOrganizationSelection)
    .mockResolvedValueOnce(mention)
    .mockResolvedValue(null);
  jest.mocked(runAgentTurnToCompletion).mockResolvedValue({
    ok: true,
    conversationId,
    reply: "Answer",
    pendingAction: null,
    experimentCardIds: [],
  });
  const selection = {
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    selectionId: "picker",
    organizationId: "org1",
    threadTs: "123.456",
    interactionTs: "123.999",
  };
  await handleSlackOrganizationSelection(selection);
  await handleSlackOrganizationSelection(selection);
  expect(runAgentTurnToCompletion).toHaveBeenCalledTimes(1);
  expect(runAgentTurnToCompletion).toHaveBeenCalledWith(
    expect.objectContaining({
      input: { message: "Original question", conversationId },
    }),
  );
});
it("refreshes signed link consent on request even for already-linked users", async () => {
  await handleSlackAssistantMention({
    teamId: "T1",
    channelId: "D1",
    slackUserId: "U1",
    text: "link account",
    messageTs: "123.456",
  });
  expect(postSlackEphemeralMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      user: "U1",
      text: expect.stringContaining("/integrations/slack/link?state="),
    }),
  );
  expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
});
