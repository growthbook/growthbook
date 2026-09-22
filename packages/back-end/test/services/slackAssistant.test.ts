import type { ApiReqContext } from "back-end/types/api";
import {
  updateSlackMessage,
  postSlackMessage,
  postSlackEphemeralMessage,
  SlackRateLimitError,
} from "back-end/src/services/slack/slackWebApi";
import {
  handleSlackAssistantConfirmation,
  handleSlackAssistantMention,
} from "back-end/src/services/slack/slackAssistant";
import { runAgentTurnToCompletion } from "back-end/src/enterprise/services/agent-handler";
import { SlackAssistantThreadModel } from "back-end/src/models/SlackAssistantThreadModel";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";
import { verifySlackLinkState } from "back-end/src/services/slack/slackLink";
import {
  SlackThreadBusyError,
  slackConversationId,
} from "back-end/src/services/slack/slackTaskSafety";

jest.mock("back-end/src/enterprise/services/agent-handler", () => ({
  runAgentTurnToCompletion: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackIdentity", () => ({
  resolveSlackAssistantTarget: jest.fn(),
  getSlackWorkspaceBotToken: jest.fn().mockResolvedValue("token"),
}));
jest.mock("back-end/src/services/slack/slackTaskSafety", () => ({
  ...jest.requireActual("back-end/src/services/slack/slackTaskSafety"),
  isCurrentSlackApproval: jest.fn().mockReturnValue(true),
}));
jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  SlackRateLimitError: jest.requireActual(
    "back-end/src/services/slack/slackWebApi",
  ).SlackRateLimitError,
  postSlackMessage: jest.fn(),
  postSlackEphemeralMessage: jest.fn(),
  updateSlackMessage: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackAgent", () => ({
  slackAgentConfig: {},
}));
jest.mock("back-end/src/models/SlackAssistantThreadModel", () => ({
  SlackAssistantThreadModel: { dangerousGetForThread: jest.fn() },
}));
const getThread = jest.mocked(SlackAssistantThreadModel.dangerousGetForThread);
const thread = {
  id: "thread1",
  teamId: "T1",
  channelId: "C1",
  rootTs: "123.456",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  organization: "org1",
};
const bindConversationThread = jest.fn(async () => thread);
const conversationId = slackConversationId({
  ...thread,
  organizationId: "org1",
  slackUserId: "U1",
  userId: "user1",
  linkId: "link1",
});
const getById = jest.fn().mockResolvedValue({ pendingAction: { id: "first" } });
const claim = jest.fn(async () => true);
const acquireThreadLease = jest.fn(async () => ({
  token: "turn",
  expiresAt: new Date(Date.now() + 60_000),
}));
const releaseThreadLease = jest.fn(async () => undefined);
beforeEach(() => {
  jest.clearAllMocks();
  claim.mockResolvedValue(true);
  jest.mocked(postSlackEphemeralMessage).mockResolvedValue(true);
  getThread.mockResolvedValue(thread);
  bindConversationThread.mockResolvedValue(thread);
  // Only the fields consumed by this service are needed in the mocked context.
  jest.mocked(resolveSlackAssistantTarget).mockImplementation(
    async () =>
      ({
        ok: true,
        context: {
          models: {
            aiConversations: { getById },
            slackTaskClaims: {
              claimOnce: claim,
              acquireThreadLease,
              releaseThreadLease,
            },
            slackAssistantThreads: { bindConversationThread },
          },
          getPermissionsFingerprint: () => "permissions",
        },
        userId: "user1",
        linkId: "link1",
        organizationId: "org1",
        botToken: "token",
        assistantEnabled: true,
      }) as unknown as Awaited<ReturnType<typeof resolveSlackAssistantTarget>>,
  );
});

it.each([
  "Your plan does not support AI features.",
  "AI is enabled, but no usable AI provider API key is configured. An admin can add one in GrowthBook → Settings → AI & Prompts.",
  "Over AI usage limits",
])("preserves the specific AI access failure: %s", async (message) => {
  jest
    .mocked(runAgentTurnToCompletion)
    .mockResolvedValue({ ok: false, message });
  await handleSlackAssistantMention({
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    text: "What experiments are running?",
    messageTs: "123.456",
  });
  expect(postSlackMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: message.replace(/&/g, "&amp;") }),
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
    message: "Limit reached",
  });
  await handleSlackAssistantConfirmation(input);
  expect(claim).not.toHaveBeenCalled();
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
  jest.mocked(claim).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
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
    expect(claim).not.toHaveBeenCalled();
  },
);
it.each([thread, null])(
  "sends an unlinked user a private signed URL and asks them to resend: %p",
  async (existingThread) => {
    getThread.mockResolvedValueOnce(existingThread);
    jest.mocked(resolveSlackAssistantTarget).mockResolvedValueOnce({
      ok: false,
      reason: "not_linked",
      organizationId: "org1",
      botToken: "token",
      message: "Link your account.",
    });
    const mention = {
      teamId: "T1",
      channelId: "C1",
      slackUserId: "U1",
      text: "What experiments are running?",
      messageTs: "123.456",
    };
    await handleSlackAssistantMention(mention);
    expect(postSlackEphemeralMessage).toHaveBeenCalledWith({
      token: "token",
      channel: "C1",
      user: "U1",
      threadTs: undefined,
      text: expect.stringContaining("After linking, send your question again."),
    });
    const prompt = jest.mocked(postSlackEphemeralMessage).mock.calls[0][0].text;
    const url = prompt.match(/<([^|]+)\|Link my account>/)?.[1];
    expect(url).toBeDefined();
    const state = new URL(url || "").searchParams.get("state") || "";
    expect(verifySlackLinkState(state)).toMatchObject({
      slackTeamId: "T1",
      slackUserId: "U1",
    });
    expect(postSlackMessage).not.toHaveBeenCalled();
    expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
  },
);

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
      channel: "D1",
      user: "U1",
      text: expect.stringContaining("Link or replace your GrowthBook account."),
    }),
  );
  expect(postSlackMessage).not.toHaveBeenCalled();
  expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
});

it.each(["C1", "G1", "D1"])(
  "answers in %s using the workspace organization without a channel binding",
  async (channelId) => {
    getThread.mockResolvedValue(null);
    jest.mocked(runAgentTurnToCompletion).mockResolvedValue({
      ok: true,
      conversationId,
      reply: "Answer",
      pendingAction: null,
    });
    await handleSlackAssistantMention({
      teamId: "T1",
      channelId,
      slackUserId: "U1",
      text: "<@BOT> What experiments are running?",
      messageTs: "123.456",
      botUserId: "BOT",
    });
    expect(resolveSlackAssistantTarget).toHaveBeenCalledWith({
      teamId: "T1",
      slackUserId: "U1",
      requireAssistantEnabled: true,
      organizationId: undefined,
    });
    expect(runAgentTurnToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          message: "What experiments are running?",
        }),
      }),
    );
    expect(postSlackMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        channel: channelId,
        threadTs: "123.456",
        text: "Answer",
      }),
    );
  },
);
it("replaces the thinking placeholder with the answer", async () => {
  jest.mocked(postSlackMessage).mockResolvedValueOnce("999.111");
  jest.mocked(updateSlackMessage).mockResolvedValueOnce(true);
  jest.mocked(runAgentTurnToCompletion).mockResolvedValue({
    ok: true,
    conversationId,
    reply: "Answer",
    pendingAction: null,
  });
  await handleSlackAssistantMention({
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    text: "Question",
    messageTs: "123.456",
  });
  expect(updateSlackMessage).toHaveBeenCalledWith(
    expect.objectContaining({ ts: "999.111", text: "Answer" }),
  );
  expect(postSlackMessage).toHaveBeenCalledTimes(1);
});

it("propagates exhausted reply retries without rerunning the agent or retrying a fallback", async () => {
  const error = new SlackRateLimitError("chat.update");
  jest.mocked(postSlackMessage).mockResolvedValueOnce("999.111");
  jest.mocked(updateSlackMessage).mockRejectedValueOnce(error);
  jest.mocked(runAgentTurnToCompletion).mockResolvedValue({
    ok: true,
    conversationId,
    reply: "Answer",
    pendingAction: null,
  });
  await expect(
    handleSlackAssistantMention({
      teamId: "T1",
      channelId: "C1",
      slackUserId: "U1",
      text: "Question",
      messageTs: "123.456",
    }),
  ).rejects.toBe(error);
  expect(runAgentTurnToCompletion).toHaveBeenCalledTimes(1);
  expect(updateSlackMessage).toHaveBeenCalledTimes(1);
  expect(postSlackMessage).toHaveBeenCalledTimes(1);
});

it("propagates exhausted confirmation delivery retries without rerunning the turn", async () => {
  const error = new SlackRateLimitError("chat.postMessage");
  jest.mocked(postSlackMessage).mockRejectedValueOnce(error);
  jest.mocked(runAgentTurnToCompletion).mockResolvedValue({
    ok: true,
    conversationId,
    reply: "Done",
    pendingAction: null,
  });
  await expect(
    handleSlackAssistantConfirmation({
      teamId: "T1",
      channelId: "C1",
      slackUserId: "U1",
      conversationId,
      actionId: "first",
      decision: "confirm",
      threadTs: "123.456",
    }),
  ).rejects.toBe(error);
  expect(runAgentTurnToCompletion).toHaveBeenCalledTimes(1);
  expect(postSlackMessage).toHaveBeenCalledTimes(1);
});

it("acknowledges a waiting message and hands its placeholder to the retry", async () => {
  jest.mocked(postSlackMessage).mockResolvedValueOnce("999.111");
  acquireThreadLease.mockResolvedValueOnce(null);
  const attempt = handleSlackAssistantMention({
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    text: "Question",
    messageTs: "123.456",
  });
  await expect(attempt).rejects.toBeInstanceOf(SlackThreadBusyError);
  await expect(attempt).rejects.toMatchObject({ placeholderTs: "999.111" });
  expect(postSlackMessage).toHaveBeenCalledWith(
    expect.objectContaining({ text: "_Thinking…_", threadTs: "123.456" }),
  );
  expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
  expect(releaseThreadLease).not.toHaveBeenCalled();
});

it("a retry reuses its placeholder and releases the thread afterwards", async () => {
  jest.mocked(updateSlackMessage).mockResolvedValueOnce(true);
  jest.mocked(runAgentTurnToCompletion).mockResolvedValueOnce({
    ok: true,
    conversationId,
    reply: "Answer",
    pendingAction: null,
  });
  await handleSlackAssistantMention({
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    text: "Question",
    messageTs: "123.456",
    placeholderTs: "999.111",
  });
  expect(postSlackMessage).not.toHaveBeenCalled();
  expect(updateSlackMessage).toHaveBeenCalledWith(
    expect.objectContaining({ ts: "999.111", text: "Answer" }),
  );
  expect(releaseThreadLease).toHaveBeenCalledWith(
    expect.stringMatching(/^thread:/),
    "turn",
  );
});

it("replaces the placeholder with a timeout notice when the deadline passes mid-turn", async () => {
  jest.mocked(postSlackMessage).mockResolvedValueOnce("999.111");
  jest.mocked(updateSlackMessage).mockResolvedValueOnce(true);
  acquireThreadLease.mockResolvedValueOnce({
    token: "turn",
    expiresAt: new Date(0),
  });
  jest.mocked(runAgentTurnToCompletion).mockImplementationOnce(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      ok: true,
      conversationId,
      reply: "Late answer",
      pendingAction: null,
    };
  });
  await handleSlackAssistantMention({
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    text: "Question",
    messageTs: "123.456",
  });
  expect(updateSlackMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ts: "999.111",
      text: expect.stringContaining("timed out"),
    }),
  );
  expect(releaseThreadLease).toHaveBeenCalledWith(
    expect.stringMatching(/^thread:/),
    "turn",
  );
});

it("defers a confirmation while another turn holds the thread", async () => {
  acquireThreadLease.mockResolvedValueOnce(null);
  await expect(
    handleSlackAssistantConfirmation({
      teamId: "T1",
      channelId: "C1",
      slackUserId: "U1",
      conversationId,
      actionId: "first",
      decision: "confirm",
      threadTs: "123.456",
    }),
  ).rejects.toBeInstanceOf(SlackThreadBusyError);
  expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
  expect(claim).not.toHaveBeenCalled();
});
