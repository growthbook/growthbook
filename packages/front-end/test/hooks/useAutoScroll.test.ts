import { act, renderHook } from "@testing-library/react";
import {
  getFollowScrollStep,
  useAutoScroll,
} from "@/enterprise/components/AIChat/useAutoScroll";

describe("getFollowScrollStep", () => {
  it("covers a fixed fraction of the remaining distance", () => {
    expect(getFollowScrollStep(100)).toBe(20);
  });

  it("moves at least one pixel until settled", () => {
    expect(getFollowScrollStep(3)).toBe(1);
  });

  it("closes the final sub-pixel gap exactly", () => {
    expect(getFollowScrollStep(0.4)).toBe(0.4);
    expect(getFollowScrollStep(0)).toBe(0);
  });
});

describe("useAutoScroll", () => {
  function createContainer(scrollHeight: number, clientHeight: number) {
    const container = document.createElement("div");
    let scrollTop = 0;
    Object.defineProperties(container, {
      scrollHeight: { value: scrollHeight, writable: true, configurable: true },
      clientHeight: { value: clientHeight, configurable: true },
      scrollTop: {
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(
            0,
            Math.min(value, container.scrollHeight - clientHeight),
          );
        },
        configurable: true,
      },
    });
    return container;
  }

  function renderAutoScroll(container: HTMLDivElement) {
    const hook = renderHook(
      ({
        displayedTextMap,
        conversationId,
        enabled,
      }: {
        displayedTextMap: Map<string, string>;
        conversationId: string;
        enabled: boolean;
      }) =>
        useAutoScroll({
          messages: [],
          activeTurnItems: [],
          displayedTextMap,
          conversationId,
          enabled,
        }),
      {
        initialProps: {
          displayedTextMap: new Map<string, string>(),
          conversationId: "conversation-1",
          enabled: false,
        },
      },
    );
    Object.defineProperty(hook.result.current.scrollContainerRef, "current", {
      value: container,
      configurable: true,
    });
    hook.rerender({
      displayedTextMap: new Map(),
      conversationId: "conversation-1",
      enabled: true,
    });
    return hook;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("snaps to the bottom when the conversation is first shown", () => {
    const container = createContainer(1000, 100);
    renderAutoScroll(container);

    expect(container.scrollTop).toBe(900);
  });

  it("eases toward new content across frames instead of jumping", () => {
    const container = createContainer(1000, 100);
    const { rerender } = renderAutoScroll(container);

    Object.defineProperty(container, "scrollHeight", {
      value: 1200,
      writable: true,
      configurable: true,
    });
    rerender({
      displayedTextMap: new Map([["response", "more generated text"]]),
      conversationId: "conversation-1",
      enabled: true,
    });
    expect(container.scrollTop).toBe(900);

    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(container.scrollTop).toBe(940);

    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(container.scrollTop).toBe(972);

    act(() => {
      for (let i = 0; i < 60; i++) vi.advanceTimersToNextFrame();
    });
    expect(container.scrollTop).toBe(1100);
  });

  it("ignores the scroll events produced by its own follow loop", () => {
    const container = createContainer(1000, 100);
    const { result, rerender } = renderAutoScroll(container);

    Object.defineProperty(container, "scrollHeight", {
      value: 1500,
      writable: true,
      configurable: true,
    });
    rerender({
      displayedTextMap: new Map([["response", "a large chart appeared"]]),
      conversationId: "conversation-1",
      enabled: true,
    });
    act(() => {
      vi.advanceTimersToNextFrame();
      // Still >80px from the bottom mid-animation; must not detach.
      result.current.handleScroll();
      for (let i = 0; i < 60; i++) vi.advanceTimersToNextFrame();
    });

    expect(container.scrollTop).toBe(1400);
  });

  it("stops following when the user scrolls up and resumes near the bottom", () => {
    const container = createContainer(1000, 100);
    const { result, rerender } = renderAutoScroll(container);

    act(() => {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
      container.scrollTop = 890;
      result.current.handleScroll();
    });
    Object.defineProperty(container, "scrollHeight", {
      value: 1200,
      writable: true,
      configurable: true,
    });
    rerender({
      displayedTextMap: new Map([["response", "more generated text"]]),
      conversationId: "conversation-1",
      enabled: true,
    });
    act(() => {
      for (let i = 0; i < 10; i++) vi.advanceTimersToNextFrame();
    });
    expect(container.scrollTop).toBe(890);

    act(() => {
      container.scrollTop = 1050;
      result.current.handleScroll();
    });
    rerender({
      displayedTextMap: new Map([["response", "even more generated text"]]),
      conversationId: "conversation-1",
      enabled: true,
    });
    act(() => {
      for (let i = 0; i < 60; i++) vi.advanceTimersToNextFrame();
    });
    expect(container.scrollTop).toBe(1100);
  });

  it("detaches when a scrollbar drag lands between frames", () => {
    const container = createContainer(1000, 100);
    const { rerender } = renderAutoScroll(container);

    Object.defineProperty(container, "scrollHeight", {
      value: 1500,
      writable: true,
      configurable: true,
    });
    rerender({
      displayedTextMap: new Map([["response", "more generated text"]]),
      conversationId: "conversation-1",
      enabled: true,
    });
    act(() => {
      vi.advanceTimersToNextFrame();
      container.scrollTop = 300;
      for (let i = 0; i < 10; i++) vi.advanceTimersToNextFrame();
    });

    expect(container.scrollTop).toBe(300);
  });
});
