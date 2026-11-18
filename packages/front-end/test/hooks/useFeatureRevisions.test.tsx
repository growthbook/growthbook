import { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useFeatureRevisions } from "@/hooks/useFeatureRevisions";
import {
  FeatureRevisionsContext,
  FeatureRevisionsContextValue,
} from "@/contexts/FeatureRevisionsContext";
import { useAuth } from "@/services/auth";

vi.mock("@/services/auth", () => ({ useAuth: vi.fn() }));

const rev = (version: number) =>
  ({ featureId: "f1", version, status: "draft" }) as FeatureRevisionInterface;

describe("useFeatureRevisions", () => {
  const apiCall = vi.fn();
  beforeEach(() => {
    apiCall.mockReset();
    apiCall.mockResolvedValue({ status: 200, revisions: [rev(9)] });
    vi.mocked(useAuth).mockReturnValue({
      apiCall,
      orgId: "org_1",
    } as unknown as ReturnType<typeof useAuth>);
  });

  const render = (ctx: FeatureRevisionsContextValue | null) =>
    renderHook(() => useFeatureRevisions("f1", [1, 9, null]), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <FeatureRevisionsContext.Provider value={ctx}>
            {children}
          </FeatureRevisionsContext.Provider>
        </SWRConfig>
      ),
    });

  it("on the flag page, loads what's missing into the page's cache", async () => {
    const loadRevisions = vi.fn().mockResolvedValue(undefined);
    const { result } = render({
      revisions: [rev(1)],
      baseFeature: {} as FeatureInterface,
      currentVersion: 1,
      loadRevisions,
      unavailableVersions: new Set(),
    });
    await waitFor(() => expect(loadRevisions).toHaveBeenCalledWith([9]));
    expect(apiCall).not.toHaveBeenCalled();
    expect(result.current.get(1)?.version).toBe(1);
    expect(result.current.isLoading(9)).toBe(true);
  });

  it("elsewhere, fetches what it needs itself", async () => {
    const { result } = render(null);
    await waitFor(() => expect(result.current.get(9)?.version).toBe(9));
    expect(apiCall.mock.calls[0][0]).toBe("/feature/f1/revisions?versions=1,9");
    expect(result.current.isUnavailable(1)).toBe(true);
  });

  it("elsewhere, reports a failed load as unavailable rather than loading", async () => {
    apiCall.mockRejectedValue(new Error("network"));
    const { result } = render(null);
    await waitFor(() => expect(result.current.isUnavailable(9)).toBe(true));
    expect(result.current.loading).toBe(false);
  });
});
