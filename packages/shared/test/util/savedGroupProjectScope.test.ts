import type { FeatureInterface } from "../../types/feature";
import {
  featureMetadataEnvelope,
  getRuleTargetingProjectIds,
  isSavedGroupAvailableForProjects,
} from "../../src/util";

describe("Saved Group scope shared by rule pickers and writes", () => {
  it("offers only unscoped groups for a projectless flag", () => {
    const scope = getRuleTargetingProjectIds({ project: "" }, {});
    expect(scope).toEqual([""]);
    expect(isSavedGroupAvailableForProjects({ projects: ["a"] }, scope)).toBe(
      false,
    );
    expect(isSavedGroupAvailableForProjects({ projects: [] }, scope)).toBe(
      true,
    );
  });

  it("requires coverage of the primary and additional targeting Projects", () => {
    const scope = getRuleTargetingProjectIds(
      { project: "a", targetingProjects: ["b"] },
      {},
    );
    expect(isSavedGroupAvailableForProjects({ projects: ["a"] }, scope)).toBe(
      false,
    );
    expect(
      isSavedGroupAvailableForProjects({ projects: ["a", "b"] }, scope),
    ).toBe(true);
  });

  it("narrows scope to the Projects where the rule is delivered", () => {
    const scope = getRuleTargetingProjectIds(
      { project: "a", targetingProjects: ["b"] },
      { allProjects: false, projects: ["b", "c"] },
    );
    expect(scope).toEqual(["b"]);
    expect(isSavedGroupAvailableForProjects({ projects: ["b"] }, scope)).toBe(
      true,
    );
  });

  it("allows only unscoped groups for rules delivered to all Projects", () => {
    const scope = getRuleTargetingProjectIds(
      { project: "a", targetingAllProjects: true },
      {},
    );
    expect(scope).toBeNull();
    expect(isSavedGroupAvailableForProjects({ projects: ["a"] }, scope)).toBe(
      false,
    );
    expect(isSavedGroupAvailableForProjects({}, scope)).toBe(true);
  });

  it("honors explicit rule scope on an all-Projects flag", () => {
    const scope = getRuleTargetingProjectIds(
      { targetingAllProjects: true },
      { allProjects: false, projects: ["b"] },
    );
    expect(scope).toEqual(["b"]);
    expect(isSavedGroupAvailableForProjects({ projects: ["b"] }, scope)).toBe(
      true,
    );
  });

  it("does not constrain groups when the rule reaches no Projects", () => {
    const scope = getRuleTargetingProjectIds(
      { project: "a" },
      { allProjects: false, projects: [] },
    );
    expect(scope).toEqual([]);
    expect(isSavedGroupAvailableForProjects({ projects: ["b"] }, scope)).toBe(
      true,
    );
  });
});

describe("stored revision targeting defaults", () => {
  it("keeps false and empty targeting fields after persistence", () => {
    const metadata = JSON.parse(
      JSON.stringify(
        featureMetadataEnvelope({ project: "a" } as FeatureInterface),
      ),
    );
    expect(metadata).toMatchObject({
      project: "a",
      targetingAllProjects: false,
      targetingProjects: [],
    });
  });

  it("preserves explicit targeting in the metadata snapshot", () => {
    const metadata = featureMetadataEnvelope({
      project: "a",
      targetingAllProjects: true,
      targetingProjects: ["b"],
    } as FeatureInterface);
    expect(metadata).toMatchObject({
      project: "a",
      targetingAllProjects: true,
      targetingProjects: ["b"],
    });
  });
});
