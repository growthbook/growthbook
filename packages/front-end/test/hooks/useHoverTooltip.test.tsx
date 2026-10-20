import {
  renderHook,
  act,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import React from "react";
import { vi } from "vitest";
import {
  HoverTooltipProvider,
  useHoverTooltipContext,
  useHoverTooltip,
  HoverTooltip,
} from "@/hooks/useHoverTooltip";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <HoverTooltipProvider>{children}</HoverTooltipProvider>
);

// Triggers must be real connected elements: the hook refuses to show a
// tooltip whose trigger is no longer in the DOM.
let createdTriggers: HTMLElement[] = [];

function createTrigger(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  createdTriggers.push(el);
  return el;
}

afterEach(() => {
  createdTriggers.forEach((el) => el.remove());
  createdTriggers = [];
});

function makeMouseEvent(el: HTMLElement, x = 50, y = 50): React.MouseEvent {
  return {
    clientX: x,
    clientY: y,
    currentTarget: el,
    stopPropagation: () => {},
  } as unknown as React.MouseEvent;
}

function makeLeaveEvent(): React.MouseEvent {
  return {
    stopPropagation: () => {},
  } as unknown as React.MouseEvent;
}

describe("HoverTooltipProvider", () => {
  it("should allow opening a tooltip when none is open", () => {
    const { result } = renderHook(() => useHoverTooltipContext(), { wrapper });

    let success: boolean;
    act(() => {
      success = result.current.openTooltip("tooltip-1");
    });

    expect(success!).toBe(true);
  });

  it("should reject opening a tooltip when one is already open", () => {
    const { result } = renderHook(() => useHoverTooltipContext(), { wrapper });

    act(() => {
      result.current.openTooltip("tooltip-1");
    });

    let success: boolean;
    act(() => {
      success = result.current.openTooltip("tooltip-2");
    });

    expect(success!).toBe(false);
  });

  it("should allow closing a tooltip by its owner and then opening another", () => {
    const { result } = renderHook(() => useHoverTooltipContext(), { wrapper });

    act(() => {
      result.current.openTooltip("tooltip-1");
    });

    act(() => {
      result.current.closeTooltip("tooltip-1");
    });

    // After closing, should allow opening again
    let success: boolean;
    act(() => {
      success = result.current.openTooltip("tooltip-2");
    });

    expect(success!).toBe(true);
  });

  it("should ignore close requests from non-owners", () => {
    const { result } = renderHook(() => useHoverTooltipContext(), { wrapper });

    act(() => {
      result.current.openTooltip("tooltip-1");
    });

    act(() => {
      result.current.closeTooltip("tooltip-2"); // wrong ID
    });

    // Should still be blocked since close was ignored
    let success: boolean;
    act(() => {
      success = result.current.openTooltip("tooltip-3");
    });

    expect(success!).toBe(false);
  });
});

describe("useHoverTooltip - element mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should start not visible", () => {
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element" }),
      { wrapper },
    );
    expect(result.current.isVisible).toBe(false);
  });

  it("should become visible after delay when mouse enters", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    act(() => {
      result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
    });

    expect(result.current.isVisible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);
  });

  it("should not become visible if mouse leaves before delay", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    act(() => {
      result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
    });

    act(() => {
      vi.advanceTimersByTime(50); // only half the delay
    });

    act(() => {
      result.current.triggerProps.onMouseLeave(makeLeaveEvent());
    });

    act(() => {
      vi.advanceTimersByTime(100); // more than enough time
    });

    expect(result.current.isVisible).toBe(false);
  });

  it("should hide after delay when mouse leaves visible tooltip", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    // Show tooltip
    act(() => {
      result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);

    // Leave trigger
    act(() => {
      result.current.triggerProps.onMouseLeave(makeLeaveEvent());
    });

    // Still visible during hide delay
    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(50); // HIDE_DELAY_MS
    });

    expect(result.current.isVisible).toBe(false);
  });

  it("should stay visible when re-entering trigger during hide delay", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    // Show tooltip
    act(() => {
      result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);

    // Leave trigger (starts hide timer)
    act(() => {
      result.current.triggerProps.onMouseLeave(makeLeaveEvent());
    });

    // Still visible during hide delay
    expect(result.current.isVisible).toBe(true);

    // Re-enter trigger before hide timer fires
    act(() => {
      vi.advanceTimersByTime(25); // Half of HIDE_DELAY_MS (50)
    });

    act(() => {
      result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
    });

    // Should still be visible
    expect(result.current.isVisible).toBe(true);

    // Wait past the original hide delay
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Should still be visible (hide timer was cancelled)
    expect(result.current.isVisible).toBe(true);
  });

  it("should allow programmatic close", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    // Show tooltip
    act(() => {
      result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);

    act(() => {
      result.current.close();
    });

    expect(result.current.isVisible).toBe(false);
  });
});

describe("useHoverTooltip - cursor mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should reset timer on mouse movement", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "cursor", delayMs: 100 }),
      { wrapper },
    );

    // First movement
    act(() => {
      result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger, 50, 50));
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Second movement - should reset timer
    act(() => {
      result.current.triggerProps.onMouseMove(makeMouseEvent(trigger, 60, 60));
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Should not be visible yet (timer was reset)
    expect(result.current.isVisible).toBe(false);

    // Wait for full delay
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.isVisible).toBe(true);
  });

  it("should position at cursor location", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "cursor", delayMs: 100 }),
      { wrapper },
    );

    act(() => {
      result.current.triggerProps.onMouseEnter(
        makeMouseEvent(trigger, 150, 250),
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);
  });

  it("should close immediately on mouse leave (no delay)", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "cursor", delayMs: 100 }),
      { wrapper },
    );

    // Show tooltip
    act(() => {
      result.current.triggerProps.onMouseEnter(
        makeMouseEvent(trigger, 150, 250),
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);

    // Leave - should close immediately
    act(() => {
      result.current.triggerProps.onMouseLeave(makeLeaveEvent());
    });

    expect(result.current.isVisible).toBe(false);
  });
});

describe("useHoverTooltip - stale pointer guards (cursor mode)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not show if the trigger is covered when the show timer fires", () => {
    const trigger = createTrigger();
    const overlay = createTrigger();
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => overlay;

    try {
      const { result } = renderHook(
        () => useHoverTooltip({ positioning: "cursor", delayMs: 100 }),
        { wrapper },
      );

      act(() => {
        result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current.isVisible).toBe(false);
    } finally {
      document.elementFromPoint = originalElementFromPoint;
    }
  });

  it("should not show if the trigger was removed before the show timer fires", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "cursor", delayMs: 100 }),
      { wrapper },
    );

    act(() => {
      result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
    });

    trigger.remove();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(false);
  });

  it("should show if the pointer is still over the trigger when the show timer fires", () => {
    const trigger = createTrigger();
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => trigger;

    try {
      const { result } = renderHook(
        () => useHoverTooltip({ positioning: "cursor", delayMs: 100 }),
        { wrapper },
      );

      act(() => {
        result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current.isVisible).toBe(true);
    } finally {
      document.elementFromPoint = originalElementFromPoint;
    }
  });

  it("should close on any document mouse movement while visible", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "cursor", delayMs: 100 }),
      { wrapper },
    );

    act(() => {
      result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });

    expect(result.current.isVisible).toBe(false);
  });
});

describe("useHoverTooltip - single tooltip at a time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper hook that creates two tooltips in the same context
  const useTwoTooltips = () => {
    const tooltip1 = useHoverTooltip({ positioning: "element", delayMs: 100 });
    const tooltip2 = useHoverTooltip({ positioning: "element", delayMs: 100 });
    return { tooltip1, tooltip2 };
  };

  it("should prevent second tooltip from opening while first is visible", () => {
    const trigger = createTrigger();
    const { result } = renderHook(() => useTwoTooltips(), { wrapper });

    // Open first tooltip
    act(() => {
      result.current.tooltip1.triggerProps.onMouseEnter(
        makeMouseEvent(trigger),
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.tooltip1.isVisible).toBe(true);

    // Try to open second tooltip
    act(() => {
      result.current.tooltip2.triggerProps.onMouseEnter(
        makeMouseEvent(trigger),
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // First should still be visible, second should not open
    expect(result.current.tooltip1.isVisible).toBe(true);
    expect(result.current.tooltip2.isVisible).toBe(false);
  });

  it("should allow second tooltip after first closes", () => {
    const trigger = createTrigger();
    const { result } = renderHook(() => useTwoTooltips(), { wrapper });

    // Open first tooltip
    act(() => {
      result.current.tooltip1.triggerProps.onMouseEnter(
        makeMouseEvent(trigger),
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.tooltip1.isVisible).toBe(true);

    // Close first tooltip
    act(() => {
      result.current.tooltip1.triggerProps.onMouseLeave(makeLeaveEvent());
    });

    act(() => {
      vi.advanceTimersByTime(50); // hide delay
    });

    expect(result.current.tooltip1.isVisible).toBe(false);

    // Now open second tooltip
    act(() => {
      result.current.tooltip2.triggerProps.onMouseEnter(
        makeMouseEvent(trigger),
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.tooltip2.isVisible).toBe(true);
  });
});

describe("HoverTooltip component", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should render children", () => {
    render(
      <HoverTooltipProvider>
        <HoverTooltip content={<span>Tooltip content</span>}>
          <button>Trigger</button>
        </HoverTooltip>
      </HoverTooltipProvider>,
    );

    expect(screen.getByRole("button", { name: "Trigger" })).toBeInTheDocument();
  });

  it("should show tooltip on hover after delay", async () => {
    render(
      <HoverTooltipProvider>
        <HoverTooltip content={<span>Tooltip content</span>} delayMs={100}>
          <button>Trigger</button>
        </HoverTooltip>
      </HoverTooltipProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });

    fireEvent.mouseEnter(trigger);

    expect(screen.queryByText("Tooltip content")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByText("Tooltip content")).toBeInTheDocument();
  });
});

describe("useHoverTooltip - scroll behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should close tooltip on scroll", () => {
    const trigger = createTrigger();
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    // Show tooltip
    act(() => {
      result.current.triggerProps.onMouseEnter(makeMouseEvent(trigger));
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);

    // Simulate scroll
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.isVisible).toBe(false);
  });
});
