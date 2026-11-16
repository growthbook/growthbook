import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLocalStorage } from "@/hooks/useLocalStorage";

describe("useLocalStorage", () => {
  beforeEach(() => localStorage.clear());

  it("reads the new key's own value when the key changes", () => {
    localStorage.setItem("panel__b", "true");
    const { result, rerender } = renderHook(
      ({ k }) => useLocalStorage(k, true),
      { initialProps: { k: "panel__a" } },
    );
    act(() => result.current[1](false));
    expect(localStorage.getItem("panel__a")).toBe("false");

    rerender({ k: "panel__b" });
    expect(result.current[0]).toBe(true);
    // The old key's value isn't written over the new key's.
    expect(localStorage.getItem("panel__b")).toBe("true");
    expect(localStorage.getItem("panel__a")).toBe("false");
  });

  it("applies functional updates to the current value", () => {
    const { result } = renderHook(() => useLocalStorage("count", 1));
    act(() => result.current[1]((n) => n + 1));
    expect(result.current[0]).toBe(2);
    expect(localStorage.getItem("count")).toBe("2");
  });
});
