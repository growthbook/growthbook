import type { MutableRefObject } from "react";
import { act, renderHook } from "@testing-library/react";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat";
import {
  adjustRevealLengthForMarkdownLinks,
  getTypewriterCharsPerTick,
  isWaitingForMarkdownLink,
  useTypewriter,
} from "@/enterprise/hooks/useAIChat/useTypewriter";

describe("getTypewriterCharsPerTick", () => {
  it("uses the base rate when the backlog is small", () => {
    expect(
      getTypewriterCharsPerTick({
        contentLength: 20,
        revealedLength: 12,
        hasSuccessor: false,
      }),
    ).toBe(3);
  });

  it("spreads a large backlog across several ticks instead of dumping it", () => {
    expect(
      getTypewriterCharsPerTick({
        contentLength: 92,
        revealedLength: 12,
        hasSuccessor: false,
      }),
    ).toBe(10);
  });

  it("catches up faster when a later item is already waiting", () => {
    expect(
      getTypewriterCharsPerTick({
        contentLength: 40,
        revealedLength: 0,
        hasSuccessor: true,
      }),
    ).toBe(15);
  });

  it("does not reveal beyond the available content", () => {
    expect(
      getTypewriterCharsPerTick({
        contentLength: 10,
        revealedLength: 8,
        hasSuccessor: false,
      }),
    ).toBe(2);
  });
});

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

  it("pauses links with closing brackets inside code spans", () => {
    const content = "See [`a]b`](https://example.com/a/very/long/path";

    expect(adjustRevealLengthForMarkdownLinks(content, 0, content.length)).toBe(
      4,
    );
  });

  it("matches code span delimiters by backtick run length", () => {
    const content = "See [``a`]b``](https://example.com/a/very/long/path";

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

  it("pauses at an opening bracket whose label is still streaming", () => {
    const content = "You can view it here: [Any Purch";

    expect(adjustRevealLengthForMarkdownLinks(content, 0, content.length)).toBe(
      22,
    );
  });

  it("keeps pausing when the closing bracket is the last buffered character", () => {
    const content = "You can view it here: [Any Purchases]";

    expect(adjustRevealLengthForMarkdownLinks(content, 0, content.length)).toBe(
      22,
    );
  });

  it("releases bracket text once the next character rules out a link", () => {
    const content = "Use items[0] here";

    expect(adjustRevealLengthForMarkdownLinks(content, 0, content.length)).toBe(
      content.length,
    );
  });

  it("does not hold an unclosed bracket across a line break", () => {
    const content = "Note [see\nmore";

    expect(adjustRevealLengthForMarkdownLinks(content, 0, content.length)).toBe(
      content.length,
    );
  });

  it("reveals the whole link once the label streamed in before the destination", () => {
    const partial = "You can view it here: [Any Purchases";
    const revealed = adjustRevealLengthForMarkdownLinks(
      partial,
      0,
      partial.length,
    );
    expect(revealed).toBe(22);

    const complete = `${partial}](https://example.com/metric/abc)`;
    expect(
      adjustRevealLengthForMarkdownLinks(complete, revealed, revealed + 3),
    ).toBe(complete.length);
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

  it("reports a link whose label is still streaming as waiting", () => {
    expect(isWaitingForMarkdownLink("See [Any Purch", 4)).toBe(true);
  });

  it("does not report plain bracket text as waiting", () => {
    expect(isWaitingForMarkdownLink("Use items[0] here", 9)).toBe(false);
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

  it("spreads an arriving chunk over several ticks instead of dumping it", () => {
    vi.useFakeTimers();
    const activeTurnItemsRef: MutableRefObject<ActiveTurnItem[]> = {
      current: [{ kind: "text", id: "text-1", content: "abcdefgh" }],
    };
    const { result } = renderHook(() => useTypewriter(activeTurnItemsRef));

    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(result.current.displayedTextMap.get("text-1")).toBe("abc");

    activeTurnItemsRef.current = [
      {
        kind: "text",
        id: "text-1",
        content: "abcdefgh".padEnd(67, "x"),
      },
    ];
    act(() => {
      vi.advanceTimersByTime(30);
    });
    // 64 buffered / 8 drain ticks = 8 per tick, not the whole chunk at once.
    expect(result.current.displayedTextMap.get("text-1")).toHaveLength(11);

    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(result.current.displayedTextMap.get("text-1")).toHaveLength(18);
  });

  it("holds a partially streamed link label and reveals the link atomically", () => {
    vi.useFakeTimers();
    const activeTurnItemsRef: MutableRefObject<ActiveTurnItem[]> = {
      current: [{ kind: "text", id: "text-1", content: "See [Any Purch" }],
    };
    const { result } = renderHook(() =>
      useTypewriter(activeTurnItemsRef, true),
    );

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.displayedTextMap.get("text-1")).toBe("See ");

    const complete = "See [Any Purchases](https://example.com/metric/abc)";
    activeTurnItemsRef.current = [
      { kind: "text", id: "text-1", content: complete },
    ];
    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(result.current.displayedTextMap.get("text-1")).toBe(complete);
  });
});
