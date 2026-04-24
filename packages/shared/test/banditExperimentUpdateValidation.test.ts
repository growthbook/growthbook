import { getBanditRestrictedFieldErrorsForExperimentUpdate } from "../src/validators/experiments";

describe("getBanditRestrictedFieldErrorsForExperimentUpdate", () => {
  it("rejects maxExperimentDuration when type is omitted but persisted experiment is a bandit", () => {
    expect(
      getBanditRestrictedFieldErrorsForExperimentUpdate(
        { maxExperimentDuration: { value: 1, unit: "days" } },
        "multi-armed-bandit",
      ),
    ).toEqual([
      "maxExperimentDuration is not supported for multi-armed-bandit experiments",
    ]);
  });

  it("rejects targetSampleSize when type is omitted but persisted experiment is a bandit", () => {
    expect(
      getBanditRestrictedFieldErrorsForExperimentUpdate(
        { targetSampleSize: 1000 },
        "multi-armed-bandit",
      ),
    ).toEqual([
      "targetSampleSize is not supported for multi-armed-bandit experiments",
    ]);
  });

  it("allows maxExperimentDuration when converting a bandit to standard in the same request", () => {
    expect(
      getBanditRestrictedFieldErrorsForExperimentUpdate(
        {
          type: "standard",
          maxExperimentDuration: { value: 7, unit: "days" },
        },
        "multi-armed-bandit",
      ),
    ).toEqual([]);
  });

  it("rejects when body type is bandit regardless of persisted type", () => {
    expect(
      getBanditRestrictedFieldErrorsForExperimentUpdate(
        {
          type: "multi-armed-bandit",
          maxExperimentDuration: { value: 1, unit: "weeks" },
        },
        "standard",
      ),
    ).toEqual([
      "maxExperimentDuration is not supported for multi-armed-bandit experiments",
    ]);
  });

  it("allows caps on a standard experiment when type is omitted", () => {
    expect(
      getBanditRestrictedFieldErrorsForExperimentUpdate(
        {
          maxExperimentDuration: { value: 1, unit: "days" },
          targetSampleSize: 500,
        },
        "standard",
      ),
    ).toEqual([]);
  });
});
