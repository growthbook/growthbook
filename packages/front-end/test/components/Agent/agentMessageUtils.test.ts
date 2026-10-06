import type { AIChatMessage } from "shared/ai-chat";
import { classifyTurn } from "@/components/Agent/agentMessageUtils";

describe("classifyTurn", () => {
  it("preserves the error state of the final assistant message", () => {
    const messages: AIChatMessage[] = [
      {
        role: "assistant",
        id: "error-1",
        ts: 1,
        content:
          "The assistant ran into an unexpected error. Please try again.",
        isError: true,
      },
    ];

    expect(classifyTurn(messages)).toMatchObject({
      replyContent:
        "The assistant ran into an unexpected error. Please try again.",
      replyMessageId: "error-1",
      replyIsError: true,
    });
  });

  it("does not mark an ordinary assistant reply as an error", () => {
    const messages: AIChatMessage[] = [
      {
        role: "assistant",
        id: "reply-1",
        ts: 1,
        content: "Your dashboard has 6 metrics.",
      },
    ];

    expect(classifyTurn(messages).replyIsError).toBe(false);
  });

  it("keeps text before an askUser call in pre-work", () => {
    const messages: AIChatMessage[] = [
      {
        role: "assistant",
        id: "question-preamble",
        ts: 1,
        content: [
          {
            type: "text",
            text: "Let me get some direction on where you're starting from.",
          },
          {
            type: "tool-call",
            toolCallId: "ask-1",
            toolName: "askUser",
            args: {
              question: "Where are you starting from?",
              options: [],
            },
          },
        ],
      },
      {
        role: "tool",
        id: "question-result",
        ts: 2,
        content: [
          {
            type: "tool-result",
            toolCallId: "ask-1",
            toolName: "askUser",
            result: '{"status":"asked"}',
          },
        ],
      },
    ];

    expect(classifyTurn(messages)).toMatchObject({
      preWork: messages,
      replyContent: null,
      replyMessageId: null,
    });
  });

  it("keeps confirmation preambles in pre-work while awaiting a decision", () => {
    const messages: AIChatMessage[] = [
      {
        role: "assistant",
        id: "confirmation-preamble",
        ts: 1,
        content: "I am ready to update the experiment.",
      },
    ];

    expect(classifyTurn(messages, true)).toMatchObject({
      preWork: messages,
      replyContent: null,
      replyMessageId: null,
    });
  });
});
