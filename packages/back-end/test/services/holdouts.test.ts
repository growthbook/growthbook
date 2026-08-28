import { ExperimentInterface } from "shared/types/experiment";
import {
  getHoldoutLivePayloadChanges,
  isHoldoutExperiment,
} from "back-end/src/services/holdouts";

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    type: "holdout",
    phases: [{ coverage: 0.1 }],
    ...overrides,
  } as unknown as ExperimentInterface;
}

function makeHoldout(
  phases: { coverage: number }[],
): ExperimentInterface & { type: "holdout" } {
  return makeExperiment({
    type: "holdout",
    phases: phases as unknown as ExperimentInterface["phases"],
  }) as ExperimentInterface & { type: "holdout" };
}

describe("isHoldoutExperiment", () => {
  it("returns true for holdout experiments", () => {
    expect(isHoldoutExperiment(makeExperiment({ type: "holdout" }))).toBe(true);
  });

  it("returns false for non-holdout experiment types", () => {
    expect(isHoldoutExperiment(makeExperiment({ type: "standard" }))).toBe(
      false,
    );
    expect(
      isHoldoutExperiment(makeExperiment({ type: "multi-armed-bandit" })),
    ).toBe(false);
  });

  it("returns false when type is missing", () => {
    expect(isHoldoutExperiment(makeExperiment({ type: undefined }))).toBe(
      false,
    );
  });
});

describe("getHoldoutLivePayloadChanges", () => {
  const experiment = makeHoldout([{ coverage: 0.1 }]);

  it("reports a change when coverage differs from phase 0", () => {
    expect(getHoldoutLivePayloadChanges(experiment, 0.2)).toEqual({
      changesLivePayload: true,
      changedFields: ["coverage"],
    });
  });

  it("reports no change when coverage matches phase 0", () => {
    expect(getHoldoutLivePayloadChanges(experiment, 0.1)).toEqual({
      changesLivePayload: false,
      changedFields: [],
    });
  });

  it("reports no change when coverage is undefined (unchanged)", () => {
    expect(getHoldoutLivePayloadChanges(experiment, undefined)).toEqual({
      changesLivePayload: false,
      changedFields: [],
    });
  });

  it("uses phase 0 as the payload phase, ignoring later phases", () => {
    const multiPhase = makeHoldout([{ coverage: 0.1 }, { coverage: 0.9 }]);
    // Matches phase 0 (0.1) -> no change, even though phase 1 differs.
    expect(
      getHoldoutLivePayloadChanges(multiPhase, 0.1).changesLivePayload,
    ).toBe(false);
    // Differs from phase 0 -> change.
    expect(
      getHoldoutLivePayloadChanges(multiPhase, 0.5).changesLivePayload,
    ).toBe(true);
  });
});
