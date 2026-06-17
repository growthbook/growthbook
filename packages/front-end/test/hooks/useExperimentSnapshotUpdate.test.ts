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

  beforeEach(() => {
    apiCall.mockReset();
    vi.mocked(useAuth).mockReturnValue({
      apiCall,
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
    return renderHook(() =>
      useExperimentSnapshotUpdate({
        experiment,
        phase: 0,
        mutate: vi.fn(),
        setRefreshError: vi.fn(),
        ...overrides,
      }),
    );
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
});
