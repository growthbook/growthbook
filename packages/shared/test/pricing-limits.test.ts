import {
  FREE_ORG_LIMITS,
  PRO_ORG_LIMITS,
  PAID_PLAN_LIMITS_START_DATE,
  OrgLimits,
  isLimitsFlagDisabled,
  resolveOrgLimitsConfig,
  shouldStampOrgLimits,
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
      maxProjects: FREE_ORG_LIMITS.maxProjects,
      customEnvironments: FREE_ORG_LIMITS.customEnvironments,
      roleManagement: FREE_ORG_LIMITS.roleManagement,
    });
  });

  it("passes through a complete, valid value", () => {
    const limits: OrgLimits = {
      maxProjects: 5,
      customEnvironments: true,
      roleManagement: true,
    };
    expect(resolveOrgLimitsConfig({ enabled: true, ...limits })).toEqual(
      limits,
    );
  });

  it("fills missing fields from the default (partial override)", () => {
    const result = resolveOrgLimitsConfig({ maxProjects: 3 });
    expect(result.maxProjects).toBe(3);
    expect(result.customEnvironments).toBe(FREE_ORG_LIMITS.customEnvironments);
    expect(result.roleManagement).toBe(FREE_ORG_LIMITS.roleManagement);
  });

  it("falls back per-field when a field is present but invalid", () => {
    const result = resolveOrgLimitsConfig({
      maxProjects: -1,
      customEnvironments: "yes",
      roleManagement: 1,
    });
    expect(result.maxProjects).toBe(FREE_ORG_LIMITS.maxProjects);
    expect(result.customEnvironments).toBe(FREE_ORG_LIMITS.customEnvironments);
    expect(result.roleManagement).toBe(FREE_ORG_LIMITS.roleManagement);
  });

  it("honors explicit unlimited (maxProjects: null) from the flag", () => {
    expect(resolveOrgLimitsConfig({ maxProjects: null }).maxProjects).toBe(
      null,
    );
  });

  it("ignores sibling keys: enabled and unknowns", () => {
    const result = resolveOrgLimitsConfig({
      enabled: false,
      maxProjects: 2,
      futurePhaseKey: { anything: true },
    });
    expect(result).toEqual({
      maxProjects: 2,
      customEnvironments: FREE_ORG_LIMITS.customEnvironments,
      roleManagement: FREE_ORG_LIMITS.roleManagement,
    });
  });

  describe("per-tier fallback", () => {
    it("falls back to the supplied tier defaults instead of free", () => {
      expect(resolveOrgLimitsConfig({}, PRO_ORG_LIMITS)).toEqual({
        maxProjects: PRO_ORG_LIMITS.maxProjects,
        customEnvironments: PRO_ORG_LIMITS.customEnvironments,
        roleManagement: PRO_ORG_LIMITS.roleManagement,
      });
    });

    it("still lets the flag override individual tier fields", () => {
      const result = resolveOrgLimitsConfig({ maxProjects: 5 }, PRO_ORG_LIMITS);
      expect(result.maxProjects).toBe(5);
      expect(result.roleManagement).toBe(PRO_ORG_LIMITS.roleManagement);
    });

    it("falls back per-field when the flag serves an invalid value", () => {
      const result = resolveOrgLimitsConfig(
        { maxProjects: "three" },
        PRO_ORG_LIMITS,
      );
      expect(result.maxProjects).toBe(PRO_ORG_LIMITS.maxProjects);
    });
  });
});

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

describe("shouldStampOrgLimits", () => {
  const beforeCutoff = new Date(PAID_PLAN_LIMITS_START_DATE.getTime() - 1);
  const afterCutoff = new Date(PAID_PLAN_LIMITS_START_DATE.getTime() + 1);

  it.each([null, undefined, { enabled: true, ...FREE_ORG_LIMITS }])(
    "does not stamp before the cutoff even when the flag is %p",
    (raw) => {
      expect(shouldStampOrgLimits({ dateCreated: beforeCutoff }, raw)).toBe(
        false,
      );
    },
  );

  it.each([null, undefined])(
    "allows default stamps exactly at the cutoff when the flag is %p",
    (raw) => {
      expect(
        shouldStampOrgLimits({ dateCreated: PAID_PLAN_LIMITS_START_DATE }, raw),
      ).toBe(true);
    },
  );

  it("applies the cutoff to serialized signup dates", () => {
    expect(
      shouldStampOrgLimits({ dateCreated: beforeCutoff.toISOString() }, null),
    ).toBe(false);
    expect(
      shouldStampOrgLimits({ dateCreated: afterCutoff.toISOString() }, null),
    ).toBe(true);
  });

  it.each(["not-a-date", new Date(NaN)])(
    "does not stamp an invalid signup date (%p)",
    (dateCreated) => {
      expect(shouldStampOrgLimits({ dateCreated }, null)).toBe(false);
    },
  );

  it.each([null, undefined])(
    "stamps the defaults when the flag is missing (%p)",
    (raw) => {
      expect(shouldStampOrgLimits({ dateCreated: afterCutoff }, raw)).toBe(
        true,
      );
      expect(resolveOrgLimitsConfig(raw)).toEqual(FREE_ORG_LIMITS);
    },
  );

  it.each([
    { label: "a string", raw: "not-a-config" },
    { label: "a number", raw: 42 },
    { label: "an array", raw: [] },
  ])("does not stamp when the flag served $label", ({ raw }) => {
    expect(shouldStampOrgLimits({ dateCreated: afterCutoff }, raw)).toBe(false);
  });

  it("does not stamp when the flag is explicitly disabled", () => {
    expect(
      shouldStampOrgLimits({ dateCreated: afterCutoff }, { enabled: false }),
    ).toBe(false);
    expect(
      shouldStampOrgLimits(
        { dateCreated: afterCutoff },
        { enabled: false, ...FREE_ORG_LIMITS },
      ),
    ).toBe(false);
  });

  it("stamps when the flag served a config", () => {
    expect(
      shouldStampOrgLimits(
        { dateCreated: afterCutoff },
        { enabled: true, ...FREE_ORG_LIMITS },
      ),
    ).toBe(true);
    expect(shouldStampOrgLimits({ dateCreated: afterCutoff }, {})).toBe(true);
  });
});
