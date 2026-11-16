import { act, renderHook } from "@testing-library/react";
import { useRatchetedMinHeight } from "@/enterprise/components/AIChat/useRatchetedMinHeight";

describe("useRatchetedMinHeight", () => {
  let notify: (() => void) | null = null;
  const disconnect = vi.fn();

  beforeEach(() => {
    notify = null;
    disconnect.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          notify = cb;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("grows to the tallest observed height, never shrinks, and resets when inactive", () => {
    const el = document.createElement("div");
    let offsetHeight = 100;
    Object.defineProperty(el, "offsetHeight", {
      get: () => offsetHeight,
      configurable: true,
    });

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useRatchetedMinHeight(active),
      { initialProps: { active: false } },
    );
    Object.defineProperty(result.current.ref, "current", {
      value: el,
      configurable: true,
    });

    rerender({ active: true });
    act(() => notify?.());
    expect(result.current.minHeight).toBe(100);

    offsetHeight = 240;
    act(() => notify?.());
    expect(result.current.minHeight).toBe(240);

    offsetHeight = 120;
    act(() => notify?.());
    expect(result.current.minHeight).toBe(240);

    rerender({ active: false });
    expect(result.current.minHeight).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
