import type { AIChatMessage } from "shared/ai-chat";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat/types";
import {
  classifyTurn,
  interactionContextTextId,
} from "@/components/Agent/agentMessageUtils";

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

  it("shows text before an askUser call as context, without feedback", () => {
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
      preWork: [messages[1]],
      replyContent: "Let me get some direction on where you're starting from.",
      replyMessageId: "question-preamble",
      replyAwaitsUser: true,
    });
  });

  it("shows confirmation preambles as context while awaiting a decision", () => {
    const messages: AIChatMessage[] = [
      {
        role: "assistant",
        id: "confirmation-preamble",
        ts: 1,
        content: "I am ready to update the experiment.",
      },
    ];

    expect(classifyTurn(messages, { awaitingInteraction: true })).toMatchObject(
      {
        preWork: [],
        replyContent: "I am ready to update the experiment.",
        replyMessageId: "confirmation-preamble",
        replyAwaitsUser: true,
      },
    );
  });

  it("folds everything into pre-work while a decision resumes the turn", () => {
    const messages: AIChatMessage[] = [
      {
        role: "assistant",
        id: "confirmation-preamble",
        ts: 1,
        content: "I am ready to update the experiment.",
      },
    ];

    expect(classifyTurn(messages, { continuing: true })).toMatchObject({
      preWork: messages,
      replyContent: null,
      replyMessageId: null,
      replyAwaitsUser: false,
    });
  });
});

describe("interactionContextTextId", () => {
  const text = (id: string): ActiveTurnItem => ({
    kind: "text",
    id,
    content: id,
  });
  const tool = (toolName: string): ActiveTurnItem => ({
    kind: "tool-status",
    id: `${toolName}-item`,
    toolCallId: `${toolName}-call`,
    toolName,
    label: toolName,
    status: "done",
  });

  it("pins the text leading into an askUser call", () => {
    expect(
      interactionContextTextId(
        [text("early"), tool("callApi"), text("preamble"), tool("askUser")],
        false,
      ),
    ).toBe("preamble");
  });

  it("pins the last text while a confirmation is pending", () => {
    expect(
      interactionContextTextId([text("preamble"), tool("callApi")], true),
    ).toBe("preamble");
  });

  it("pins nothing when the turn isn't waiting on the user", () => {
    expect(
      interactionContextTextId([text("preamble"), tool("callApi")], false),
    ).toBeNull();
  });
});
