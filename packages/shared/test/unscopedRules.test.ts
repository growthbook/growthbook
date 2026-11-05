import { getNewlyUnscopedRules, isUnscopedRule } from "shared/util";

const everywhere = { id: "fr_a", allEnvironments: true };
const inProd = { id: "fr_b", allEnvironments: false, environments: ["prod"] };
const inProject = {
  id: "fr_c",
  allEnvironments: true,
  allProjects: false,
  projects: ["prj_a"],
};

describe("isUnscopedRule", () => {
  it.each([
    ["all environments, all projects", everywhere, true],
    ["legacy rule with no scope fields", { id: "fr_x" }, true],
    [
      "all environments, explicit all projects",
      { ...everywhere, allProjects: true },
      true,
    ],
    ["specific environments", inProd, false],
    ["no environments yet", { ...inProd, environments: [] }, false],
    ["specific projects", inProject, false],
    ["no projects yet", { ...inProject, projects: [] }, false],
    ["legacy project list", { ...everywhere, projects: ["prj_a"] }, false],
  ])("%s", (name, rule, expected) => {
    expect(isUnscopedRule(rule)).toBe(expected);
  });
});

describe("getNewlyUnscopedRules", () => {
  it("flags new unscoped rules and rules widened to everywhere", () => {
    expect(
      getNewlyUnscopedRules(
        [everywhere, { ...inProd, allEnvironments: true }, inProject],
        [inProd, inProject],
      ).map((rule) => rule.id),
    ).toEqual(["fr_a", "fr_b"]);
  });

  it("never matches an earlier rule that has no id", () => {
    const unnamed = { ...everywhere, id: "" };
    expect(getNewlyUnscopedRules([unnamed], [unnamed])).toEqual([unnamed]);
  });

  it("leaves rules that were already unscoped alone", () => {
    expect(
      getNewlyUnscopedRules(
        [{ ...everywhere, description: "x" }],
        [everywhere],
      ),
    ).toEqual([]);
  });
});
