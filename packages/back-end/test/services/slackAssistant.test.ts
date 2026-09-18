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
import {
  clearSlackDefaultOrganization,
  getSlackUserPreference,
  setSlackDefaultOrganization,
} from "back-end/src/services/slack/slackUserPreference";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getFeature } from "back-end/src/models/FeatureModel";
import { APP_ORIGIN } from "back-end/src/util/secrets";

jest.mock("back-end/src/enterprise/services/agent-handler", () => ({
  runAgentTurnToCompletion: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackUserPreference", () => ({
  getSlackUserPreference: jest.fn(),
  setSlackDefaultOrganization: jest.fn(),
  clearSlackDefaultOrganization: jest.fn(),
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
const choices = [
  { organizationId: "org1", name: "First", linkId: "link1" },
  { organizationId: "org2", name: "Second", linkId: "link2" },
];
const ambiguous = {
  ok: false as const,
  reason: "ambiguous_org" as const,
  message: "Choose an organization",
  botToken: "token",
  choices,
  targets: choices.map((choice) => ({
    ok: true as const,
    context: { org: { id: choice.organizationId } } as unknown as ApiReqContext,
    userId: "user1",
    linkId: choice.linkId,
    organizationId: choice.organizationId,
    organizationName: choice.name,
    eventWebHookId: null,
    botToken: "token",
    assistantEnabled: true,
    linkedOrganizationCount: 2,
  })),
};
const preference = (defaultOrganizationId: string) => ({
  _id: "pref",
  slackTeamId: "T1",
  slackUserId: "U1",
  defaultOrganizationId,
  dateUpdated: new Date(),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSlackThread).mockResolvedValue(thread);
  jest.mocked(pinSlackThreadOrganization).mockResolvedValue(thread);
  jest.mocked(getSlackUserPreference).mockResolvedValue(null);
  jest.mocked(getExperimentById).mockResolvedValue(null);
  jest.mocked(getFeature).mockResolvedValue(null);
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
        eventWebHookId: "webhook1",
        linkedOrganizationCount: 1,
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
  jest.mocked(getSlackThread).mockResolvedValue(null);
  jest.mocked(resolveSlackAssistantTarget).mockResolvedValue(ambiguous);
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
    remember: false,
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
  });
  const selection = {
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
    selectionId: "picker",
    organizationId: "org1",
    threadTs: "123.456",
    interactionTs: "123.999",
    remember: false,
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

describe("organization routing for a new thread with several eligible organizations", () => {
  const mention = (channelId: string, text: string) => ({
    teamId: "T1",
    channelId,
    slackUserId: "U1",
    text,
    messageTs: "123.456",
  });
  beforeEach(() => {
    jest.mocked(getSlackThread).mockResolvedValue(null);
    jest
      .mocked(pinSlackThreadOrganization)
      .mockImplementation(async (identity, organizationId) => ({
        ...thread,
        organizationId,
      }));
    jest
      .mocked(saveSlackOrganizationPicker)
      .mockImplementation(async (pending, pendingChoices) => ({
        ...thread,
        channelId: pending.channelId,
        status: "pending",
        mention: pending,
        selectionId: "picker",
        choices: pendingChoices,
      }));
    jest.mocked(runAgentTurnToCompletion).mockResolvedValue({
      ok: true,
      conversationId,
      reply: "Answer",
      pendingAction: null,
    });
  });
  const expectPicker = () => {
    expect(resolveSlackAssistantTarget).toHaveBeenCalledTimes(1);
    expect(saveSlackOrganizationPicker).toHaveBeenCalled();
    expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
  };
  const expectRoutedTo = (organizationId: string) => {
    expect(resolveSlackAssistantTarget).toHaveBeenCalledTimes(2);
    expect(resolveSlackAssistantTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId }),
    );
    expect(saveSlackOrganizationPicker).not.toHaveBeenCalled();
    expect(runAgentTurnToCompletion).toHaveBeenCalledTimes(1);
  };

  it("routes to the one organization that owns a linked experiment", async () => {
    jest
      .mocked(resolveSlackAssistantTarget)
      .mockResolvedValueOnce(ambiguous)
      .mockResolvedValueOnce(ambiguous.targets[1]);
    jest
      .mocked(getExperimentById)
      .mockImplementation(async (context, id) =>
        context.org.id === "org2" && id === "exp_1"
          ? ({ id } as Awaited<ReturnType<typeof getExperimentById>>)
          : null,
      );
    await handleSlackAssistantMention(
      mention("C1", `how is <${APP_ORIGIN}/experiment/exp_1> doing?`),
    );
    expectRoutedTo("org2");
    expect(runAgentTurnToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ context: ambiguous.targets[1].context }),
    );
  });
  it("shows the picker when a linked feature belongs to more than one eligible organization", async () => {
    jest.mocked(resolveSlackAssistantTarget).mockResolvedValueOnce(ambiguous);
    jest
      .mocked(getFeature)
      .mockResolvedValue({ id: "flag" } as Awaited<
        ReturnType<typeof getFeature>
      >);
    await handleSlackAssistantMention(
      mention("C1", `is <${APP_ORIGIN}/features/flag|flag> on?`),
    );
    expectPicker();
  });
  it("routes to the one organization named in the message", async () => {
    jest
      .mocked(resolveSlackAssistantTarget)
      .mockResolvedValueOnce(ambiguous)
      .mockResolvedValueOnce(ambiguous.targets[1]);
    await handleSlackAssistantMention(
      mention("C1", "what is running in Second?"),
    );
    expectRoutedTo("org2");
  });
  it("applies a stored default in a direct message when it is still a choice", async () => {
    jest.mocked(getSlackUserPreference).mockResolvedValue(preference("org1"));
    jest.mocked(resolveSlackAssistantTarget).mockResolvedValueOnce(ambiguous);
    await handleSlackAssistantMention(mention("D1", "what is running?"));
    expect(getSlackUserPreference).toHaveBeenCalledWith({
      slackTeamId: "T1",
      slackUserId: "U1",
    });
    expectRoutedTo("org1");
  });
  it("shows the picker in a direct message when the stored default is no longer a choice", async () => {
    jest.mocked(getSlackUserPreference).mockResolvedValue(preference("org9"));
    jest.mocked(resolveSlackAssistantTarget).mockResolvedValueOnce(ambiguous);
    await handleSlackAssistantMention(mention("D1", "what is running?"));
    expectPicker();
  });
  it("never consults the stored default in a channel", async () => {
    jest.mocked(getSlackUserPreference).mockResolvedValue(preference("org1"));
    jest.mocked(resolveSlackAssistantTarget).mockResolvedValueOnce(ambiguous);
    await handleSlackAssistantMention(mention("C1", "what is running?"));
    expect(getSlackUserPreference).not.toHaveBeenCalled();
    expectPicker();
  });
  it("clears the stored default when a direct message says switch organization", async () => {
    await handleSlackAssistantMention(mention("D1", "Switch Organisation"));
    expect(clearSlackDefaultOrganization).toHaveBeenCalledWith({
      slackTeamId: "T1",
      slackUserId: "U1",
    });
    expect(postSlackEphemeralMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "U1",
        text: expect.stringContaining("next new message"),
      }),
    );
    expect(resolveSlackAssistantTarget).not.toHaveBeenCalled();
    expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
  });
  it("treats switch organization in a channel as an ordinary question", async () => {
    await handleSlackAssistantMention(mention("C1", "Switch Organisation"));
    expect(clearSlackDefaultOrganization).not.toHaveBeenCalled();
    expect(resolveSlackAssistantTarget).toHaveBeenCalled();
  });
  it.each([
    { linkedOrganizationCount: 2, text: "Answer\n\n_Answering as First org_" },
    { linkedOrganizationCount: 1, text: "Answer" },
  ])(
    "labels the reply with the organization only when $linkedOrganizationCount organizations are linked",
    async ({ linkedOrganizationCount, text }) => {
      const target = await resolveSlackAssistantTarget({
        teamId: "T1",
        channelId: "C1",
        slackUserId: "U1",
      });
      if (!target.ok) throw new Error("Expected a target");
      jest
        .mocked(resolveSlackAssistantTarget)
        .mockResolvedValue({ ...target, linkedOrganizationCount });
      await handleSlackAssistantMention(mention("C1", "what is running?"));
      expect(postSlackMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ text }),
      );
    },
  );
});

it("labels the approval outcome with the organization when several are linked", async () => {
  const target = await resolveSlackAssistantTarget({
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
  });
  if (!target.ok) throw new Error("Expected a target");
  jest
    .mocked(resolveSlackAssistantTarget)
    .mockResolvedValue({ ...target, linkedOrganizationCount: 2 });
  jest.mocked(runAgentTurnToCompletion).mockResolvedValue({
    ok: true,
    conversationId,
    reply: "Applied.",
    pendingAction: null,
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
  expect(postSlackMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: "Applied.\n\n_Answering as First org_" }),
  );
});

describe("remembering a picker choice for direct messages", () => {
  const selection = (channelId: string, remember: boolean) => ({
    teamId: "T1",
    channelId,
    slackUserId: "U1",
    selectionId: "picker",
    organizationId: "org1",
    threadTs: "123.456",
    interactionTs: "123.999",
    remember,
  });
  beforeEach(() => {
    jest.mocked(consumeSlackOrganizationSelection).mockResolvedValue({
      teamId: "T1",
      channelId: "C1",
      slackUserId: "U1",
      text: "Original question",
      messageTs: "123.456",
    });
    jest.mocked(runAgentTurnToCompletion).mockResolvedValue({
      ok: true,
      conversationId,
      reply: "Answer",
      pendingAction: null,
    });
  });
  it("stores the default when asked to in a direct message", async () => {
    await handleSlackOrganizationSelection(selection("D1", true));
    expect(setSlackDefaultOrganization).toHaveBeenCalledWith(
      { slackTeamId: "T1", slackUserId: "U1" },
      "org1",
    );
    expect(runAgentTurnToCompletion).toHaveBeenCalledTimes(1);
  });
  it.each([
    { channelId: "C1", remember: true },
    { channelId: "D1", remember: false },
  ])("stores nothing for %p", async ({ channelId, remember }) => {
    await handleSlackOrganizationSelection(selection(channelId, remember));
    expect(setSlackDefaultOrganization).not.toHaveBeenCalled();
    expect(runAgentTurnToCompletion).toHaveBeenCalledTimes(1);
  });
  it("stores nothing when the choice is rejected", async () => {
    jest.mocked(consumeSlackOrganizationSelection).mockResolvedValue(null);
    await handleSlackOrganizationSelection(selection("D1", true));
    expect(setSlackDefaultOrganization).not.toHaveBeenCalled();
    expect(runAgentTurnToCompletion).not.toHaveBeenCalled();
  });
});
