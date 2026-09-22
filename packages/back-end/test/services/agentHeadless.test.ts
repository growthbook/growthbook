import { dispatchInternal } from "back-end/src/agent/dispatcher";
import {
  assertAIEnabled,
  assertAIAccess,
} from "back-end/src/enterprise/services/ai-access";
import type { ReqContext } from "back-end/types/request";
import {
  runAgentTurnToCompletion,
  AgentConfig,
} from "back-end/src/enterprise/services/agent-handler";
import {
  LocalConversationBuffer,
  loadOrInitConversation,
  persistConversation,
} from "back-end/src/enterprise/services/conversation-buffer";
import { streamingChatCompletion } from "back-end/src/enterprise/services/ai";

jest.mock("back-end/src/agent/dispatcher", () => ({
  dispatchInternal: jest.fn(),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getAISettingsForOrg: jest
    .fn()
    .mockResolvedValue({ defaultAIModel: "gpt-4o" }),
  getAllowedAIModel: jest.fn(),
}));
jest.mock("back-end/src/enterprise/services/ai", () => ({
  streamingChatCompletion: jest.fn(),
}));
jest.mock("back-end/src/enterprise/services/ai-access", () => ({
  assertAIEnabled: jest.fn(),
  assertAIAccess: jest.fn(),
  buildSystemPromptForRequest: jest.fn().mockResolvedValue({ system: "test" }),
}));
jest.mock("back-end/src/enterprise/services/conversation-buffer", () => ({
  ...jest.requireActual("back-end/src/enterprise/services/conversation-buffer"),
  loadOrInitConversation: jest.fn(),
  persistConversation: jest.fn().mockResolvedValue(undefined),
}));

const context = {
  userId: "user1",
  models: { aiConversations: { getById: jest.fn().mockResolvedValue(null) } },
} as unknown as ReqContext;
const config = {
  agentType: "slack",
  promptType: "general-agent",
  parseParams: () => ({}),
  buildSystemPrompt: async () => "test",
  buildTools: () => ({}),
} as AgentConfig<Record<string, never>>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadOrInitConversation).mockResolvedValue(
    new LocalConversationBuffer("conv_test", {
      messages: [
        {
          id: "old",
          role: "assistant",
          ts: 1,
          content: [{ type: "text", text: "Previous answer" }],
        },
      ],
      isStreaming: false,
      lastStreamedAt: 0,
      title: "Existing conversation",
      agentType: "slack",
    }),
  );
});

it.each([false, true])(
  "does not report a stream error as success (throw=%s)",
  async (throws) => {
    jest.mocked(streamingChatCompletion).mockResolvedValue({
      result: {
        fullStream: (async function* () {
          if (throws) throw new Error("Provider failed");
          yield { type: "error", error: new Error("Provider failed") };
        })(),
        response: Promise.resolve({}),
      },
      completeAccounting: async () => undefined,
    } as unknown as Awaited<ReturnType<typeof streamingChatCompletion>>);
    expect(
      await runAgentTurnToCompletion({
        context,
        config,
        input: { message: "Next question", conversationId: "conv_test" },
      }),
    ).toEqual({
      ok: false,
      // Raw provider errors are logged, never shown to the user.
      message: "The assistant ran into an unexpected error. Please try again.",
    });
  },
);

it("does not recycle an earlier answer when the new turn has no text", async () => {
  jest.mocked(streamingChatCompletion).mockResolvedValue({
    result: { fullStream: [], response: Promise.resolve({}) },
    completeAccounting: async () => undefined,
  } as unknown as Awaited<ReturnType<typeof streamingChatCompletion>>);
  expect(
    await runAgentTurnToCompletion({
      context,
      config,
      input: { message: "Next question", conversationId: "conv_test" },
    }),
  ).toMatchObject({ ok: true, reply: "" });
});

it.each([assertAIEnabled, assertAIAccess])(
  "does not consume approval on a failed gate and permits a retry",
  async (gate) => {
    const buffer = await loadOrInitConversation(
      context.models.aiConversations,
      "conv_test",
      "user1",
      "slack",
    );
    buffer.setPendingAction({
      id: "action",
      method: "POST",
      path: "/features",
      summary: "Create feature",
      createdAt: Date.now(),
    });
    const beforeResolvePendingAction = jest.fn().mockResolvedValue(undefined);
    const input = {
      message: "",
      conversationId: "conv_test",
      confirmActionId: "action",
      confirmDecision: "confirm" as const,
    };
    jest.mocked(gate).mockRejectedValueOnce(new Error("Limit reached"));
    expect(
      await runAgentTurnToCompletion({
        context,
        config,
        input,
        beforeResolvePendingAction,
      }),
    ).toEqual({ ok: false, message: "Limit reached" });
    expect(beforeResolvePendingAction).not.toHaveBeenCalled();
    expect(buffer.getPendingAction()?.id).toBe("action");
    jest.mocked(dispatchInternal).mockResolvedValue({ status: 200, body: {} });
    await runAgentTurnToCompletion({
      context,
      config,
      input,
      beforeResolvePendingAction,
    });
    expect(beforeResolvePendingAction).toHaveBeenCalledTimes(1);
    expect(dispatchInternal).toHaveBeenCalledTimes(1);
  },
);

it("leaves pending approval unmodified when the replay guard refuses dispatch", async () => {
  const buffer = await loadOrInitConversation(
    context.models.aiConversations,
    "conv_test",
    "user1",
    "slack",
  );
  buffer.setPendingAction({
    id: "action",
    method: "POST",
    path: "/features",
    summary: "Create feature",
    createdAt: Date.now(),
  });
  const beforeResolvePendingAction = jest
    .fn()
    .mockRejectedValue(new Error("Already claimed"));
  await expect(
    runAgentTurnToCompletion({
      context,
      config,
      input: {
        message: "",
        conversationId: "conv_test",
        confirmActionId: "action",
        confirmDecision: "confirm",
      },
      beforeResolvePendingAction,
    }),
  ).rejects.toThrow("Already claimed");
  expect(buffer.getPendingAction()?.id).toBe("action");
  expect(dispatchInternal).not.toHaveBeenCalled();
  expect(persistConversation).not.toHaveBeenCalled();
});

it("treats an aborted deadline like a cancelled stream and skips the final save", async () => {
  const deadline = new AbortController();
  jest
    .mocked(streamingChatCompletion)
    .mockImplementationOnce(async ({ abortSignal }) => {
      deadline.abort();
      expect(abortSignal?.aborted).toBe(true);
      return {
        result: { fullStream: [], response: Promise.resolve({}) },
        completeAccounting: async () => undefined,
      } as unknown as Awaited<ReturnType<typeof streamingChatCompletion>>;
    });
  expect(
    await runAgentTurnToCompletion({
      context,
      config,
      signal: deadline.signal,
      input: { message: "hello", conversationId: "conv_test" },
    }),
  ).toMatchObject({ ok: true, reply: "" });
  expect(persistConversation).toHaveBeenCalledTimes(1);
});
