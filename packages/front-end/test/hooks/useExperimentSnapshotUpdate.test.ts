import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { useExperimentSnapshotUpdate } from "@/hooks/useExperimentSnapshotUpdate";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";

vi.mock("@/services/auth");
vi.mock("@/services/DefinitionsContext");
vi.mock("@/services/UserContext");
vi.mock("@/services/track");

const experiment = {
  id: "exp_1",
  datasource: "ds_1",
  precomputedUnitDimensionIds: [],
} as unknown as ExperimentInterfaceStringDates;

type SwrTestCacheState = {
  data?: unknown;
  error?: unknown;
  isValidating?: boolean;
  isLoading?: boolean;
};

const runningSnapshot = {
  id: "snap_running",
  organization: "org_1",
  experiment: "exp_1",
  phase: 0,
  dimension: null,
  dateCreated: new Date("2026-01-01T00:00:00Z"),
  runStarted: new Date("2026-01-01T00:00:01Z"),
  status: "running",
  settings: {
    manual: false,
    dimensions: [],
    metricSettings: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 1,
    },
    regressionAdjustmentEnabled: false,
    attributionModel: "firstExposure",
    experimentId: "exp_1",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_1",
    exposureQueryId: "eq_1",
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2026-01-02T00:00:00Z"),
    variations: [],
  },
  queries: [],
  unknownVariations: [],
  multipleExposures: 0,
  analyses: [],
  type: "standard",
} satisfies ExperimentSnapshotInterface;

describe("useExperimentSnapshotUpdate", () => {
  const apiCall = vi.fn();

  function mockApiInterruptionError(errorBody: {
    status: number;
    code: string;
    details: unknown;
    message: string;
  }) {
    apiCall.mockImplementationOnce(
      async (
        _url: string,
        _options: unknown,
        errorHandler?: (responseData: unknown) => void,
      ) => {
        errorHandler?.(errorBody);
        throw new Error(errorBody.message);
      },
    );
  }

  beforeEach(() => {
    apiCall.mockReset();
    vi.mocked(useAuth).mockReturnValue({
      apiCall,
      orgId: "org_1",
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useDefinitions).mockReturnValue({
      getDatasourceById: () => null,
    } as unknown as ReturnType<typeof useDefinitions>);
    vi.mocked(useUser).mockReturnValue({
      hasCommercialFeature: () => false,
    } as unknown as ReturnType<typeof useUser>);
  });

  function render(
    overrides: Partial<Parameters<typeof useExperimentSnapshotUpdate>[0]> = {},
  ) {
    const cache = new Map<string, SwrTestCacheState>();
    const hook = renderHook(
      () =>
        useExperimentSnapshotUpdate({
          experiment,
          phase: 0,
          mutate: vi.fn(),
          setRefreshError: vi.fn(),
          ...overrides,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(
            SWRConfig,
            { value: { provider: () => cache } },
            children,
          ),
      },
    );
    return { ...hook, cache };
  }

  it("posts immediately when there is no customValidation", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: { id: "snap_1" } });
    const { result } = render();

    await act(() => result.current.submitUpdate());

    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall.mock.calls[0][0]).toBe("/experiment/exp_1/snapshot");
  });

  it("posts when customValidation resolves true", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: { id: "snap_1" } });
    const customValidation = vi.fn().mockResolvedValue(true);
    const { result } = render({ customValidation });

    await act(() => result.current.submitUpdate());

    expect(customValidation).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("aborts without posting when customValidation resolves false", async () => {
    const customValidation = vi.fn().mockResolvedValue(false);
    const { result } = render({ customValidation });

    await act(() => result.current.submitUpdate());

    expect(customValidation).toHaveBeenCalledTimes(1);
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("runSnapshot posts the explicit dimension without customValidation", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: { id: "snap_1" } });
    const customValidation = vi.fn().mockResolvedValue(false);
    const { result } = render({ customValidation });

    await act(() => result.current.runSnapshot("country"));

    expect(customValidation).not.toHaveBeenCalled();
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall.mock.calls[0][0]).toBe("/experiment/exp_1/snapshot");
    expect(JSON.parse(apiCall.mock.calls[0][1].body)).toEqual({
      phase: 0,
      dimension: "country",
    });
  });

  it("runSnapshot appends ?force=true when force is set", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: { id: "snap_1" } });
    const { result } = render();

    await act(() => result.current.runSnapshot("", { force: true }));

    expect(apiCall.mock.calls[0][0]).toBe(
      "/experiment/exp_1/snapshot?force=true",
    );
  });

  it("runSnapshot primes the overall snapshot-summary cache from a dimension view", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: runningSnapshot });
    const { result, cache } = render({ dimension: "country" });

    await act(() => result.current.runSnapshot(""));

    const overallSummaryKey = "org_1::/experiment/exp_1/snapshot-summary/0";
    const cacheEntry = cache.get(overallSummaryKey);
    if (
      typeof cacheEntry !== "object" ||
      cacheEntry === null ||
      !("data" in cacheEntry)
    ) {
      throw new Error("Expected overall snapshot-summary cache data");
    }
    expect(cacheEntry.data).toEqual({
      latest: {
        id: "snap_running",
        status: "running",
        error: undefined,
        queries: [],
        runStarted: new Date("2026-01-01T00:00:01Z"),
        dateCreated: new Date("2026-01-01T00:00:00Z"),
        multipleExposures: 0,
        health: undefined,
        banditResult: undefined,
        type: "standard",
        triggeredBy: undefined,
      },
    });
  });

  it("surfaces a full-refresh interruption and confirms with force=true", async () => {
    mockApiInterruptionError({
      status: 409,
      code: "requires_full_refresh",
      details: { reason: "drifted" },
      message: "requires full refresh",
    });
    apiCall.mockResolvedValueOnce({ status: 200, snapshot: { id: "snap_2" } });
    const { result } = render();

    await act(async () => {
      void result.current.submitUpdate();
    });

    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(result.current.fullRefreshConfirm.open).toBe(true);
    expect(result.current.fullRefreshConfirm.reasons).toEqual(["drifted"]);

    await act(async () => {
      result.current.fullRefreshConfirm.onConfirm();
    });

    expect(apiCall).toHaveBeenCalledTimes(2);
    expect(apiCall.mock.calls[1][0]).toBe(
      "/experiment/exp_1/snapshot?force=true",
    );
    expect(result.current.fullRefreshConfirm.open).toBe(false);
  });

  it("cancelling a full-refresh interruption does not re-post", async () => {
    mockApiInterruptionError({
      status: 409,
      code: "requires_full_refresh",
      details: { reason: "drifted" },
      message: "requires full refresh",
    });
    const { result } = render();

    await act(async () => {
      void result.current.submitUpdate();
    });

    expect(result.current.fullRefreshConfirm.open).toBe(true);

    await act(async () => {
      result.current.fullRefreshConfirm.onCancel();
    });

    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(result.current.fullRefreshConfirm.open).toBe(false);
  });

  it("submitUpdate with force prompts with the given reasons and posts force=true on confirm", async () => {
    apiCall.mockResolvedValueOnce({ status: 200, snapshot: { id: "snap_3" } });
    const { result } = render();

    await act(async () => {
      void result.current.submitUpdate({
        force: true,
        fullRefreshReasons: ["Segment changed", "Attribution model changed"],
      });
    });

    expect(apiCall).not.toHaveBeenCalled();
    expect(result.current.fullRefreshConfirm.open).toBe(true);
    expect(result.current.fullRefreshConfirm.reasons).toEqual([
      "Segment changed",
      "Attribution model changed",
    ]);

    await act(async () => {
      result.current.fullRefreshConfirm.onConfirm();
    });

    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall.mock.calls[0][0]).toBe(
      "/experiment/exp_1/snapshot?force=true",
    );
    expect(result.current.fullRefreshConfirm.open).toBe(false);
  });

  it("submitUpdate with force on cancel posts nothing", async () => {
    const { result } = render();

    await act(async () => {
      void result.current.submitUpdate({
        force: true,
        fullRefreshReasons: ["Segment changed"],
      });
    });

    expect(result.current.fullRefreshConfirm.open).toBe(true);

    await act(async () => {
      result.current.fullRefreshConfirm.onCancel();
    });

    expect(apiCall).not.toHaveBeenCalled();
    expect(result.current.fullRefreshConfirm.open).toBe(false);
  });

  it("submitUpdate with force aborts when customValidation resolves false", async () => {
    const customValidation = vi.fn().mockResolvedValue(false);
    const { result } = render({ customValidation });

    await act(async () => {
      void result.current.submitUpdate({
        force: true,
        fullRefreshReasons: ["Segment changed"],
      });
    });

    expect(customValidation).toHaveBeenCalledTimes(1);
    expect(result.current.fullRefreshConfirm.open).toBe(false);
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("hands off a Dimension Results full-refresh blocker to onSnapshotRefreshBlocked", async () => {
    const blocker = {
      kind: "requires-full-refresh",
      reason: "settings drifted",
    };
    mockApiInterruptionError({
      status: 409,
      code: "requires_full_refresh",
      details: {
        reason: "settings drifted",
      },
      message: "requires full refresh",
    });
    const onSnapshotRefreshBlocked = vi.fn();
    // A non-empty dimension routes through the hand-off path rather than the
    // inline full-refresh confirm.
    const { result } = render({
      dimension: "country",
      onSnapshotRefreshBlocked,
    });

    await act(() => result.current.submitUpdate());

    expect(onSnapshotRefreshBlocked).toHaveBeenCalledTimes(1);
    expect(onSnapshotRefreshBlocked).toHaveBeenCalledWith(blocker);
    expect(result.current.fullRefreshConfirm.open).toBe(false);
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("runSnapshot returns true when the post starts a refresh", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: { id: "snap_1" } });
    const { result } = render();

    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.runSnapshot("", { force: true });
    });

    expect(started).toBe(true);
  });

  it("runSnapshot returns false when the full-refresh prompt is cancelled", async () => {
    mockApiInterruptionError({
      status: 409,
      code: "requires_full_refresh",
      details: { reason: "drifted" },
      message: "requires full refresh",
    });
    const { result } = render();

    let started: boolean | undefined;
    await act(async () => {
      void result.current.runSnapshot("").then((r) => {
        started = r;
      });
    });

    expect(result.current.fullRefreshConfirm.open).toBe(true);

    await act(async () => {
      result.current.fullRefreshConfirm.onCancel();
    });

    expect(started).toBe(false);
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("runSnapshot returns false when the post fails without a blocker", async () => {
    apiCall.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const setRefreshError = vi.fn();
    const { result } = render({ setRefreshError });

    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.runSnapshot("", { force: false });
    });

    expect(started).toBe(false);
    expect(setRefreshError).toHaveBeenCalledWith("boom");
  });
});
