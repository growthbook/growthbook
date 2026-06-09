import { sandboxEval } from "../src/enterprise/sandbox/sandbox-eval";

describe("sandboxEval", () => {
  it("should evaluate a function in a sandboxed environment", async () => {
    const result = await sandboxEval("return num + 1", { num: 2 });
    expect(result).toEqual({ ok: true, returnVal: 3, log: "", warnings: [] });
  });

  it("should return an error for invalid code", async () => {
    const result = await sandboxEval("invalid code", { num: 2 });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Unexpected identifier 'code'"),
      log: "",
      warnings: [],
    });
  });

  it("should return an error if the code throws", async () => {
    const result = await sandboxEval("throw new Error('Test error')", {});
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Test error"),
      log: "",
      warnings: [],
    });
  });

  it("should return an error if the code exceeds the CPU time limit", async () => {
    const result = await sandboxEval("while(true) {}", {}, { cpuTimeoutMS: 5 });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Script execution timed out"),
      log: "",
      warnings: [],
    });
  });

  it("should return an error if the code exceeds the memory limit", async () => {
    const result = await sandboxEval(
      `
    const storage = [];
	const twoMegabytes = 1024 * 1024 * 2;
	for (let i = 0; i < 8; i++) {
		const array = new Uint8Array(twoMegabytes);
		for (let ii = 0; ii < twoMegabytes; ii += 4096) {
			array[ii] = 1; // we have to put something in the array to flush to real memory
		}
		storage.push(array);
	}`,
      {},
      { memoryLimitMB: 8 },
    );
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Array buffer allocation failed"),
      log: "",
      warnings: [],
    });
  });

  it("should collect warnings raised via addWarning", async () => {
    const result = await sandboxEval(
      `addWarning("first"); addWarning("second");`,
      {},
    );
    expect(result).toEqual({
      ok: true,
      log: "",
      warnings: ["first", "second"],
    });
  });

  it("should still report a thrown error even if warnings were raised", async () => {
    const result = await sandboxEval(
      `addWarning("a warning"); throw new Error("hard error");`,
      {},
    );
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("hard error"),
      log: "",
      warnings: ["a warning"],
    });
  });

  it("should return no warnings when addWarning is not called", async () => {
    const result = await sandboxEval("return 1", {});
    expect(result).toEqual({ ok: true, returnVal: 1, log: "", warnings: [] });
  });

  describe("validateFeaturePublish args", () => {
    const requireApproversBody = `
      if (!approvers.length) {
        throw new Error("Publishing requires at least one approval");
      }
      if (!approvers.some((a) => a?.type === "dashboard")) {
        throw new Error("Publishing requires at least one human approval");
      }
    `;

    const feature = { id: "my-feature", project: "" };
    const revision = {
      featureId: "my-feature",
      version: 2,
      status: "approved",
    };

    it("should block when there are no approvers", async () => {
      const result = await sandboxEval(requireApproversBody, {
        feature,
        revision,
        approvers: [],
      });
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining(
          "Publishing requires at least one approval",
        ),
        log: "",
        warnings: [],
      });
    });

    it("should block when only an api_key approver is present", async () => {
      const result = await sandboxEval(requireApproversBody, {
        feature,
        revision,
        approvers: [{ type: "api_key", apiKey: "key_abc123" }],
      });
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining(
          "Publishing requires at least one human approval",
        ),
        log: "",
        warnings: [],
      });
    });

    it("should pass when a dashboard approver is present", async () => {
      const result = await sandboxEval(requireApproversBody, {
        feature,
        revision,
        approvers: [
          { type: "api_key", apiKey: "key_abc123" },
          {
            type: "dashboard",
            id: "user_123",
            email: "user@example.com",
            name: "User",
          },
        ],
      });
      expect(result).toEqual({
        ok: true,
        returnVal: undefined,
        log: "",
        warnings: [],
      });
    });
  });
});
