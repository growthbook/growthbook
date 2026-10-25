import { act, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { useStagedState } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import { StopSubmit } from "@/ui/Modal/StopSubmit";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";

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
