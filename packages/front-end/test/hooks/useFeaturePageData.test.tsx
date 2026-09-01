import { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useFeaturePageData } from "@/hooks/useFeaturePageData";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";

vi.mock("@/services/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@/services/features", () => ({ useEnvironments: vi.fn() }));

const feature = {
  id: "f1",
  version: 1,
  defaultValue: "false",
  rules: [],
  dateCreated: new Date(0),
  dateUpdated: new Date(0),
  organization: "org_1",
  prerequisites: [],
} as unknown as FeatureInterface;

function rev(
  version: number,
  overrides: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface {
  return {
    featureId: "f1",
    organization: "org_1",
    version,
    baseVersion: Math.max(1, version - 1),
    comment: "",
    createdBy: null,
    publishedBy: null,
    dateCreated: new Date(0),
    datePublished: new Date(0),
    dateUpdated: new Date(0),
    defaultValue: "false",
    rules: {},
    status: "published",
    ...overrides,
  } as unknown as FeatureRevisionInterface;
}

function basePayload(fullRevisions: FeatureRevisionInterface[]) {
  return {
    feature,
    revisionList: fullRevisions.map((r) => ({
      version: r.version,
      datePublished: r.datePublished ?? null,
      dateUpdated: r.dateUpdated,
      createdBy: r.createdBy,
      status: r.status,
      comment: r.comment || "",
    })),
    revisions: fullRevisions,
    experiments: [],
    safeRollouts: [],
    codeRefs: [],
    holdout: undefined,
    rampSchedules: [],
  };
}

describe("useFeaturePageData", () => {
  const apiCall = vi.fn();
  let resolveBase: (payload: unknown) => void;

  beforeEach(() => {
    apiCall.mockReset();
    vi.mocked(useAuth).mockReturnValue({
      apiCall,
      orgId: "org_1",
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useEnvironments).mockReturnValue([]);

    // The base feature request stays pending until the test resolves it, so
    // each test controls the cold-load ordering explicitly.
    const basePromise = new Promise((res) => {
      resolveBase = res;
    });
    apiCall.mockImplementation((url: string) => {
      if (url === "/feature/f1") return basePromise;
      if (url.startsWith("/ramp-schedule")) {
        return Promise.resolve({ status: 200, rampSchedules: [] });
      }
      if (url.startsWith("/feature/f1/revisions?versions=")) {
        const version = parseInt(url.split("versions=")[1], 10);
        return Promise.resolve({
          status: 200,
          revisions: [rev(version, { baseVersion: 1 })],
        });
      }
      throw new Error(`unexpected api call: ${url}`);
    });
  });

  const revisionFetches = () =>
    apiCall.mock.calls
      .map((c) => c[0] as string)
      .filter((url) => url.includes("/revisions?versions="));

  function render(versionQueryParam?: string) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {children}
      </SWRConfig>
    );
    return renderHook(() => useFeaturePageData("f1", versionQueryParam), {
      wrapper,
    });
  }

  const flush = () => act(async () => {});

  it("does not fetch a ?v= version that the base response already includes", async () => {
    const { result } = render("2");
    await flush();

    // Base request still in flight: no speculative revisions fetch.
    expect(revisionFetches()).toEqual([]);

    await act(async () => {
      resolveBase(basePayload([rev(1), rev(2, { status: "draft" })]));
    });
    await waitFor(() => expect(result.current.revision?.version).toBe(2));

    // The base response contained version 2, so no extra fetch at all.
    expect(revisionFetches()).toEqual([]);
  });

  it("fetches a ?v= version missing from the base response, once it can tell", async () => {
    const { result } = render("42");
    await flush();
    expect(revisionFetches()).toEqual([]);

    // Base response knows about v42 (revisionList) but only carries full
    // revisions for the recent window.
    const payload = basePayload([rev(1), rev(2)]);
    payload.revisionList.push({
      version: 42,
      datePublished: new Date(0),
      dateUpdated: new Date(0),
      createdBy: null,
      status: "published",
      comment: "",
    });
    await act(async () => {
      resolveBase(payload);
    });

    await waitFor(() => expect(result.current.revision?.version).toBe(42));
    expect(revisionFetches()).toEqual(["/feature/f1/revisions?versions=42"]);
  });

  it("still lazily fetches a selected draft's base version from outside the window", async () => {
    const { result } = render("6");
    await flush();
    expect(revisionFetches()).toEqual([]);

    // v6 is an active draft based on v2, which fell outside the full-revision
    // window; v2 must be fetched for merge/review CTAs.
    await act(async () => {
      resolveBase(
        basePayload([rev(1), rev(6, { status: "draft", baseVersion: 2 })]),
      );
    });

    await waitFor(() =>
      expect(revisionFetches()).toEqual(["/feature/f1/revisions?versions=2"]),
    );
    await waitFor(() => expect(result.current.revision?.version).toBe(6));
  });

  it("does not render live feature values under a ?v= URL while that revision is loading", async () => {
    let resolveBaseLocal!: (payload: unknown) => void;
    let resolveRev!: (payload: unknown) => void;
    const baseLocal = new Promise((res) => {
      resolveBaseLocal = res;
    });
    const revLocal = new Promise((res) => {
      resolveRev = res;
    });
    apiCall.mockReset();
    apiCall.mockImplementation((url: string) => {
      if (url === "/feature/f1") return baseLocal;
      if (url.startsWith("/ramp-schedule")) {
        return Promise.resolve({ status: 200, rampSchedules: [] });
      }
      if (url === "/feature/f1/revisions?versions=42") return revLocal;
      throw new Error(`unexpected api call: ${url}`);
    });

    const { result } = render("42");
    await flush();
    expect(result.current.feature).toBeNull();

    // Base response knows v42 exists (revisionList) but only carries full
    // revisions for the recent window, so v42's revision must be fetched.
    const payload = basePayload([rev(1), rev(2)]);
    payload.revisionList.push({
      version: 42,
      datePublished: new Date(0),
      dateUpdated: new Date(0),
      createdBy: null,
      status: "published",
      comment: "",
    });
    await act(async () => {
      resolveBaseLocal(payload);
    });
    await flush();

    // v42's revision is still in flight: the hook must not substitute the live
    // feature under the ?v=42 URL.
    expect(result.current.version).toBe(42);
    expect(result.current.revision).toBeNull();
    expect(result.current.feature).toBeNull();

    // Once v42 arrives, it renders as the historical revision.
    await act(async () => {
      resolveRev({ status: 200, revisions: [rev(42, { baseVersion: 1 })] });
    });
    await waitFor(() => expect(result.current.revision?.version).toBe(42));
  });
});
