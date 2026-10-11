import { sandboxEval } from "../src/enterprise/sandbox/sandbox-core";

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
      stack: expect.stringContaining("SyntaxError"),
      log: "",
      warnings: [],
    });
  });

  it("should return a rejection if the code throws", async () => {
    const result = await sandboxEval("throw new Error('Test error')", {});
    expect(result).toEqual({
      ok: false,
      rejected: true,
      error: "Test error",
      log: "",
      warnings: [],
    });
  });

  it("treats a thrown string as a rejection", async () => {
    const result = await sandboxEval("throw 'Hypothesis is required'", {});
    expect(result).toMatchObject({
      rejected: true,
      error: "Hypothesis is required",
    });
  });

  it("treats engine errors as failures with a hook-only stack", async () => {
    const result = await sandboxEval(
      "const a = 1;\nreturn experiment.missing.deep;",
      { experiment: {} },
    );
    expect(result.ok).toBe(false);
    expect(result.rejected).toBeUndefined();
    expect(result.error).toBe(
      "Cannot read properties of undefined (reading 'deep')",
    );
    // Line numbers match the hook body; no host frames leak server paths.
    expect(result.stack).toMatch(
      /^TypeError: .*\n\s+at hook \(hook\.js:2:\d+\)$/,
    );
  });

  it.each([
    ["new TypeError", "throw new TypeError('Key must be lowercase')"],
    ["TypeError without new", "throw TypeError('Key must be lowercase')"],
    [
      "RangeError subclass",
      "class KeyError extends RangeError {}; throw new KeyError('Key must be lowercase')",
    ],
  ])("treats a hook's own %s as a rejection", async (_, code) => {
    expect(await sandboxEval(code, {})).toMatchObject({
      rejected: true,
      error: "Key must be lowercase",
    });
  });

  it("still recognizes engine errors with instanceof", async () => {
    const result = await sandboxEval(
      "try { null.x } catch (e) { return e instanceof TypeError }",
      {},
    );
    expect(result.returnVal).toBe(true);
  });

  it("treats an engine-raised AggregateError as a failure", async () => {
    const result = await sandboxEval(
      "await Promise.any([Promise.reject(new Error('a'))])",
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.rejected).toBeUndefined();
  });

  it("treats fetch failures as failures", async () => {
    const result = await sandboxEval("await fetch('not-a-url')", {});
    expect(result.ok).toBe(false);
    expect(result.rejected).toBeUndefined();
  });

  it("treats a rethrown fetch failure with the author's message as a rejection", async () => {
    const result = await sandboxEval(
      "try { await fetch('not-a-url') } catch { throw new Error('PII check unavailable') }",
      {},
    );
    expect(result).toMatchObject({
      rejected: true,
      error: "PII check unavailable",
    });
  });

  it("should return an error if the code exceeds the CPU time limit", async () => {
    const result = await sandboxEval("while(true) {}", {}, { cpuTimeoutMS: 5 });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Script execution timed out"),
      stack: expect.any(String),
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
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("Array buffer allocation failed"),
      log: "",
      warnings: [],
    });
    expect(result.rejected).toBeUndefined();
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
      rejected: true,
      error: "hard error",
      log: "",
      warnings: ["a warning"],
    });
  });

  it("should return no warnings when addWarning is not called", async () => {
    const result = await sandboxEval("return 1", {});
    expect(result).toEqual({ ok: true, returnVal: 1, log: "", warnings: [] });
  });

  // Caps on host-side log/warning output (the isolate limit doesn't cover copied-out data).
  describe("resource limits", () => {
    it("bounds total console.log output regardless of loop count", async () => {
      // Each iteration logs a 100KB string; without a cap this retains 100s of MB
      const result = await sandboxEval(
        `const s = "x".repeat(100000); for (let i = 0; i < 100000; i++) { console.log(s); } return 1;`,
        {},
      );
      // ~64KB cap plus a short truncation marker
      expect(result.log.length).toBeLessThanOrEqual(64 * 1024 + 64);
    });

    it("bounds the count and total size of warnings", async () => {
      const result = await sandboxEval(
        `const s = "x".repeat(5000); for (let i = 0; i < 100000; i++) { addWarning(s); } return 1;`,
        {},
      );
      expect(result.warnings.length).toBeLessThanOrEqual(100);
      expect(result.warnings.join("").length).toBeLessThanOrEqual(
        64 * 1024 + 200,
      );
    });

    it("terminates a long-running async log loop with bounded output", async () => {
      const result = await sandboxEval(
        `const s = "x".repeat(100000); while (true) { console.log(s); await null; }`,
        {},
        { cpuTimeoutMS: 100, wallTimeoutMS: 300 },
      );
      expect(result.ok).toBe(false);
      expect(result.error).toEqual(expect.stringContaining("timed out"));
      expect(result.log.length).toBeLessThanOrEqual(64 * 1024 + 64);
    });
  });
});
