import { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentEditsProvider,
  useEditBase,
  useHoldEditBases,
  useStagedState,
} from "@/components/Experiment/TabbedPage/ExperimentEdits";
import { StopSubmit } from "@/ui/Modal/StopSubmit";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";

vi.mock("@/services/auth", () => ({ useAuth: () => ({ apiCall: vi.fn() }) }));
vi.mock("@/hooks/useUnsavedChangesGuard", () => ({
  default: () => ({ pendingHref: null, allowUnload: () => undefined }),
}));

describe("useStagedState", () => {
  beforeEach(() => sessionStorage.clear());

  it("shares one value between everything staging the slot", () => {
    const a = renderHook(() => useStagedState("slot", "stored", "exp_1:draft"));
    const b = renderHook(() => useStagedState("slot", "stored", "exp_1:draft"));
    act(() => a.result.current[1]("mine"));
    expect(b.result.current[0]).toBe("mine");
    // Another slot, or the same slot in another scope, is its own.
    const other = renderHook(() =>
      useStagedState("slot", "stored", "exp_2:draft"),
    );
    expect(other.result.current[0]).toBe("stored");
  });

  it("follows what's stored until changed, and again once set back", () => {
    const { result, rerender } = renderHook(
      ({ stored }) => useStagedState("follow", stored, "exp_1:draft"),
      { initialProps: { stored: "a" } },
    );
    rerender({ stored: "b" });
    expect(result.current[0]).toBe("b");
    act(() => result.current[1]("mine"));
    rerender({ stored: "c" });
    expect(result.current[0]).toBe("mine");
    act(() => result.current[1]("c"));
    rerender({ stored: "d" });
    expect(result.current[0]).toBe("d");
  });
});

describe("useEditBase", () => {
  beforeEach(() => sessionStorage.clear());

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ExperimentEditsProvider
      experiment={{ id: "exp_1" } as ExperimentInterfaceStringDates}
      mutate={() => undefined}
    >
      {children}
    </ExperimentEditsProvider>
  );

  it("judges what a dialog stages against what it opened on, not a refresh", () => {
    const { result, rerender } = renderHook(
      ({ open, dirty, loaded }) => {
        useHoldEditBases(open);
        return useEditBase("field", dirty, () => loaded)[0];
      },
      { initialProps: { open: false, dirty: false, loaded: "a" }, wrapper },
    );
    rerender({ open: true, dirty: false, loaded: "a" });
    rerender({ open: true, dirty: false, loaded: "refreshed" });
    rerender({ open: false, dirty: true, loaded: "refreshed" });
    expect(result.current).toBe("a");
    // Without a dialog, the base is what's loaded when the edit starts.
    rerender({ open: false, dirty: false, loaded: "b" });
    rerender({ open: false, dirty: true, loaded: "b" });
    expect(result.current).toBe("b");
  });
});

describe("validatedSubmit", () => {
  const setup = (name: string) => {
    const { result } = renderHook(() =>
      useForm<{ name: string }>({ defaultValues: { name } }),
    );
    result.current.register("name", { required: "Name is required" });
    return result.current;
  };

  it("stops the modal from closing when a field fails its rules", async () => {
    const form = setup("");
    const onValid = vi.fn();
    await expect(validatedSubmit(form, onValid)()).rejects.toBeInstanceOf(
      StopSubmit,
    );
    expect(onValid).not.toHaveBeenCalled();
  });

  it("submits a valid form", async () => {
    const form = setup("Checkout");
    const onValid = vi.fn();
    await validatedSubmit(form, onValid)();
    expect(onValid).toHaveBeenCalledWith({ name: "Checkout" }, undefined);
  });
});
