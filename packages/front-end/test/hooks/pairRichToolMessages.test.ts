import { describe, expect, it } from "vitest";
import type { RichMessage } from "@/enterprise/hooks/useAIChat/types";
import {
  pairedToolCallForResult,
  toolCallHasPairedResult,
} from "@/enterprise/hooks/useAIChat/pairRichToolMessages";

describe("pairRichToolMessages", () => {
  const tc1: RichMessage = {
    kind: "tool-call",
    id: "1",
    toolName: "searchMetrics",
    toolCallId: "call_a",
    args: { query: "a" },
    ts: 1,
  };
  const tc2: RichMessage = {
    kind: "tool-call",
    id: "2",
    toolName: "searchMetrics",
    toolCallId: "call_b",
    args: { query: "b" },
    ts: 2,
  };
  const tr1: RichMessage = {
    kind: "tool-result",
    id: "3",
    toolName: "searchMetrics",
    toolCallId: "call_a",
    summary: "s1",
    data: { x: 1 },
    ts: 3,
  };
  const tr2: RichMessage = {
    kind: "tool-result",
    id: "4",
    toolName: "searchMetrics",
    toolCallId: "call_b",
    summary: "s2",
    data: { x: 2 },
    ts: 4,
  };

  it("detects paired result when calls are grouped before results", () => {
    const messages: RichMessage[] = [tc1, tc2, tr1, tr2];
    expect(toolCallHasPairedResult(messages, 0)).toBe(true);
    expect(toolCallHasPairedResult(messages, 1)).toBe(true);
    expect(pairedToolCallForResult(messages, 2)).toEqual(tc1);
    expect(pairedToolCallForResult(messages, 3)).toEqual(tc2);
  });

  it("still pairs when tool-call and tool-result are adjacent", () => {
    const messages: RichMessage[] = [tc1, tr1];
    expect(toolCallHasPairedResult(messages, 0)).toBe(true);
    expect(pairedToolCallForResult(messages, 1)).toEqual(tc1);
  });

  it("does not pair across user turns", () => {
    const user: RichMessage = {
      kind: "user-text",
      id: "u",
      content: "hi",
      ts: 0,
    };
    const messages: RichMessage[] = [tc1, user, tr1];
    expect(toolCallHasPairedResult(messages, 0)).toBe(false);
    expect(pairedToolCallForResult(messages, 2)).toBeUndefined();
  });
});
