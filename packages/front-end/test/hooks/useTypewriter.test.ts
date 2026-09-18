import type { MutableRefObject } from "react";
import { act, renderHook } from "@testing-library/react";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat";
import {
  adjustRevealLengthForMarkdownLinks,
  isWaitingForMarkdownLink,
  useTypewriter,
} from "@/enterprise/hooks/useAIChat/useTypewriter";

describe("adjustRevealLengthForMarkdownLinks", () => {
  it("leaves ordinary text reveal lengths unchanged", () => {
    expect(adjustRevealLengthForMarkdownLinks("Ordinary text", 3, 6)).toBe(6);
  });

  it("pauses before an incomplete link destination", () => {
    const content =
      "See [the exploration](https://example.com/a/very/long/path";

    expect(adjustRevealLengthForMarkdownLinks(content, 0, content.length)).toBe(
      4,
    );
  });

  it("does not move backward if link syntax was already revealed", () => {
    const content = "See [results](https://example.com/a/very/long/path";

    expect(adjustRevealLengthForMarkdownLinks(content, 8, content.length)).toBe(
      8,
    );
  });

  it("reveals a complete link atomically", () => {
    const content = "See [results](https://example.com/exploration/123)";

    expect(adjustRevealLengthForMarkdownLinks(content, 4, 7)).toBe(
      content.length,
    );
  });

  it("handles balanced parentheses in link destinations", () => {
    const content = "Open [results](https://example.com/query(foo)) next";
    const closingParenthesis = content.indexOf(" next");

    expect(adjustRevealLengthForMarkdownLinks(content, 5, 8)).toBe(
      closingParenthesis,
    );
  });

  it("pauses links with escaped closing brackets in their labels", () => {
    const content =
      "See [see \\] details](https://example.com/a/very/long/path";

    expect(adjustRevealLengthForMarkdownLinks(content, 0, content.length)).toBe(
      4,
    );
  });

  it("pauses links with nested brackets in their labels", () => {
    const content =
      "See [the [detailed] results](https://example.com/a/very/long/path";

    expect(adjustRevealLengthForMarkdownLinks(content, 0, content.length)).toBe(
      4,
    );
  });

  it("continues normally after a complete link has been revealed", () => {
    const content = "See [results](https://example.com/123) for details";

    expect(
      adjustRevealLengthForMarkdownLinks(content, 40, content.length),
    ).toBe(content.length);
  });
});

describe("isWaitingForMarkdownLink", () => {
  it("detects a link paused at the start of a response", () => {
    expect(isWaitingForMarkdownLink("[results](https://example.com", 0)).toBe(
      true,
    );
  });

  it("waits until preceding text has been revealed", () => {
    const content = "See [results](https://example.com";

    expect(isWaitingForMarkdownLink(content, 3)).toBe(false);
    expect(isWaitingForMarkdownLink(content, 4)).toBe(true);
  });

  it("does not report a completed link as waiting", () => {
    expect(isWaitingForMarkdownLink("[results](https://example.com)", 0)).toBe(
      false,
    );
  });
});

describe("useTypewriter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not update state while an incomplete link is paused", () => {
    vi.useFakeTimers();
    const activeTurnItemsRef: MutableRefObject<ActiveTurnItem[]> = {
      current: [
        {
          kind: "text",
          id: "text-1",
          content: "[results](https://example.com",
        },
      ],
    };
    const { result } = renderHook(() =>
      useTypewriter(activeTurnItemsRef, true),
    );
    const initialMap = result.current.displayedTextMap;

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.displayedTextMap).toBe(initialMap);
  });
});
