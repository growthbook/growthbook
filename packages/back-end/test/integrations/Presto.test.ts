import { prestoStateToStatus } from "back-end/src/integrations/Presto";

describe("prestoStateToStatus (status-only mapping)", () => {
  it("maps FINISHED to succeeded", () => {
    expect(prestoStateToStatus({ state: "FINISHED" })).toEqual({
      state: "succeeded",
    });
  });

  it.each([
    "QUEUED",
    "WAITING_FOR_RESOURCES",
    "PLANNING",
    "STARTING",
    "RUNNING",
    "FINISHING",
  ])("maps pre-terminal state %s to running", (state) => {
    expect(prestoStateToStatus({ state })).toEqual({ state: "running" });
  });

  it("maps FAILED with failureInfo.message to failed carrying that message", () => {
    expect(
      prestoStateToStatus({
        state: "FAILED",
        failureInfo: { message: "line 1:8: Column 'x' cannot be resolved" },
      }),
    ).toEqual({
      state: "failed",
      error: "line 1:8: Column 'x' cannot be resolved",
    });
  });

  it("falls back to errorCode.name when failureInfo.message is absent", () => {
    expect(
      prestoStateToStatus({
        state: "FAILED",
        errorCode: { code: 1, name: "SYNTAX_ERROR" },
      }),
    ).toEqual({ state: "failed", error: "SYNTAX_ERROR" });
  });

  it("maps FAILED with no extractable detail to a fallback message", () => {
    expect(prestoStateToStatus({ state: "FAILED" })).toEqual({
      state: "failed",
      error: "Query failed",
    });
  });

  it.each([{ state: "" }, {}, undefined, null])(
    "maps an unusable query-info payload %j to unknown/unrecognized",
    (payload) => {
      expect(prestoStateToStatus(payload)).toEqual({
        state: "unknown",
        reason: "unrecognized",
      });
    },
  );
});
