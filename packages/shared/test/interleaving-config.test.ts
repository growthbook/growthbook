import {
  getInterleavingConfigError,
  interleavingAnalysisConfigured,
  interleavingAutoSnapshotScheduled,
} from "../src/util";

const configured = {
  datasourceId: "ds_1",
  interleavingExposureQueryId: "ilq_1",
  userIdType: "user_id",
};

describe("interleavingAnalysisConfigured", () => {
  it("accepts a fully configured analysis", () => {
    expect(interleavingAnalysisConfigured(configured)).toBe(true);
    expect(getInterleavingConfigError(configured)).toBeNull();
  });

  it.each([
    "datasourceId",
    "interleavingExposureQueryId",
    "userIdType",
  ] as const)("rejects an empty %s", (field) => {
    const il = { ...configured, [field]: "" };
    expect(interleavingAnalysisConfigured(il)).toBe(false);
    expect(getInterleavingConfigError(il)).toContain("before updating results");
  });

  it("rejects a brand new experiment with nothing set", () => {
    const il = {
      datasourceId: "",
      interleavingExposureQueryId: "",
      userIdType: "",
    };
    expect(interleavingAnalysisConfigured(il)).toBe(false);
    expect(getInterleavingConfigError(il)).not.toBeNull();
  });
});

describe("interleavingAutoSnapshotScheduled", () => {
  const scheduled = { status: "running", archived: false, autoSnapshots: true };

  it("accepts a running experiment with auto-updates on", () => {
    expect(interleavingAutoSnapshotScheduled(scheduled)).toBe(true);
  });

  it.each([
    ["archived", { archived: true }],
    ["stopped", { status: "stopped" }],
    ["a draft", { status: "draft" }],
    ["auto-updates off", { autoSnapshots: false }],
  ])("rejects %s", (_label, overrides) => {
    expect(
      interleavingAutoSnapshotScheduled({ ...scheduled, ...overrides }),
    ).toBe(false);
  });

  // Pre-dates the scheduling fields; treated as off until something seeds it.
  it("rejects a doc with no autoSnapshots field", () => {
    expect(
      interleavingAutoSnapshotScheduled({ status: "running", archived: false }),
    ).toBe(false);
  });
});
