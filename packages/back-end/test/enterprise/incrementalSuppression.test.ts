import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import {
  applyIncrementalSuppression,
  formatCustomHookTestResult,
  runCustomHookTest,
} from "back-end/src/enterprise/sandbox/sandbox-eval";
import type { SandboxEvalResult } from "back-end/src/enterprise/sandbox/sandbox-core";

jest.mock("back-end/src/enterprise/sandbox/sandbox-pool", () => ({
  runInSandbox: jest.fn(),
}));

const mockRunInSandbox = runInSandbox as jest.MockedFunction<
  typeof runInSandbox
>;

function ok(warnings: string[] = [], extras: Partial<SandboxEvalResult> = {}) {
  return { ok: true, warnings, log: "", ...extras };
}

function fail(
  error: string,
  warnings: string[] = [],
  extras: Partial<SandboxEvalResult> = {},
) {
  return { ok: false, error, warnings, log: "", ...extras };
}

describe("formatCustomHookTestResult", () => {
  it("does not classify proposed warnings as suppressed when the hook threw", () => {
    const result = formatCustomHookTestResult(
      fail("blocked", ["pre-existing"]),
      {
        errorSuppressed: false,
        warnings: [],
      },
    );

    expect(result.success).toBe(false);
    expect(result.warnings).toEqual(["pre-existing"]);
    expect(result.suppressed).toBeUndefined();
  });

  it("reports a suppressed error without also listing its discarded warnings", () => {
    const result = formatCustomHookTestResult(
      fail("blocked", ["pre-existing"]),
      {
        errorSuppressed: true,
        warnings: [],
      },
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.suppressed).toEqual({ error: "blocked" });
  });

  it("reports warnings that Incremental Changes Only would hide on a successful run", () => {
    const result = formatCustomHookTestResult(ok(["old", "new"]), {
      errorSuppressed: false,
      warnings: ["new"],
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(["new"]);
    expect(result.suppressed).toEqual({ warnings: ["old"] });
  });

  it("leaves a clean successful run unchanged when there is no prior state", () => {
    const result = formatCustomHookTestResult(ok(), null);

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.suppressed).toBeUndefined();
  });
});

describe("applyIncrementalSuppression", () => {
  beforeEach(() => {
    mockRunInSandbox.mockReset();
  });

  it("suppresses an error only when the prior state produced the same message", async () => {
    mockRunInSandbox.mockResolvedValueOnce(fail("blocked"));

    await expect(
      applyIncrementalSuppression("code", fail("blocked"), { feature: {} }),
    ).resolves.toEqual({ errorSuppressed: true, warnings: [] });
  });

  it("does not suppress an error that the prior state did not produce", async () => {
    mockRunInSandbox.mockResolvedValueOnce(fail("different"));

    await expect(
      applyIncrementalSuppression("code", fail("blocked"), { feature: {} }),
    ).resolves.toEqual({ errorSuppressed: false, warnings: [] });
  });

  it("returns no compared warnings on the error path", async () => {
    mockRunInSandbox.mockResolvedValueOnce(fail("blocked", ["old"]));

    await expect(
      applyIncrementalSuppression("code", fail("blocked", ["old"]), {
        feature: {},
      }),
    ).resolves.toEqual({ errorSuppressed: true, warnings: [] });
  });

  it("drops warnings the prior state already produced", async () => {
    mockRunInSandbox.mockResolvedValueOnce(ok(["old"]));

    await expect(
      applyIncrementalSuppression("code", ok(["old", "new"]), { feature: {} }),
    ).resolves.toEqual({ errorSuppressed: false, warnings: ["new"] });
  });
});

describe("runCustomHookTest", () => {
  beforeEach(() => {
    mockRunInSandbox.mockReset();
  });

  it("does not rerun the sandbox for a clean successful test", async () => {
    mockRunInSandbox.mockResolvedValueOnce(ok());

    const result = await runCustomHookTest(
      "code",
      { feature: { id: "a" } },
      { feature: { id: "b" } },
    );

    expect(mockRunInSandbox).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.suppressed).toBeUndefined();
  });

  it("reruns against the prior state when the proposed run has an error", async () => {
    mockRunInSandbox
      .mockResolvedValueOnce(fail("blocked"))
      .mockResolvedValueOnce(fail("blocked"));

    const result = await runCustomHookTest(
      "code",
      { feature: { id: "a" } },
      { feature: { id: "b" } },
    );

    expect(mockRunInSandbox).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.suppressed).toEqual({ error: "blocked" });
  });

  it("leaves the response unchanged when no prior state is supplied", async () => {
    mockRunInSandbox.mockResolvedValueOnce(fail("blocked"));

    const result = await runCustomHookTest("code", { feature: { id: "a" } });

    expect(mockRunInSandbox).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toBe("blocked");
    expect(result.suppressed).toBeUndefined();
  });
});
