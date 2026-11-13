import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useDebouncedValue from "@/hooks/useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function render(key: string, value: { v: string }) {
    return renderHook(
      (props) => useDebouncedValue(props.key, props.value, 500),
      {
        initialProps: { key, value },
      },
    );
  }

  it("returns the first value immediately", () => {
    const first = { v: "a" };
    const { result } = render("a", first);
    expect(result.current).toBe(first);
  });

  it("waits for the key to stop changing", () => {
    const first = { v: "a" };
    const { result, rerender } = render("a", first);

    rerender({ key: "ab", value: { v: "ab" } });
    act(() => vi.advanceTimersByTime(300));
    rerender({ key: "abc", value: { v: "abc" } });
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe(first);

    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toEqual({ v: "abc" });
  });

  it("keeps the same object while the key is unchanged", () => {
    const first = { v: "a" };
    const { result, rerender } = render("a", first);
    rerender({ key: "a", value: { v: "a" } });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(first);
  });
});
