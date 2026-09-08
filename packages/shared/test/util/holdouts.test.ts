import {
  coverageToHoldoutSize,
  getAllowedHoldoutStageSources,
  getEnabledHoldoutEnvironments,
  getHoldoutStage,
  holdoutSizeToCoverage,
  isHoldoutStageTransitionAllowed,
  MAX_HOLDOUT_SIZE,
} from "../../src/util/holdouts";

describe("holdout size / coverage conversion", () => {
  it("converts between holdoutSize and coverage", () => {
    expect(holdoutSizeToCoverage(0.05)).toBe(0.1);
    expect(coverageToHoldoutSize(0.1)).toBe(0.05);
    expect(holdoutSizeToCoverage(MAX_HOLDOUT_SIZE)).toBe(1);
  });

  it("round-trips", () => {
    for (const size of [0.01, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.33, 0.5]) {
      expect(coverageToHoldoutSize(holdoutSizeToCoverage(size))).toBe(size);
    }
  });
});

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

describe("getEnabledHoldoutEnvironments", () => {
  it("returns only the enabled environment ids", () => {
    expect(
      getEnabledHoldoutEnvironments({
        production: { enabled: true },
        staging: { enabled: false },
        dev: { enabled: true },
      }),
    ).toEqual(["production", "dev"]);
  });

  it("returns an empty array when nothing is enabled", () => {
    expect(
      getEnabledHoldoutEnvironments({
        production: { enabled: false },
        staging: { enabled: false },
      }),
    ).toEqual([]);
  });

  it("returns an empty array for an empty map", () => {
    expect(getEnabledHoldoutEnvironments({})).toEqual([]);
  });

  it("returns an empty array for undefined or null", () => {
    expect(getEnabledHoldoutEnvironments(undefined)).toEqual([]);
    expect(getEnabledHoldoutEnvironments(null)).toEqual([]);
  });

  it("treats missing or undefined enabled as disabled", () => {
    expect(
      getEnabledHoldoutEnvironments({
        production: {},
        staging: { enabled: undefined },
        dev: { enabled: true },
      }),
    ).toEqual(["dev"]);
  });

  it("drops enabled ids missing from allowedEnvs", () => {
    expect(
      getEnabledHoldoutEnvironments(
        {
          production: { enabled: true },
          staging: { enabled: true },
          deleted: { enabled: true },
        },
        ["production", "staging"],
      ),
    ).toEqual(["production", "staging"]);
  });

  it("returns all enabled ids when allowedEnvs is omitted", () => {
    expect(
      getEnabledHoldoutEnvironments({
        production: { enabled: true },
        deleted: { enabled: true },
      }),
    ).toEqual(["production", "deleted"]);
  });

  it("returns an empty array when allowedEnvs excludes every enabled id", () => {
    expect(
      getEnabledHoldoutEnvironments({ deleted: { enabled: true } }, [
        "production",
      ]),
    ).toEqual([]);
  });
});

describe("holdout stage transitions", () => {
  it("allows forward lifecycle transitions", () => {
    expect(isHoldoutStageTransitionAllowed("draft", "running")).toBe(true);
    expect(isHoldoutStageTransitionAllowed("running", "analysis-period")).toBe(
      true,
    );
    expect(isHoldoutStageTransitionAllowed("running", "stopped")).toBe(true);
    expect(isHoldoutStageTransitionAllowed("analysis-period", "stopped")).toBe(
      true,
    );
  });

  it("rejects repeated, skipped, and backward transitions", () => {
    expect(isHoldoutStageTransitionAllowed("running", "running")).toBe(false);
    expect(
      isHoldoutStageTransitionAllowed("analysis-period", "analysis-period"),
    ).toBe(false);
    expect(isHoldoutStageTransitionAllowed("stopped", "stopped")).toBe(false);
    expect(isHoldoutStageTransitionAllowed("draft", "stopped")).toBe(false);
    expect(isHoldoutStageTransitionAllowed("draft", "analysis-period")).toBe(
      false,
    );
    expect(isHoldoutStageTransitionAllowed("stopped", "running")).toBe(false);
  });

  it("lists the valid sources for stopping", () => {
    expect(getAllowedHoldoutStageSources("stopped")).toEqual([
      "running",
      "analysis-period",
    ]);
  });
});
