import { getScopedSettings } from "shared/settings";
import { ExperimentInterface, ExperimentPhase } from "shared/types/experiment";
import { assertValidExperimentPhases } from "back-end/src/services/experiments";
import {
  getNewPhaseBucketing,
  getRestartChanges,
} from "back-end/src/services/experimentChanges/phases";

const phase = (overrides: Partial<ExperimentPhase> = {}): ExperimentPhase => ({
  dateStarted: new Date("2026-01-01T00:00:00Z"),
  name: "Main",
  reason: "",
  coverage: 1,
  condition: "",
  variationWeights: [0.5, 0.5],
  variations: [
    { id: "var_a", status: "active" },
    { id: "var_b", status: "active" },
  ],
  ...overrides,
});

describe("assertValidExperimentPhases", () => {
  it("accepts coverage and weights within bounds", () => {
    expect(() =>
      assertValidExperimentPhases([
        phase(),
        phase({ coverage: 0, variationWeights: [1, 0] }),
        phase({ coverage: 0.3, variationWeights: [0.333, 0.333, 0.334] }),
      ]),
    ).not.toThrow();
  });

  it.each([1.7, -0.1])("rejects coverage %p", (coverage) => {
    expect(() => assertValidExperimentPhases([phase({ coverage })])).toThrow(
      /invalid_coverage: phase 0/,
    );
  });

  it.each([[[2, -1]], [[1.5, 0]], [[50, 50]], [[0.2, 0.2]], [[]]])(
    "rejects variation weights %p",
    (variationWeights) => {
      expect(() =>
        assertValidExperimentPhases([phase(), phase({ variationWeights })]),
      ).toThrow(/invalid_variation_weights: phase 1/);
    },
  );

  it("skips phases that are unchanged from the stored ones", () => {
    const stale = phase({ coverage: 1.5, variationWeights: [50, 50] });
    expect(() =>
      assertValidExperimentPhases([stale, phase()], [stale]),
    ).not.toThrow();
  });

  it("checks a stored phase that the write modifies", () => {
    const stale = phase({ coverage: 1.5 });
    expect(() =>
      assertValidExperimentPhases([{ ...stale, name: "Renamed" }], [stale]),
    ).toThrow(/invalid_coverage/);
  });
});

describe("getNewPhaseBucketing", () => {
  const experiment = {
    bucketVersion: 2,
    minBucketVersion: 1,
    disableStickyBucketing: false,
  };

  it("leaves bucket versions alone without sticky bucketing", () => {
    expect(getNewPhaseBucketing("new-phase", experiment, false)).toEqual({
      reseed: true,
      bucketVersion: 2,
      minBucketVersion: 1,
    });
    expect(
      getNewPhaseBucketing(
        "new-phase-block-sticky",
        { ...experiment, disableStickyBucketing: true },
        true,
      ),
    ).toEqual({ reseed: true, bucketVersion: 2, minBucketVersion: 1 });
  });

  it("matches the app's release plans with sticky bucketing", () => {
    expect(getNewPhaseBucketing("new-phase", experiment, true)).toEqual({
      reseed: true,
      bucketVersion: 3,
      minBucketVersion: 1,
    });
    expect(
      getNewPhaseBucketing("new-phase-same-seed", experiment, true),
    ).toEqual({ reseed: false, bucketVersion: 2, minBucketVersion: 1 });
    expect(
      getNewPhaseBucketing("new-phase-block-sticky", experiment, true),
    ).toEqual({ reseed: true, bucketVersion: 3, minBucketVersion: 3 });
  });
});

describe("getRestartChanges", () => {
  const { settings } = getScopedSettings({ organization: { settings: {} } });

  it("reopens the last phase", () => {
    const experiment = {
      type: "standard",
      phases: [phase({ dateEnded: new Date("2026-02-01T00:00:00Z") })],
    } as unknown as ExperimentInterface;
    const changes = getRestartChanges(experiment, settings);
    expect(changes.phases).toHaveLength(1);
    expect(changes.phases?.[0].dateEnded).toBeUndefined();
    expect(changes.bucketVersion).toBeUndefined();
  });

  it("starts a new phase with fresh buckets for bandits", () => {
    const experiment = {
      type: "multi-armed-bandit",
      bucketVersion: 1,
      phases: [phase({ dateEnded: new Date("2026-02-01T00:00:00Z") })],
      variations: [],
      goalMetrics: [],
    } as unknown as ExperimentInterface;
    const changes = getRestartChanges(experiment, settings);
    expect(changes.phases).toHaveLength(2);
    expect(changes.phases?.[0].dateEnded).toBeInstanceOf(Date);
    expect(changes.phases?.[1].seed).not.toBe(experiment.phases[0].seed);
    expect(changes.bucketVersion).toBe(2);
    expect(changes.minBucketVersion).toBe(2);
  });
});
