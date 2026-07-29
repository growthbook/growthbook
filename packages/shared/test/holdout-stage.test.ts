import { getHoldoutStage } from "../src/util";
import {
  apiCreateHoldoutBody,
  coverageToHoldoutSize,
  holdoutSizeToCoverage,
  MAX_HOLDOUT_SIZE,
} from "../src/validators/holdout";

describe("apiCreateHoldoutBody holdoutSize bounds", () => {
  const parse = (holdoutSize: number) =>
    apiCreateHoldoutBody.safeParse({ name: "Holdout", holdoutSize });

  it("accepts sizes up to the maximum", () => {
    expect(parse(0).success).toBe(true);
    expect(parse(0.05).success).toBe(true);
    expect(parse(MAX_HOLDOUT_SIZE).success).toBe(true);
  });

  it("rejects a size above the maximum", () => {
    // Previously reachable through the UI, which clamped the entered percent
    // at 100 and then doubled it into a coverage of 2.
    expect(parse(0.51).success).toBe(false);
    expect(parse(1).success).toBe(false);
  });

  it("rejects a negative size", () => {
    expect(parse(-0.01).success).toBe(false);
  });
});

describe("holdout size / coverage conversion", () => {
  it("doubles holdoutSize to get the stored coverage", () => {
    expect(holdoutSizeToCoverage(0.05)).toBe(0.1);
    expect(holdoutSizeToCoverage(0.5)).toBe(1);
    expect(holdoutSizeToCoverage(0)).toBe(0);
  });

  it("halves stored coverage to get holdoutSize", () => {
    expect(coverageToHoldoutSize(0.1)).toBe(0.05);
    expect(coverageToHoldoutSize(1)).toBe(0.5);
    expect(coverageToHoldoutSize(0)).toBe(0);
  });

  it("caps out at exactly full coverage", () => {
    // The invariant behind MAX_HOLDOUT_SIZE and the UI clamp: the largest
    // allowed holdout plus its equal control group is precisely all traffic.
    expect(holdoutSizeToCoverage(MAX_HOLDOUT_SIZE)).toBe(1);
  });

  it("round-trips exactly, with no floating point drift", () => {
    // Multiplying and dividing by two only shifts the exponent, so even values
    // with no exact binary representation survive the round trip.
    for (const size of [0.01, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.33, 0.5]) {
      expect(coverageToHoldoutSize(holdoutSizeToCoverage(size))).toBe(size);
    }
  });
});

describe("getHoldoutStage", () => {
  it("returns draft for a draft holdout experiment", () => {
    expect(getHoldoutStage({}, { status: "draft" })).toBe("draft");
  });

  it("returns draft even when an analysisStartDate is somehow set", () => {
    // Starting from draft clears analysisStartDate, but the experiment status
    // is the authority on whether the holdout has started at all.
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
      // The string-dates form can carry "" from a cleared form field.
      expect(
        getHoldoutStage({ analysisStartDate: "" }, { status: "running" }),
      ).toBe("running");
    });
  });
});
