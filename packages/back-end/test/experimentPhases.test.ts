import { ExperimentPhase } from "shared/types/experiment";
import { assertValidExperimentPhases } from "back-end/src/services/experiments";

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

  it.each([1.7, -0.1, Number.NaN])("rejects coverage %p", (coverage) => {
    expect(() => assertValidExperimentPhases([phase({ coverage })])).toThrow(
      /invalid_coverage: phase 0/,
    );
  });

  it.each([[[2, -1]], [[1.5, 0]], [[50, 50]], [[0.2, 0.2]], [[0, 0]], [[]]])(
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

  it("allows renaming a phase without changing legacy allocations", () => {
    const stale = phase({ coverage: 1.5, variationWeights: [50, 50] });
    expect(() =>
      assertValidExperimentPhases([{ ...stale, name: "Renamed" }], [stale]),
    ).not.toThrow();
  });

  it("preserves unchanged legacy NaN coverage on metadata edits", () => {
    const stale = phase({ coverage: Number.NaN });
    expect(() =>
      assertValidExperimentPhases([{ ...stale, name: "Renamed" }], [stale]),
    ).not.toThrow();
  });

  it("allows closing a phase with legacy zero weights", () => {
    const stale = phase({ variationWeights: [0, 0] });
    expect(() =>
      assertValidExperimentPhases(
        [{ ...stale, dateEnded: new Date("2026-01-02T00:00:00Z") }],
        [stale],
      ),
    ).not.toThrow();
  });

  it("allows fixing coverage while preserving legacy weights", () => {
    const stale = phase({ coverage: 1.5, variationWeights: [0, 0] });
    expect(() =>
      assertValidExperimentPhases([{ ...stale, coverage: 0 }], [stale]),
    ).not.toThrow();
  });

  it("allows fixing weights while preserving legacy coverage", () => {
    const stale = phase({ coverage: 1.5, variationWeights: [0, 0] });
    expect(() =>
      assertValidExperimentPhases(
        [{ ...stale, variationWeights: [0.5, 0.5] }],
        [stale],
      ),
    ).not.toThrow();
  });

  it.each([1.5, Number.NaN])(
    "rejects changes to coverage %p despite legacy weights",
    (coverage) => {
      const stale = phase({ variationWeights: [0, 0] });
      expect(() =>
        assertValidExperimentPhases([{ ...stale, coverage }], [stale]),
      ).toThrow(/invalid_coverage: phase 0/);
    },
  );

  it("rejects changes to invalid weights despite legacy coverage", () => {
    const stale = phase({ coverage: 1.5, variationWeights: [50, 50] });
    expect(() =>
      assertValidExperimentPhases(
        [{ ...stale, variationWeights: [0, 0] }],
        [stale],
      ),
    ).toThrow(/invalid_variation_weights: phase 0/);
  });

  it("validates legacy allocations copied into a new phase", () => {
    const stale = phase({ variationWeights: [0, 0] });
    expect(() =>
      assertValidExperimentPhases([stale, { ...stale, name: "New" }], [stale]),
    ).toThrow(/invalid_variation_weights: phase 1/);
  });
});
