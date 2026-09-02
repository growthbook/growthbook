import {
  FREE_ORG_LIMITS,
  OrgLimits,
  isLegacyProCheckoutAllowed,
  isLimitsFlagDisabled,
  orgDefaultsToSeatlessPro,
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
    expect(result.dataSources).toBeUndefined();
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
      allowLegacyProCheckout: true,
      futurePhaseKey: { anything: true },
    });
    expect(result).toEqual({
      maxProjects: 2,
      customEnvironments: FREE_ORG_LIMITS.customEnvironments,
      roleManagement: FREE_ORG_LIMITS.roleManagement,
    });
  });

  it("stamps dataSources only when the flag explicitly sets a valid value", () => {
    expect(resolveOrgLimitsConfig({ dataSources: "managed-only" })).toEqual({
      maxProjects: FREE_ORG_LIMITS.maxProjects,
      customEnvironments: FREE_ORG_LIMITS.customEnvironments,
      roleManagement: FREE_ORG_LIMITS.roleManagement,
      dataSources: "managed-only",
    });
    expect(
      resolveOrgLimitsConfig({ dataSources: "one-byow-plus-forwarder" })
        .dataSources,
    ).toBe("one-byow-plus-forwarder");
  });

  it("omits dataSources when absent or invalid so orgs stay out of the new cohort", () => {
    expect(resolveOrgLimitsConfig({}).dataSources).toBeUndefined();
    expect(
      resolveOrgLimitsConfig({ dataSources: "unlimited" }).dataSources,
    ).toBeUndefined();
    expect(resolveOrgLimitsConfig({ dataSources: true }).dataSources).toBe(
      undefined,
    );
  });
});

describe("orgDefaultsToSeatlessPro", () => {
  it("is true when dataSources is present on the stamp", () => {
    expect(orgDefaultsToSeatlessPro({ dataSources: "managed-only" })).toBe(
      true,
    );
    expect(
      orgDefaultsToSeatlessPro({ dataSources: "one-byow-plus-forwarder" }),
    ).toBe(true);
  });

  it.each([undefined, null, {}, { maxProjects: 1 }])(
    "is false when dataSources is absent (%s)",
    (limits) => {
      expect(orgDefaultsToSeatlessPro(limits)).toBe(false);
    },
  );
});

describe("isLegacyProCheckoutAllowed", () => {
  it("is false only for an explicit allowLegacyProCheckout: false", () => {
    expect(isLegacyProCheckoutAllowed({ allowLegacyProCheckout: false })).toBe(
      false,
    );
    expect(
      isLegacyProCheckoutAllowed({
        enabled: true,
        allowLegacyProCheckout: false,
      }),
    ).toBe(false);
  });

  it.each([
    ["allowLegacyProCheckout: true", { allowLegacyProCheckout: true }],
    ["missing key", { enabled: true }],
    ["empty object", {}],
    ["null", null],
    ["undefined", undefined],
    ["a string false", { allowLegacyProCheckout: "false" }],
    ["an array", []],
    ["a bare boolean", false],
  ])("stays allowed for %s", (_label, raw) => {
    expect(isLegacyProCheckoutAllowed(raw)).toBe(true);
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
