import { act, renderHook } from "@testing-library/react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
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
    const hook = renderHook(() =>
      useExperimentSnapshotUpdate({
        experiment,
        phase: 0,
        mutate: vi.fn(),
        setRefreshError: vi.fn(),
        ...overrides,
      }),
    );
    return hook;
  }

  it("posts immediately when there is no customValidation", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: { id: "snap_1" } });
    const { result } = render();

    await act(() => result.current.submitUpdate());

    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall.mock.calls[0][0]).toBe("/experiment/exp_1/snapshot");
  });

  it("starts one update for two submits in the same tick", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: { id: "snap_1" } });
    const { result } = render();

    await act(() =>
      Promise.all([
        result.current.submitUpdate({ updateScope: "new_metrics" }),
        result.current.submitUpdate({ updateScope: "all_metrics" }),
      ]),
    );

    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(JSON.parse(apiCall.mock.calls[0][1].body).updateScope).toBe(
      "new_metrics",
    );
  });

  it("reports a started update and stops loading when the refetch fails", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: { id: "snap_1" } });
    const mutate = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = render({ mutate });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.runSnapshot("");
    });

    expect(outcome).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("holds a started update until the refetch that shows it has settled", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: { id: "snap_1" } });
    let settleRefetch = () => {};
    const mutate = vi
      .fn(async () => {})
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            settleRefetch = resolve;
          }),
      );
    const { result } = render({ mutate });

    let submitted = false;
    await act(async () => {
      void result.current.submitUpdate().then(() => {
        submitted = true;
      });
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(submitted).toBe(false);
    expect(result.current.loading).toBe(true);
    await act(() => result.current.submitUpdate());
    expect(apiCall).toHaveBeenCalledTimes(1);

    await act(async () => settleRefetch());

    expect(submitted).toBe(true);
    expect(result.current.loading).toBe(false);
    await act(() => result.current.submitUpdate());
    expect(apiCall).toHaveBeenCalledTimes(2);
  });

  it("releases a failed update without waiting for the refetch", async () => {
    apiCall.mockRejectedValueOnce(new Error("boom"));
    const mutate = vi.fn(() => new Promise<void>(() => {}));
    const { result } = render({ mutate });

    await act(() => result.current.submitUpdate());

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
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

  it("sends the update scope and notes a new-metrics update that ran all metrics", async () => {
    apiCall.mockResolvedValue({
      status: 200,
      snapshot: { id: "snap_1" },
      updateScope: "all_metrics",
    });
    const { result } = render();

    await act(() =>
      result.current.submitUpdate({ updateScope: "new_metrics" }),
    );

    expect(apiCall.mock.calls[0][0]).toBe("/experiment/exp_1/snapshot");
    expect(JSON.parse(apiCall.mock.calls[0][1].body)).toEqual({
      phase: 0,
      dimension: "",
      updateScope: "new_metrics",
    });
    expect(result.current.notice?.snapshotId).toBe("snap_1");
  });

  it("revalidates through the caller-owned mutator after a snapshot post", async () => {
    apiCall.mockResolvedValue({ status: 200, snapshot: { id: "snap_1" } });
    const mutate = vi.fn();
    const { result } = render({ mutate });

    await act(() => result.current.runSnapshot(""));

    expect(mutate).toHaveBeenCalledTimes(1);
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
