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

  describe("with invalid stored values", () => {
    const stale = phase({ coverage: 1.5, variationWeights: [0.33, 0.4, 0.3] });

    it("allows ending the phase", () => {
      const ended = { ...stale, dateEnded: new Date(), reason: "Done" };
      expect(() => assertValidExperimentPhases([ended], [stale])).not.toThrow();
    });

    it("rejects them on a phase that starts serving again", () => {
      const restarted = { ...stale, dateStarted: new Date() };
      expect(() =>
        assertValidExperimentPhases([restarted], [stale], true),
      ).toThrow(/invalid_coverage: phase 0/);
      expect(() =>
        assertValidExperimentPhases(
          [{ ...restarted, coverage: 1 }],
          [{ ...stale, coverage: 1 }],
          true,
        ),
      ).toThrow(/invalid_variation_weights: phase 0/);
    });

    it("lets earlier phases keep them when the latest starts serving", () => {
      expect(() =>
        assertValidExperimentPhases([stale, phase()], [stale, phase()], true),
      ).not.toThrow();
    });

    it("allows starting a new phase after it", () => {
      expect(() =>
        assertValidExperimentPhases(
          [{ ...stale, dateEnded: new Date() }, phase()],
          [stale],
        ),
      ).not.toThrow();
    });

    it("rejects a new phase that copies its weights", () => {
      expect(() =>
        assertValidExperimentPhases(
          [
            { ...stale, dateEnded: new Date() },
            { ...stale, coverage: 1 },
          ],
          [stale],
        ),
      ).toThrow(/invalid_variation_weights: phase 1/);
    });

    it("rejects a new phase that copies its coverage", () => {
      expect(() =>
        assertValidExperimentPhases(
          [
            { ...stale, dateEnded: new Date() },
            { ...stale, variationWeights: [0.34, 0.33, 0.33] },
          ],
          [stale],
        ),
      ).toThrow(/invalid_coverage: phase 1/);
    });

    it("rejects copying them onto another phase", () => {
      const live = phase({ variationWeights: [0.34, 0.33, 0.33] });
      expect(() =>
        assertValidExperimentPhases(
          [stale, { ...live, variationWeights: stale.variationWeights }],
          [stale, live],
        ),
      ).toThrow(/invalid_variation_weights: phase 1/);
      expect(() =>
        assertValidExperimentPhases(
          [stale, { ...live, coverage: stale.coverage }],
          [stale, live],
        ),
      ).toThrow(/invalid_coverage: phase 1/);
    });

    it("allows deleting a phase before it", () => {
      expect(() =>
        assertValidExperimentPhases([stale], [phase(), stale]),
      ).not.toThrow();
    });

    it("allows replacing them with valid values", () => {
      expect(() =>
        assertValidExperimentPhases(
          [{ ...stale, coverage: 1, variationWeights: [0.34, 0.33, 0.33] }],
          [stale],
        ),
      ).not.toThrow();
    });

    it("rejects replacing them with other invalid values", () => {
      expect(() =>
        assertValidExperimentPhases([{ ...stale, coverage: 2 }], [stale]),
      ).toThrow(/invalid_coverage: phase 0/);
      expect(() =>
        assertValidExperimentPhases(
          [{ ...stale, coverage: 1, variationWeights: [0.5, 0.6, 0] }],
          [stale],
        ),
      ).toThrow(/invalid_variation_weights: phase 0/);
    });
  });
});
