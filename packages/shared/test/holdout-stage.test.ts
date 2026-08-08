import { getHoldoutStage } from "../src/util";

describe("getHoldoutStage", () => {
  it("returns draft for a draft holdout experiment", () => {
    expect(getHoldoutStage({}, { status: "draft" })).toBe("draft");
  });

  it("returns draft when analysisStartDate is set", () => {
    expect(
      getHoldoutStage({ analysisStartDate: new Date() }, { status: "draft" }),
    ).toBe("draft");
  });

  it("returns running while the holdout has not entered its analysis period", () => {
    expect(getHoldoutStage({}, { status: "running" })).toBe("running");
  });

  it("returns analysis-period once analysisStartDate is set", () => {
    expect(
      getHoldoutStage({ analysisStartDate: new Date() }, { status: "running" }),
    ).toBe("analysis-period");
  });

  it("returns stopped for a stopped holdout experiment", () => {
    expect(getHoldoutStage({}, { status: "stopped" })).toBe("stopped");
    expect(
      getHoldoutStage({ analysisStartDate: new Date() }, { status: "stopped" }),
    ).toBe("stopped");
  });

  describe("string-dates form", () => {
    it("treats an ISO string analysisStartDate as the analysis period", () => {
      expect(
        getHoldoutStage(
          { analysisStartDate: "2026-07-28T00:00:00.000Z" },
          { status: "running" },
        ),
      ).toBe("analysis-period");
    });

    it("treats an absent analysisStartDate as running", () => {
      expect(
        getHoldoutStage(
          { analysisStartDate: undefined },
          { status: "running" },
        ),
      ).toBe("running");
    });

    it("treats a null analysisStartDate as running", () => {
      expect(
        getHoldoutStage({ analysisStartDate: null }, { status: "running" }),
      ).toBe("running");
    });

    it("treats an empty-string analysisStartDate as running", () => {
      expect(
        getHoldoutStage({ analysisStartDate: "" }, { status: "running" }),
      ).toBe("running");
    });
  });
});
