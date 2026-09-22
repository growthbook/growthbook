import type { MutableRefObject } from "react";
import { act, renderHook } from "@testing-library/react";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat";
import {
  TYPEWRITER_INITIAL_CHARS_PER_TICK,
  adjustRevealLengthForMarkdownLinks,
  getTypewriterCharsPerTick,
  isWaitingForMarkdownLink,
  updateArrivalRateEstimate,
  useTypewriter,
} from "@/enterprise/hooks/useAIChat/useTypewriter";

describe("updateArrivalRateEstimate", () => {
  it("moves the estimate a small step toward each tick's arrivals", () => {
    const next = updateArrivalRateEstimate(3, 53);
    expect(next).toBeGreaterThan(3);
    expect(next).toBeLessThan(5);
  });

  it("converges on a steady arrival rate", () => {
    let rate = TYPEWRITER_INITIAL_CHARS_PER_TICK;
    for (let i = 0; i < 300; i++) rate = updateArrivalRateEstimate(rate, 8);
    expect(rate).toBeCloseTo(8, 1);
  });

  it("ignores negative deltas from content replacement", () => {
    expect(updateArrivalRateEstimate(4, -100)).toBeLessThan(4);
    expect(updateArrivalRateEstimate(4, -100)).toBeGreaterThan(3.9);
  });
});

describe("getTypewriterCharsPerTick", () => {
  it("reveals at the estimated arrival rate when the buffer is on target", () => {
    const arrivalRate = 6;
    expect(
      getTypewriterCharsPerTick({
        bufferedCharacters: arrivalRate * 17,
        arrivalRate,
        hasSuccessor: false,
        streamComplete: false,
      }),
    ).toBeCloseTo(arrivalRate, 5);
  });

  it("does not surge when a chunk lands above the target buffer", () => {
    const arrivalRate = 6;
    const rate = getTypewriterCharsPerTick({
      bufferedCharacters: arrivalRate * 17 + 150,
      arrivalRate,
      hasSuccessor: false,
      streamComplete: false,
    });
    expect(rate).toBeGreaterThan(arrivalRate);
    expect(rate).toBeLessThanOrEqual(arrivalRate * 1.3);
  });

  it("slows down but never stops while the buffer refills", () => {
    const rate = getTypewriterCharsPerTick({
      bufferedCharacters: 4,
      arrivalRate: 6,
      hasSuccessor: false,
      streamComplete: false,
    });
    expect(rate).toBeGreaterThanOrEqual(1);
    expect(rate).toBeLessThan(6);
  });

  it("drains a runaway backlog instead of falling further behind", () => {
    expect(
      getTypewriterCharsPerTick({
        bufferedCharacters: 2000,
        arrivalRate: 6,
        hasSuccessor: false,
        streamComplete: false,
      }),
    ).toBeGreaterThanOrEqual(2000 / 8);
  });

  it("catches up fast when a later item is already waiting", () => {
    expect(
      getTypewriterCharsPerTick({
        bufferedCharacters: 40,
        arrivalRate: 3,
        hasSuccessor: true,
        streamComplete: false,
      }),
    ).toBe(15);
  });

  it("catches up fast once the stream has finished", () => {
    expect(
      getTypewriterCharsPerTick({
        bufferedCharacters: 90,
        arrivalRate: 3,
        hasSuccessor: false,
        streamComplete: true,
      }),
    ).toBe(30);
  });

  it("does not reveal beyond the available content", () => {
    expect(
      getTypewriterCharsPerTick({
        bufferedCharacters: 2,
        arrivalRate: 6,
        hasSuccessor: false,
        streamComplete: true,
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

  it("keeps a steady reveal rate when the provider delivers in bursts", () => {
    vi.useFakeTimers();
    const chunk = "x".repeat(150);
    const chunkIntervalMs = 600;
    let content = chunk;
    const activeTurnItemsRef: MutableRefObject<ActiveTurnItem[]> = {
      current: [{ kind: "text", id: "text-1", content }],
    };
    const { result } = renderHook(() => useTypewriter(activeTurnItemsRef));

    const revealedPerTick: number[] = [];
    let previousLength = 0;
    const totalMs = 6000;
    for (let elapsed = 30; elapsed <= totalMs; elapsed += 30) {
      if (elapsed % chunkIntervalMs === 0) {
        content += chunk;
        activeTurnItemsRef.current = [{ kind: "text", id: "text-1", content }];
      }
      act(() => {
        vi.advanceTimersByTime(30);
      });
      const length = result.current.displayedTextMap.get("text-1")?.length ?? 0;
      // Skip the warm-up while the rate estimate converges.
      if (elapsed > 1500) revealedPerTick.push(length - previousLength);
      previousLength = length;
    }

    const mean =
      revealedPerTick.reduce((sum, n) => sum + n, 0) / revealedPerTick.length;
    const variance =
      revealedPerTick.reduce((sum, n) => sum + (n - mean) ** 2, 0) /
      revealedPerTick.length;
    const coefficientOfVariation = Math.sqrt(variance) / mean;

    expect(revealedPerTick.every((n) => n > 0)).toBe(true);
    expect(coefficientOfVariation).toBeLessThan(0.35);
    // 150 chars / 20 ticks: the reveal rate should track the provider's speed.
    expect(mean).toBeGreaterThan(6);
    expect(mean).toBeLessThan(9);
  });

  it("drains the remaining buffer quickly once the stream completes", () => {
    vi.useFakeTimers();
    const activeTurnItemsRef: MutableRefObject<ActiveTurnItem[]> = {
      current: [{ kind: "text", id: "text-1", content: "x".repeat(200) }],
    };
    const streamCompleteRef = { current: false };
    const { result } = renderHook(() =>
      useTypewriter(activeTurnItemsRef, false, streamCompleteRef),
    );

    act(() => {
      vi.advanceTimersByTime(30);
    });
    const revealedBefore =
      result.current.displayedTextMap.get("text-1")?.length ?? 0;
    expect(revealedBefore).toBeLessThan(20);

    streamCompleteRef.current = true;
    act(() => {
      vi.advanceTimersByTime(30 * 8);
    });
    expect(result.current.displayedTextMap.get("text-1")).toHaveLength(200);
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
