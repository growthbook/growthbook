import { act, renderHook } from "@testing-library/react";
import type { NextRouter } from "next/router";
import { useSessionReplayFilters } from "@/hooks/useSessionReplayFilters";

function fakeRouter(query: Record<string, string> = {}): NextRouter {
  return { query, push: vi.fn() } as unknown as NextRouter;
}

describe("useSessionReplayFilters", () => {
  it("reports an exclusion the API cannot express", () => {
    const { result } = renderHook(() =>
      useSessionReplayFilters(fakeRouter(), ""),
    );

    act(() => result.current.setSearchValue("country:!US"));

    expect(result.current.droppedFilters.negated).toEqual(["country"]);
  });

  // The rebuilt search string drops the token, so a warning naming it would
  // point at something the input no longer shows
  it("clears the warning when the URL changes externally", () => {
    let router = fakeRouter();
    const { result, rerender } = renderHook(() =>
      useSessionReplayFilters(router, ""),
    );

    act(() => result.current.setSearchValue("country:!US"));
    expect(result.current.droppedFilters.negated).toHaveLength(1);

    // Back/forward nav to a different committed query
    router = fakeRouter({ country: "CA" });
    rerender();

    expect(result.current.droppedFilters.negated).toEqual([]);
    expect(result.current.searchInputProps.value).toBe("country:CA");
  });

  it("keeps the warning across its own commit", () => {
    const { result } = renderHook(() =>
      useSessionReplayFilters(fakeRouter(), ""),
    );

    act(() => result.current.setSearchValue("country:!US device:desktop"));

    expect(result.current.droppedFilters.negated).toEqual(["country"]);
  });
});
