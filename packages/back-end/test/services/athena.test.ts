import { athenaStateToStatus } from "back-end/src/services/athena";

describe("athenaStateToStatus (status-only mapping)", () => {
  it("maps QUEUED to running", () => {
    expect(athenaStateToStatus("QUEUED", undefined)).toEqual({
      state: "running",
    });
  });

  it("maps RUNNING to running", () => {
    expect(athenaStateToStatus("RUNNING", undefined)).toEqual({
      state: "running",
    });
  });

  it("maps SUCCEEDED to succeeded", () => {
    expect(athenaStateToStatus("SUCCEEDED", undefined)).toEqual({
      state: "succeeded",
    });
  });

  it("maps FAILED with a reason to failed carrying the reason", () => {
    expect(
      athenaStateToStatus("FAILED", "COLUMN_NOT_FOUND: line 1:8: Column x"),
    ).toEqual({
      state: "failed",
      error: "COLUMN_NOT_FOUND: line 1:8: Column x",
    });
  });

  it("maps FAILED without a reason to failed with a fallback message", () => {
    expect(athenaStateToStatus("FAILED", undefined)).toEqual({
      state: "failed",
      error: "Query failed",
    });
  });

  it("maps CANCELLED with a reason to failed carrying the reason", () => {
    expect(athenaStateToStatus("CANCELLED", "User cancelled")).toEqual({
      state: "failed",
      error: "User cancelled",
    });
  });

  it("maps CANCELLED without a reason to failed with a fallback message", () => {
    expect(athenaStateToStatus("CANCELLED", undefined)).toEqual({
      state: "failed",
      error: "Query was cancelled",
    });
  });

  it("maps an unknown/missing state to unknown/unrecognized", () => {
    expect(athenaStateToStatus(undefined, undefined)).toEqual({
      state: "unknown",
      reason: "unrecognized",
    });
    expect(athenaStateToStatus("SOMETHING_NEW", undefined)).toEqual({
      state: "unknown",
      reason: "unrecognized",
    });
  });
});
