import {
  DEFAULT_ORG_LIMITS,
  OrgLimits,
  isLimitsFlagDisabled,
  resolveOrgLimitsConfig,
} from "shared/enterprise";

describe("resolveOrgLimitsConfig", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty object", {}],
    ["a string", "not-a-config"],
    ["a number", 42],
    ["an array", []],
  ])("falls back to the defaults for %s", (_label, raw) => {
    expect(resolveOrgLimitsConfig(raw)).toEqual({
      maxProjects: DEFAULT_ORG_LIMITS.free.maxProjects,
      customEnvironments: DEFAULT_ORG_LIMITS.free.customEnvironments,
      roleManagement: DEFAULT_ORG_LIMITS.free.roleManagement,
    });
  });

  it("passes through a complete, valid free tier", () => {
    const free: OrgLimits = {
      maxProjects: 5,
      customEnvironments: true,
      roleManagement: true,
    };
    expect(resolveOrgLimitsConfig({ enabled: true, free })).toEqual(free);
  });

  it("falls back fully for a legacy flat (un-tiered) value", () => {
    // The flag is keyed by tier; a flat value has no `free` key and must not
    // be silently interpreted.
    expect(
      resolveOrgLimitsConfig({ maxProjects: 99, customEnvironments: true }),
    ).toEqual(DEFAULT_ORG_LIMITS.free);
  });

  it("fills missing fields from the default (partial override)", () => {
    const result = resolveOrgLimitsConfig({ free: { maxProjects: 3 } });
    expect(result.maxProjects).toBe(3);
    expect(result.customEnvironments).toBe(
      DEFAULT_ORG_LIMITS.free.customEnvironments,
    );
    expect(result.roleManagement).toBe(DEFAULT_ORG_LIMITS.free.roleManagement);
  });

  it("falls back per-field when a field is present but invalid", () => {
    const result = resolveOrgLimitsConfig({
      free: { maxProjects: -1, customEnvironments: "yes", roleManagement: 1 },
    });
    expect(result.maxProjects).toBe(DEFAULT_ORG_LIMITS.free.maxProjects);
    expect(result.customEnvironments).toBe(
      DEFAULT_ORG_LIMITS.free.customEnvironments,
    );
    expect(result.roleManagement).toBe(DEFAULT_ORG_LIMITS.free.roleManagement);
  });

  it("honors explicit unlimited (maxProjects: null) from the flag", () => {
    // null means unlimited in OrgLimits — a valid value, not a fallback case.
    expect(
      resolveOrgLimitsConfig({ free: { maxProjects: null } }).maxProjects,
    ).toBe(null);
  });

  it("ignores sibling keys: enabled, future tiers, and unknowns", () => {
    const result = resolveOrgLimitsConfig({
      enabled: false,
      free: { maxProjects: 2 },
      pro: { maxProjects: 3 }, // reserved for later — not wired today
      futurePhaseKey: { anything: true },
    });
    expect(result).toEqual({
      maxProjects: 2,
      customEnvironments: DEFAULT_ORG_LIMITS.free.customEnvironments,
      roleManagement: DEFAULT_ORG_LIMITS.free.roleManagement,
    });
  });
});

// The same flag's enforcement-time on/off switch. Only an explicit
// `enabled: false` disables; every failure mode stays enabled so an
// unreachable flag falls back to the stamped snapshot.
describe("isLimitsFlagDisabled", () => {
  it("is true only for an explicit enabled: false", () => {
    expect(isLimitsFlagDisabled({ enabled: false })).toBe(true);
    expect(isLimitsFlagDisabled({ enabled: false, maxProjects: 1 })).toBe(true);
  });

  it.each([
    ["enabled: true", { enabled: true }],
    ["missing enabled", { maxProjects: 1 }],
    ["empty object", {}],
    ["null", null],
    ["undefined", undefined],
    ["a string false", { enabled: "false" }],
    ["enabled: 0", { enabled: 0 }],
    ["an array", []],
    ["a bare boolean", false],
  ])("stays enabled for %s", (_label, raw) => {
    expect(isLimitsFlagDisabled(raw)).toBe(false);
  });
});
