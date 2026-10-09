import {
  actionsOf,
  CATEGORIES,
  describeActions,
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

describe("describeActions", () => {
  it("groups actions by category with their environments", () => {
    expect(
      describeActions([
        { action: "feature.publish", environments: ["production"] },
        { action: "override.skipHooks", environments: [] },
        { action: "feature.archive", environments: ["production"] },
      ]),
    ).toBe(
      "Feature Flags (publish, archive) in production; Overrides (skip hooks)",
    );
  });
});
