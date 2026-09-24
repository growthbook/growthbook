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
