import {
  FREE_ORG_LIMITS,
  OrgLimits,
  resolveOrgLimitsConfig,
} from "shared/enterprise";

// resolveOrgLimitsConfig turns the pricing-phase-1-limits flag value into the
// OrgLimits stamped onto newly created free orgs. It must ALWAYS return a
// complete stamp: per-field fallback to FREE_ORG_LIMITS, valid fields honored.
describe("resolveOrgLimitsConfig", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty object", {}],
    ["a string", "not-a-config"],
    ["a number", 42],
    ["an array", []],
  ])("falls back to FREE_ORG_LIMITS for %s", (_label, raw) => {
    expect(resolveOrgLimitsConfig(raw)).toEqual({
      maxProjects: FREE_ORG_LIMITS.maxProjects,
      customEnvironments: FREE_ORG_LIMITS.customEnvironments,
      roleManagement: FREE_ORG_LIMITS.roleManagement,
    });
  });

  it("passes through a complete, valid flag value", () => {
    const config: OrgLimits = {
      maxProjects: 5,
      customEnvironments: true,
      roleManagement: true,
    };
    expect(resolveOrgLimitsConfig(config)).toEqual(config);
  });

  it("fills missing fields from the default (partial override)", () => {
    const result = resolveOrgLimitsConfig({ maxProjects: 3 });
    expect(result.maxProjects).toBe(3);
    expect(result.customEnvironments).toBe(
      FREE_ORG_LIMITS.customEnvironments,
    );
    expect(result.roleManagement).toBe(FREE_ORG_LIMITS.roleManagement);
  });

  it("falls back per-field when a field is present but invalid", () => {
    const result = resolveOrgLimitsConfig({
      maxProjects: -1,
      customEnvironments: "yes",
      roleManagement: 1,
    });
    expect(result.maxProjects).toBe(FREE_ORG_LIMITS.maxProjects);
    expect(result.customEnvironments).toBe(
      FREE_ORG_LIMITS.customEnvironments,
    );
    expect(result.roleManagement).toBe(FREE_ORG_LIMITS.roleManagement);
  });

  it("honors explicit unlimited (maxProjects: null) from the flag", () => {
    // null means unlimited in OrgLimits — a valid value, not a fallback case.
    expect(resolveOrgLimitsConfig({ maxProjects: null }).maxProjects).toBe(
      null,
    );
  });

  it("ignores unknown keys", () => {
    const result = resolveOrgLimitsConfig({
      maxProjects: 2,
      futurePhaseKey: { anything: true },
    });
    expect(result).toEqual({
      maxProjects: 2,
      customEnvironments: FREE_ORG_LIMITS.customEnvironments,
      roleManagement: FREE_ORG_LIMITS.roleManagement,
    });
  });
});
