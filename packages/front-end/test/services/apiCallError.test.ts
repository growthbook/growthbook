import { ApiCallError, getErrorDetails } from "@/services/apiCallError";

function hookError(hooks: unknown) {
  return new ApiCallError({
    message: "msg",
    code: "custom_hook_error",
    details: { hooks },
  });
}

describe("getErrorDetails", () => {
  it("shows the stack for a crashed hook", () => {
    expect(
      getErrorDetails(
        hookError([
          {
            hookName: "PII scanner",
            rejected: false,
            message: "boom",
            stack: "TypeError: boom\n    at hook (hook.js:2:5)",
          },
        ]),
      ),
    ).toBe("Hook: PII scanner\nTypeError: boom\n    at hook (hook.js:2:5)");
  });

  it("falls back to the message when a crash has no stack", () => {
    expect(
      getErrorDetails(
        hookError([{ hookName: "h", rejected: false, message: "timed out" }]),
      ),
    ).toBe("Hook: h\ntimed out");
  });

  it("shows only the console output for a rejection", () => {
    expect(
      getErrorDetails(
        hookError([
          {
            hookName: "Require hypothesis",
            rejected: true,
            message: "Add a hypothesis",
            log: "[log] checking",
          },
        ]),
      ),
    ).toBe("Hook: Require hypothesis\nConsole output:\n[log] checking");
  });

  it("returns null for a rejection without console output", () => {
    expect(
      getErrorDetails(
        hookError([{ hookName: "h", rejected: true, message: "nope" }]),
      ),
    ).toBeNull();
  });

  it("joins multiple hooks and skips ones with nothing to show", () => {
    expect(
      getErrorDetails(
        hookError([
          { hookName: "a", rejected: true, message: "nope" },
          { hookName: "b", rejected: true, message: "nope", log: "[log] b" },
          { hookName: "c", rejected: false, message: "boom" },
        ]),
      ),
    ).toBe("Hook: b\nConsole output:\n[log] b\n\nHook: c\nboom");
  });

  it("returns null for malformed details", () => {
    expect(getErrorDetails(hookError([{ hookName: "h" }]))).toBeNull();
    expect(getErrorDetails(hookError("not an array"))).toBeNull();
  });

  it("returns null for other errors", () => {
    expect(getErrorDetails(new Error("boom"))).toBeNull();
    expect(getErrorDetails("boom")).toBeNull();
    expect(
      getErrorDetails(
        new ApiCallError({ message: "x", code: "conflict", details: {} }),
      ),
    ).toBeNull();
  });
});
