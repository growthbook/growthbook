import { act, renderHook } from "@testing-library/react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useIncrementalPipelineFallbackConfirm } from "@/hooks/useIncrementalPipelineFallbackConfirm";
import { useIncrementalPipelineUnsupportedReason } from "@/hooks/useIncrementalPipelineUnsupportedReason";

vi.mock("@/hooks/useIncrementalPipelineUnsupportedReason");

const experiment = { id: "exp_1" } as unknown as ExperimentInterfaceStringDates;
const reason = "Activation metrics are not supported.";

describe("useIncrementalPipelineFallbackConfirm", () => {
  beforeEach(() => {
    vi.mocked(useIncrementalPipelineUnsupportedReason).mockReset();
  });

  it("proceeds without opening the dialog when there is no unsupported reason", async () => {
    vi.mocked(useIncrementalPipelineUnsupportedReason).mockReturnValue(
      undefined,
    );
    const { result } = renderHook(() =>
      useIncrementalPipelineFallbackConfirm({ experiment }),
    );

    let proceed: boolean | undefined;
    await act(async () => {
      proceed = await result.current.customValidation();
    });

    expect(proceed).toBe(true);
    expect(result.current.isConfirmOpen).toBe(false);
  });

  it("skips the gate while queries are running", async () => {
    vi.mocked(useIncrementalPipelineUnsupportedReason).mockReturnValue(reason);
    const { result } = renderHook(() =>
      useIncrementalPipelineFallbackConfirm({
        experiment,
        latestStatus: "running",
      }),
    );

    let proceed: boolean | undefined;
    await act(async () => {
      proceed = await result.current.customValidation();
    });

    expect(proceed).toBe(true);
    expect(result.current.isConfirmOpen).toBe(false);
  });

  it("opens the dialog and proceeds when confirmed", async () => {
    vi.mocked(useIncrementalPipelineUnsupportedReason).mockReturnValue(reason);
    const { result } = renderHook(() =>
      useIncrementalPipelineFallbackConfirm({ experiment }),
    );

    let validation: boolean | Promise<boolean>;
    act(() => {
      validation = result.current.customValidation();
    });
    expect(result.current.isConfirmOpen).toBe(true);

    act(() => {
      result.current.onConfirm();
    });
    expect(result.current.isConfirmOpen).toBe(false);
    await expect(validation!).resolves.toBe(true);
  });

  it("opens the dialog and aborts when cancelled", async () => {
    vi.mocked(useIncrementalPipelineUnsupportedReason).mockReturnValue(reason);
    const { result } = renderHook(() =>
      useIncrementalPipelineFallbackConfirm({ experiment }),
    );

    let validation: boolean | Promise<boolean>;
    act(() => {
      validation = result.current.customValidation();
    });
    expect(result.current.isConfirmOpen).toBe(true);

    act(() => {
      result.current.onCancel();
    });
    expect(result.current.isConfirmOpen).toBe(false);
    await expect(validation!).resolves.toBe(false);
  });
});
