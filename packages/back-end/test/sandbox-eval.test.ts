import { sandboxEval } from "../src/enterprise/sandbox/sandbox-eval";

describe("sandboxEval", () => {
  it("should evaluate a function in a sandboxed environment", async () => {
    const result = await sandboxEval("return num + 1", { num: 2 });
    expect(result).toEqual({ ok: true, result: 3 });
  });

  it("should return an error for invalid code", async () => {
    const result = await sandboxEval("invalid code", { num: 2 });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Unexpected identifier 'code'"),
    });
  });

  it("should return an error if the code throws", async () => {
    const result = await sandboxEval("throw new Error('Test error')", {});
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Test error"),
    });
  });

  it("should return an error if the code exceeds the CPU time limit", async () => {
    const result = await sandboxEval("while(true) {}", {}, { cpuTimeoutMS: 5 });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Script execution timed out"),
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
    });
  });
});
