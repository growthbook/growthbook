import { RECOMMENDED_CONFIRM_ACTIONS } from "shared/validators";
import {
  actionsOf,
  CATEGORIES,
  CATEGORY_TITLES,
  isPicked,
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

describe("recommended", () => {
  it("is picked as a preset, and narrows All actions to itself", () => {
    expect(toggleAction([], "recommended")).toEqual(["recommended"]);
    expect(toggleAction(["*"], "recommended")).toEqual(["recommended"]);
    expect(isPicked(["*"], "recommended")).toBe(true);
    expect(isPicked(["recommended"], "feature.publish")).toBe(true);
    expect(isPicked(["recommended"], "feature.create")).toBe(false);
  });

  it("keeps actions beyond it beside it, folding whole categories", () => {
    const withCreate = toggleAction(["recommended"], "feature.create");
    expect(withCreate).toEqual(["recommended", "feature.create"]);
    expect(toggleAction(withCreate, "feature.draft")).toEqual([
      "recommended",
      "feature.*",
    ]);
    expect(toggleAction(["recommended", "feature.*"], "recommended")).toEqual([
      "feature.create",
      "feature.draft",
    ]);
  });

  it("gives way to its members when one of them is unchecked", () => {
    const picks = toggleAction(["recommended"], "feature.publish");
    expect(picks).not.toContain("recommended");
    expect(isPicked(picks, "feature.publish")).toBe(false);
    expect(
      RECOMMENDED_CONFIRM_ACTIONS.filter((a) => a !== "feature.publish").every(
        (a) => isPicked(picks, a),
      ),
    ).toBe(true);
    expect(toggleAction(picks, "feature.publish")).toEqual(["recommended"]);
  });
});

it("places every category in exactly one section", () => {
  expect([...CATEGORIES].sort()).toEqual(Object.keys(CATEGORY_TITLES).sort());
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
