import type { ReqContext } from "back-end/types/request";
import {
  runAgentTurnToCompletion,
  AgentConfig,
} from "back-end/src/enterprise/services/agent-handler";
import {
  LocalConversationBuffer,
  loadOrInitConversation,
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
  checkAIEnabled: jest.fn().mockResolvedValue({ ok: true }),
  checkAccessGates: jest.fn().mockResolvedValue({ ok: true }),
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
    ).toEqual({ ok: false, status: 500, message: "Provider failed" });
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
