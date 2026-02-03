// packages/front-end/test/hooks/useHoverTooltip.test.tsx
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
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    act(() => {
      result.current.triggerProps.onMouseEnter({
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 100,
            top: 200,
            width: 50,
            height: 20,
          }),
        },
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    });

    expect(result.current.isVisible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);
  });

  it("should not become visible if mouse leaves before delay", () => {
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    act(() => {
      result.current.triggerProps.onMouseEnter({
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 100,
            top: 200,
            width: 50,
            height: 20,
          }),
        },
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    });

    act(() => {
      vi.advanceTimersByTime(50); // only half the delay
    });

    act(() => {
      result.current.triggerProps.onMouseLeave({
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    });

    act(() => {
      vi.advanceTimersByTime(100); // more than enough time
    });

    expect(result.current.isVisible).toBe(false);
  });

  it("should hide after delay when mouse leaves visible tooltip", () => {
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    // Show tooltip
    act(() => {
      result.current.triggerProps.onMouseEnter({
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 100,
            top: 200,
            width: 50,
            height: 20,
          }),
        },
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);

    // Leave trigger
    act(() => {
      result.current.triggerProps.onMouseLeave({
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    });

    // Still visible during hide delay
    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(50); // HIDE_DELAY_MS
    });

    expect(result.current.isVisible).toBe(false);
  });

  it("should stay visible when re-entering trigger during hide delay", () => {
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    const mockEnterEvent = {
      currentTarget: {
        getBoundingClientRect: () => ({
          left: 100,
          top: 200,
          width: 50,
          height: 20,
        }),
      },
      stopPropagation: () => {},
    } as unknown as React.MouseEvent;

    const mockLeaveEvent = {
      stopPropagation: () => {},
    } as unknown as React.MouseEvent;

    // Show tooltip
    act(() => {
      result.current.triggerProps.onMouseEnter(mockEnterEvent);
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);

    // Leave trigger (starts hide timer)
    act(() => {
      result.current.triggerProps.onMouseLeave(mockLeaveEvent);
    });

    // Still visible during hide delay
    expect(result.current.isVisible).toBe(true);

    // Re-enter trigger before hide timer fires
    act(() => {
      vi.advanceTimersByTime(25); // Half of HIDE_DELAY_MS (50)
    });

    act(() => {
      result.current.triggerProps.onMouseEnter(mockEnterEvent);
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
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    // Show tooltip
    act(() => {
      result.current.triggerProps.onMouseEnter({
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 100,
            top: 200,
            width: 50,
            height: 20,
          }),
        },
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
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
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "cursor", delayMs: 100 }),
      { wrapper },
    );

    const mockEvent = (x: number, y: number) =>
      ({
        clientX: x,
        clientY: y,
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: 200,
            height: 200,
          }),
        },
        stopPropagation: () => {},
      }) as unknown as React.MouseEvent;

    // First movement
    act(() => {
      result.current.triggerProps.onMouseEnter(mockEvent(50, 50));
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Second movement - should reset timer
    act(() => {
      result.current.triggerProps.onMouseMove(mockEvent(60, 60));
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
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "cursor", delayMs: 100 }),
      { wrapper },
    );

    act(() => {
      result.current.triggerProps.onMouseEnter({
        clientX: 150,
        clientY: 250,
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: 200,
            height: 200,
          }),
        },
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);
  });

  it("should close immediately on mouse leave (no delay)", () => {
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "cursor", delayMs: 100 }),
      { wrapper },
    );

    // Show tooltip
    act(() => {
      result.current.triggerProps.onMouseEnter({
        clientX: 150,
        clientY: 250,
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: 200,
            height: 200,
          }),
        },
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isVisible).toBe(true);

    // Leave - should close immediately
    act(() => {
      result.current.triggerProps.onMouseLeave({
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
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
    const { result } = renderHook(() => useTwoTooltips(), { wrapper });

    const mockEnterEvent = {
      currentTarget: {
        getBoundingClientRect: () => ({
          left: 100,
          top: 200,
          width: 50,
          height: 20,
        }),
      },
      stopPropagation: () => {},
    } as unknown as React.MouseEvent;

    // Open first tooltip
    act(() => {
      result.current.tooltip1.triggerProps.onMouseEnter(mockEnterEvent);
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.tooltip1.isVisible).toBe(true);

    // Try to open second tooltip
    act(() => {
      result.current.tooltip2.triggerProps.onMouseEnter(mockEnterEvent);
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // First should still be visible, second should not open
    expect(result.current.tooltip1.isVisible).toBe(true);
    expect(result.current.tooltip2.isVisible).toBe(false);
  });

  it("should allow second tooltip after first closes", () => {
    const { result } = renderHook(() => useTwoTooltips(), { wrapper });

    const mockEnterEvent = {
      currentTarget: {
        getBoundingClientRect: () => ({
          left: 100,
          top: 200,
          width: 50,
          height: 20,
        }),
      },
      stopPropagation: () => {},
    } as unknown as React.MouseEvent;

    const mockLeaveEvent = {
      stopPropagation: () => {},
    } as unknown as React.MouseEvent;

    // Open first tooltip
    act(() => {
      result.current.tooltip1.triggerProps.onMouseEnter(mockEnterEvent);
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.tooltip1.isVisible).toBe(true);

    // Close first tooltip
    act(() => {
      result.current.tooltip1.triggerProps.onMouseLeave(mockLeaveEvent);
    });

    act(() => {
      vi.advanceTimersByTime(50); // hide delay
    });

    expect(result.current.tooltip1.isVisible).toBe(false);

    // Now open second tooltip
    act(() => {
      result.current.tooltip2.triggerProps.onMouseEnter(mockEnterEvent);
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
    const { result } = renderHook(
      () => useHoverTooltip({ positioning: "element", delayMs: 100 }),
      { wrapper },
    );

    // Show tooltip
    act(() => {
      result.current.triggerProps.onMouseEnter({
        currentTarget: {
          getBoundingClientRect: () => ({
            left: 100,
            top: 200,
            width: 50,
            height: 20,
          }),
        },
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
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
