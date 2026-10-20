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

  // The main Update button and the results More Menu's "Re-run all queries"
  // share one gate instance, so it must resolve each invocation independently.
  it("re-opens and resolves independently across repeated invocations", async () => {
    vi.mocked(useIncrementalPipelineUnsupportedReason).mockReturnValue(reason);
    const { result } = renderHook(() =>
      useIncrementalPipelineFallbackConfirm({ experiment }),
    );

    let firstValidation: boolean | Promise<boolean>;
    act(() => {
      firstValidation = result.current.customValidation();
    });
    expect(result.current.isConfirmOpen).toBe(true);
    act(() => {
      result.current.onCancel();
    });
    await expect(firstValidation!).resolves.toBe(false);
    expect(result.current.isConfirmOpen).toBe(false);

    let secondValidation: boolean | Promise<boolean>;
    act(() => {
      secondValidation = result.current.customValidation();
    });
    expect(result.current.isConfirmOpen).toBe(true);
    act(() => {
      result.current.onConfirm();
    });
    await expect(secondValidation!).resolves.toBe(true);
    expect(result.current.isConfirmOpen).toBe(false);
  });

  // Both the Update button and the More Menu's "Re-run all queries" call this
  // gate, so a second invocation can arrive while the first dialog is still
  // open. The superseded attempt must settle (aborted) rather than hang.
  it("aborts the earlier attempt instead of hanging when invocations overlap", async () => {
    vi.mocked(useIncrementalPipelineUnsupportedReason).mockReturnValue(reason);
    const { result } = renderHook(() =>
      useIncrementalPipelineFallbackConfirm({ experiment }),
    );

    let firstValidation: boolean | Promise<boolean>;
    act(() => {
      firstValidation = result.current.customValidation();
    });
    expect(result.current.isConfirmOpen).toBe(true);

    let secondValidation: boolean | Promise<boolean>;
    act(() => {
      secondValidation = result.current.customValidation();
    });
    await expect(firstValidation!).resolves.toBe(false);

    expect(result.current.isConfirmOpen).toBe(true);
    act(() => {
      result.current.onConfirm();
    });
    await expect(secondValidation!).resolves.toBe(true);
    expect(result.current.isConfirmOpen).toBe(false);
  });
});
