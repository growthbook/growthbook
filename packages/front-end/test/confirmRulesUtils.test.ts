import {
  actionsOf,
  CATEGORIES,
  mergeConfirmRules,
  toggleAction,
} from "@/components/Settings/confirmRulesUtils";

const featureActions = actionsOf("feature");

describe("toggleAction", () => {
  it("checks and unchecks a single action", () => {
    expect(toggleAction([], "feature.publish")).toEqual(["feature.publish"]);
    expect(toggleAction(["feature.publish"], "feature.publish")).toEqual([]);
  });

  it("replaces a category's actions when the whole category is checked", () => {
    expect(toggleAction(["feature.publish"], "feature.*")).toEqual([
      "feature.*",
    ]);
  });

  it("unchecks one action out of its checked category", () => {
    expect(toggleAction(["feature.*"], "feature.delete")).toEqual(
      featureActions.filter((label) => label !== "feature.delete"),
    );
  });

  it("unchecks one row out of All actions", () => {
    expect(toggleAction(["*"], "override.*")).toEqual(
      CATEGORIES.filter((c) => c !== "override").map((c) => `${c}.*`),
    );
    expect(toggleAction(["*"], "feature.delete")).toEqual([
      ...featureActions.filter((label) => label !== "feature.delete"),
      ...CATEGORIES.filter((c) => c !== "feature").map((c) => `${c}.*`),
    ]);
  });

  it("folds a fully checked category, and every category, back into its wildcard", () => {
    const allButDelete = featureActions.filter((l) => l !== "feature.delete");
    expect(toggleAction(allButDelete, "feature.delete")).toEqual(["feature.*"]);
    expect(
      toggleAction(toggleAction(["*"], "feature.delete"), "feature.delete"),
    ).toEqual(["*"]);
  });
});

describe("mergeConfirmRules", () => {
  it("merges rules for the same environments, in any order", () => {
    expect(
      mergeConfirmRules([
        { actions: ["feature.publish"], environments: ["prod", "staging"] },
        { actions: ["experiment.stop"] },
        { actions: ["feature.archive"], environments: ["staging", "prod"] },
      ]),
    ).toEqual([
      {
        actions: ["feature.publish", "feature.archive"],
        environments: ["prod", "staging"],
      },
      { actions: ["experiment.stop"] },
    ]);
  });

  it("folds actions a wildcard already covers", () => {
    expect(
      mergeConfirmRules([
        { actions: ["*"] },
        { actions: ["feature.*", "experiment.*"] },
      ]),
    ).toEqual([{ actions: ["*"] }]);
    expect(
      mergeConfirmRules([
        { actions: ["feature.publish"] },
        { actions: ["feature.*"] },
      ]),
    ).toEqual([{ actions: ["feature.*"] }]);
  });
});
