import { RampSchedule } from "shared/types/feature";
import {
  getCurrentRampCoverage,
  getNextRampUpdate,
} from "back-end/src/util/scheduleRules";

describe("Rollout Ramp Schedule", () => {
  const T0 = "2025-06-01T12:00:00.000Z";

  // Helper: T0 + n seconds, as a Date.
  const at = (seconds: number) =>
    new Date(new Date(T0).getTime() + seconds * 1000);

  // Reference schedule: 1% -> 5% -> 10% -> 25% -> 50% -> 75% each held for
  // 10 minutes, then implicit 100%. Total ramp: 60 minutes.
  //
  // Resulting windows (elapsed seconds from T0):
  //   [   0,  600) -> 0.01
  //   [ 600, 1200) -> 0.05
  //   [1200, 1800) -> 0.10
  //   [1800, 2400) -> 0.25
  //   [2400, 3000) -> 0.50
  //   [3000, 3600) -> 0.75
  //   [3600,  inf) -> 1.00  (implicit)
  const uniformRamp: RampSchedule = {
    steps: [
      { coverage: 0.01, holdSeconds: 600 },
      { coverage: 0.05, holdSeconds: 600 },
      { coverage: 0.1, holdSeconds: 600 },
      { coverage: 0.25, holdSeconds: 600 },
      { coverage: 0.5, holdSeconds: 600 },
      { coverage: 0.75, holdSeconds: 600 },
    ],
  };

  // Non-uniform: quick smoke at low coverage, then a long bake at 50%.
  //   [   0,  120) -> 0.01  (2 min smoke)
  //   [ 120,  300) -> 0.10  (3 min)
  //   [ 300, 2100) -> 0.50  (30 min bake)
  //   [2100,  inf) -> 1.00  (implicit)
  const bakeRamp: RampSchedule = {
    steps: [
      { coverage: 0.01, holdSeconds: 120 },
      { coverage: 0.1, holdSeconds: 180 },
      { coverage: 0.5, holdSeconds: 1800 },
    ],
  };

  describe("getCurrentRampCoverage", () => {
    it("returns null for an undefined schedule (caller falls back to static coverage)", () => {
      expect(getCurrentRampCoverage(undefined, T0, at(0))).toEqual(null);
    });

    it("returns null when startedAt is undefined (ramp not yet stamped)", () => {
      expect(getCurrentRampCoverage(uniformRamp, undefined, at(0))).toEqual(
        null,
      );
    });

    it("returns the first step's coverage at exactly startedAt", () => {
      expect(getCurrentRampCoverage(uniformRamp, T0, at(0))).toEqual(0.01);
    });

    it("clamps to the first step when now < startedAt (clock skew safety)", () => {
      // Once startedAt is stamped the ramp is live; treat negative elapsed
      // as zero rather than returning null.
      expect(getCurrentRampCoverage(uniformRamp, T0, at(-30))).toEqual(0.01);
    });

    it("holds the current step's coverage for its full hold period", () => {
      // 1s into step 1 (window [600, 1200))
      expect(getCurrentRampCoverage(uniformRamp, T0, at(601))).toEqual(0.05);
      // 1s before step 2
      expect(getCurrentRampCoverage(uniformRamp, T0, at(1199))).toEqual(0.05);
    });

    it("advances at each step boundary (uniform schedule)", () => {
      // Boundaries are half-open: at exactly t, we're in the step that
      // begins at t.
      const cases: [number, number][] = [
        [0, 0.01],
        [600, 0.05],
        [1200, 0.1],
        [1800, 0.25],
        [2400, 0.5],
        [3000, 0.75],
      ];
      for (const [elapsed, expected] of cases) {
        expect(getCurrentRampCoverage(uniformRamp, T0, at(elapsed))).toEqual(
          expected,
        );
      }
    });

    it("graduates to 100% after the last step's hold period expires", () => {
      // At exactly sum(holds) = 3600s
      expect(getCurrentRampCoverage(uniformRamp, T0, at(3600))).toEqual(1);
      // And forever after
      expect(getCurrentRampCoverage(uniformRamp, T0, at(86400))).toEqual(1);
    });

    it("respects non-uniform hold periods", () => {
      // In the 2-min 1% smoke window
      expect(getCurrentRampCoverage(bakeRamp, T0, at(60))).toEqual(0.01);
      // In the 3-min 10% window
      expect(getCurrentRampCoverage(bakeRamp, T0, at(200))).toEqual(0.1);
      // Start of the 30-min 50% bake
      expect(getCurrentRampCoverage(bakeRamp, T0, at(300))).toEqual(0.5);
      // Deep in the bake
      expect(getCurrentRampCoverage(bakeRamp, T0, at(1800))).toEqual(0.5);
      // One second before graduating
      expect(getCurrentRampCoverage(bakeRamp, T0, at(2099))).toEqual(0.5);
      // Graduated to implicit 100%
      expect(getCurrentRampCoverage(bakeRamp, T0, at(2100))).toEqual(1);
    });

    it("handles a single-step schedule (one hold, then 100%)", () => {
      const single: RampSchedule = {
        steps: [{ coverage: 0.1, holdSeconds: 300 }],
      };
      expect(getCurrentRampCoverage(single, T0, at(0))).toEqual(0.1);
      expect(getCurrentRampCoverage(single, T0, at(299))).toEqual(0.1);
      expect(getCurrentRampCoverage(single, T0, at(300))).toEqual(1);
    });

    it("preserves step order as given (does not sort by coverage)", () => {
      // A ramp that goes 50% -> 10% -> 100% is valid. Steps are ordinal.
      // Unusual, but the evaluator must not reorder.
      const weird: RampSchedule = {
        steps: [
          { coverage: 0.5, holdSeconds: 100 },
          { coverage: 0.1, holdSeconds: 100 },
        ],
      };
      expect(getCurrentRampCoverage(weird, T0, at(50))).toEqual(0.5);
      expect(getCurrentRampCoverage(weird, T0, at(150))).toEqual(0.1);
      expect(getCurrentRampCoverage(weird, T0, at(200))).toEqual(1);
    });
  });

  describe("getNextRampUpdate", () => {
    it("returns null for an undefined schedule", () => {
      expect(getNextRampUpdate(undefined, T0, at(0))).toEqual(null);
    });

    it("returns null when startedAt is undefined", () => {
      expect(getNextRampUpdate(uniformRamp, undefined, at(0))).toEqual(null);
    });

    it("returns the end of the current step's hold window while mid-step", () => {
      // 300s into step 0 (holds until 600)
      expect(getNextRampUpdate(uniformRamp, T0, at(300))).toEqual(at(600));
    });

    it("returns the following boundary at an exact boundary", () => {
      // At 600 we've just entered step 1 (holds until 1200)
      expect(getNextRampUpdate(uniformRamp, T0, at(600))).toEqual(at(1200));
    });

    it("respects non-uniform hold periods when computing the next boundary", () => {
      // Deep in the 30-min bake window [300, 2100); next boundary is 2100
      expect(getNextRampUpdate(bakeRamp, T0, at(1000))).toEqual(at(2100));
    });

    it("returns the graduation boundary while in the last explicit step", () => {
      // In step 5 (window [3000, 3600)); graduation to 100% is at 3600
      expect(getNextRampUpdate(uniformRamp, T0, at(3500))).toEqual(at(3600));
    });

    it("returns null once graduated to the implicit 100%", () => {
      expect(getNextRampUpdate(uniformRamp, T0, at(3600))).toEqual(null);
      expect(getNextRampUpdate(bakeRamp, T0, at(2100))).toEqual(null);
      expect(getNextRampUpdate(uniformRamp, T0, at(86400))).toEqual(null);
    });

    it("returns the first boundary when now < startedAt", () => {
      // Clamped to step 0; next boundary is end of step 0's hold
      expect(getNextRampUpdate(uniformRamp, T0, at(-3600))).toEqual(at(600));
    });

    it("handles a single-step schedule (one boundary: the graduation)", () => {
      const single: RampSchedule = {
        steps: [{ coverage: 0.1, holdSeconds: 300 }],
      };
      expect(getNextRampUpdate(single, T0, at(0))).toEqual(at(300));
      expect(getNextRampUpdate(single, T0, at(300))).toEqual(null);
    });
  });
});
