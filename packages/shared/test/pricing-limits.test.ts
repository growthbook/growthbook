import {
  PricingPhase1Config,
  getPlanTier,
  isGrandfathered,
  resolvePlanLimits,
  resolvePricingConfig,
  isEnvironmentIdAllowed,
  isRoleAllowed,
  pricingPhase1ConfigSchema,
  DEFAULT_PRICING_LIMITS,
  UNLIMITED_PLAN_LIMITS,
} from "../src/enterprise/pricing-limits";

const config: PricingPhase1Config = {
  grandfatheringCutoffDate: "2026-07-01",
  projects: { free: 1, pro: 3 },
  environments: { free: "default-only", pro: "default-only" },
  roles: { free: "admin-only" },
};

// Orgs created on/after this are limited; before are grandfathered.
const beforeCutoff = new Date("2026-06-01T00:00:00.000Z");
const afterCutoff = new Date("2026-08-01T00:00:00.000Z");
const atCutoff = new Date("2026-07-01T00:00:00.000Z");

describe("getPlanTier", () => {
  it("maps free tiers", () => {
    expect(getPlanTier("oss")).toBe("free");
    expect(getPlanTier("starter")).toBe("free");
  });
  it("maps pro tiers", () => {
    expect(getPlanTier("pro")).toBe("pro");
    expect(getPlanTier("pro_sso")).toBe("pro");
  });
  it("maps enterprise to exempt", () => {
    expect(getPlanTier("enterprise")).toBe("exempt");
  });
});

describe("isGrandfathered", () => {
  it("is true strictly before the cutoff", () => {
    expect(isGrandfathered(beforeCutoff, config.grandfatheringCutoffDate)).toBe(
      true,
    );
  });
  it("is false on the cutoff (limited)", () => {
    expect(isGrandfathered(atCutoff, config.grandfatheringCutoffDate)).toBe(
      false,
    );
  });
  it("is false after the cutoff", () => {
    expect(isGrandfathered(afterCutoff, config.grandfatheringCutoffDate)).toBe(
      false,
    );
  });
  it("fails open (true) on a malformed cutoff", () => {
    expect(isGrandfathered(afterCutoff, "not-a-date")).toBe(true);
  });
});

describe("DEFAULT cutoff is a fail-open fallback", () => {
  // The real cutoff lives in the flag; the const's value must never cause the
  // fallback (flag unreadable) to wrongly limit anyone. A far-future sentinel
  // means every org is grandfathered until a real cutoff is set in the flag.
  it("grandfathers a brand-new org under the shipped default", () => {
    expect(
      isGrandfathered(
        new Date("2026-07-08T00:00:00.000Z"),
        DEFAULT_PRICING_LIMITS.grandfatheringCutoffDate,
      ),
    ).toBe(true);
  });

  it("resolves a newly-created free org to unlimited under the default config", () => {
    expect(
      resolvePlanLimits({
        effectiveAccountPlan: "starter",
        orgDateCreated: new Date("2026-07-08T00:00:00.000Z"),
        config: DEFAULT_PRICING_LIMITS,
      }),
    ).toEqual(UNLIMITED_PLAN_LIMITS);
  });
});

describe("resolvePlanLimits", () => {
  it("exempts enterprise regardless of date", () => {
    expect(
      resolvePlanLimits({
        effectiveAccountPlan: "enterprise",
        orgDateCreated: afterCutoff,
        config,
      }),
    ).toEqual({
      maxProjects: null,
      environmentPolicy: "all",
      rolePolicy: "full",
    });
  });

  it("exempts grandfathered orgs (can keep creating) on any plan", () => {
    for (const plan of ["oss", "starter", "pro", "pro_sso"] as const) {
      expect(
        resolvePlanLimits({
          effectiveAccountPlan: plan,
          orgDateCreated: beforeCutoff,
          config,
        }),
      ).toEqual({
        maxProjects: null,
        environmentPolicy: "all",
        rolePolicy: "full",
      });
    }
  });

  it("applies free limits to post-cutoff free orgs (oss + starter)", () => {
    for (const plan of ["oss", "starter"] as const) {
      expect(
        resolvePlanLimits({
          effectiveAccountPlan: plan,
          orgDateCreated: afterCutoff,
          config,
        }),
      ).toEqual({
        maxProjects: 1,
        environmentPolicy: "default-only",
        rolePolicy: "admin-only",
      });
    }
  });

  it("applies pro limits to post-cutoff pro orgs, roles unchanged", () => {
    for (const plan of ["pro", "pro_sso"] as const) {
      expect(
        resolvePlanLimits({
          effectiveAccountPlan: plan,
          orgDateCreated: afterCutoff,
          config,
        }),
      ).toEqual({
        maxProjects: 3,
        environmentPolicy: "default-only",
        rolePolicy: "full",
      });
    }
  });

  it("limits an org created exactly at the cutoff", () => {
    expect(
      resolvePlanLimits({
        effectiveAccountPlan: "starter",
        orgDateCreated: atCutoff,
        config,
      }).maxProjects,
    ).toBe(1);
  });

  it("reads limit numbers from the config, not hardcoded", () => {
    const custom: PricingPhase1Config = {
      ...config,
      projects: { free: 2, pro: 5 },
    };
    expect(
      resolvePlanLimits({
        effectiveAccountPlan: "starter",
        orgDateCreated: afterCutoff,
        config: custom,
      }).maxProjects,
    ).toBe(2);
    expect(
      resolvePlanLimits({
        effectiveAccountPlan: "pro",
        orgDateCreated: afterCutoff,
        config: custom,
      }).maxProjects,
    ).toBe(5);
  });

  it("returns a fresh object each call (no shared reference)", () => {
    const a = resolvePlanLimits({
      effectiveAccountPlan: "enterprise",
      orgDateCreated: afterCutoff,
      config,
    });
    a.maxProjects = 99;
    const b = resolvePlanLimits({
      effectiveAccountPlan: "enterprise",
      orgDateCreated: afterCutoff,
      config,
    });
    expect(b.maxProjects).toBe(null);
  });
});

describe("isEnvironmentIdAllowed", () => {
  it("allows anything under the 'all' policy", () => {
    expect(isEnvironmentIdAllowed("my-custom-env", "all")).toBe(true);
  });
  it("allows only default ids under 'default-only'", () => {
    expect(isEnvironmentIdAllowed("production", "default-only")).toBe(true);
    expect(isEnvironmentIdAllowed("dev", "default-only")).toBe(true);
    expect(isEnvironmentIdAllowed("staging", "default-only")).toBe(true);
    expect(isEnvironmentIdAllowed("test", "default-only")).toBe(true);
    expect(isEnvironmentIdAllowed("my-custom-env", "default-only")).toBe(false);
  });
});

describe("isRoleAllowed", () => {
  it("allows any role under the 'full' policy", () => {
    expect(isRoleAllowed("engineer", "full")).toBe(true);
    expect(isRoleAllowed("admin", "full")).toBe(true);
  });
  it("allows only admin under 'admin-only'", () => {
    expect(isRoleAllowed("admin", "admin-only")).toBe(true);
    expect(isRoleAllowed("engineer", "admin-only")).toBe(false);
    expect(isRoleAllowed("readonly", "admin-only")).toBe(false);
  });
});

describe("resolvePricingConfig — always yields a complete, valid config", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty object", {}],
    ["a string", "not-a-config"],
    ["a number", 42],
    ["an array", []],
  ])("falls back to the full default for %s", (_label, raw) => {
    expect(resolvePricingConfig(raw)).toEqual(DEFAULT_PRICING_LIMITS);
  });

  it("passes through a complete, valid flag value", () => {
    const config: PricingPhase1Config = {
      grandfatheringCutoffDate: "2026-09-01",
      projects: { free: 2, pro: 10 },
      environments: { free: "all", pro: "all" },
      roles: { free: "full" },
    };
    expect(resolvePricingConfig(config)).toEqual(config);
  });

  it("ignores unknown keys but keeps valid known fields", () => {
    const result = resolvePricingConfig({
      projects: { free: 5, pro: 9 },
      futurePhaseKey: { anything: true },
    });
    expect(result.projects).toEqual({ free: 5, pro: 9 });
    // untouched fields come from the default
    expect(result.environments).toEqual(DEFAULT_PRICING_LIMITS.environments);
    expect(result.roles).toEqual(DEFAULT_PRICING_LIMITS.roles);
  });

  it("fills missing fields from the default (partial override)", () => {
    const result = resolvePricingConfig({ projects: { free: 4 } });
    // provided field honored
    expect(result.projects.free).toBe(4);
    // sibling + all other fields default
    expect(result.projects.pro).toBe(DEFAULT_PRICING_LIMITS.projects.pro);
    expect(result.grandfatheringCutoffDate).toBe(
      DEFAULT_PRICING_LIMITS.grandfatheringCutoffDate,
    );
    expect(result.environments).toEqual(DEFAULT_PRICING_LIMITS.environments);
    expect(result.roles).toEqual(DEFAULT_PRICING_LIMITS.roles);
  });

  it("falls back per-field when a field is present but invalid", () => {
    const result = resolvePricingConfig({
      grandfatheringCutoffDate: "nonsense-date",
      projects: { free: -1, pro: 3.5 },
      environments: { free: "bogus-policy" },
      roles: { free: 123 },
    });
    expect(result.grandfatheringCutoffDate).toBe(
      DEFAULT_PRICING_LIMITS.grandfatheringCutoffDate,
    );
    expect(result.projects.free).toBe(DEFAULT_PRICING_LIMITS.projects.free);
    expect(result.projects.pro).toBe(DEFAULT_PRICING_LIMITS.projects.pro);
    expect(result.environments.free).toBe(
      DEFAULT_PRICING_LIMITS.environments.free,
    );
    expect(result.roles.free).toBe(DEFAULT_PRICING_LIMITS.roles.free);
  });

  it("honors an explicitly tighter value from the flag (free = 0)", () => {
    // The flag intentionally setting a stricter limit is honored; only a
    // missing/invalid field falls back to the (looser) shipped default.
    const result = resolvePricingConfig({ projects: { free: 0, pro: 0 } });
    expect(result.projects).toEqual({ free: 0, pro: 0 });
  });

  it("always returns a schema-valid config even for garbage input", () => {
    for (const raw of [null, {}, "x", { projects: "nope" }, { roles: 5 }]) {
      expect(() =>
        pricingPhase1ConfigSchema.parse(resolvePricingConfig(raw)),
      ).not.toThrow();
    }
  });
});

describe("pricingPhase1ConfigSchema + DEFAULT_PRICING_LIMITS", () => {
  it("the in-app default validates against the schema", () => {
    expect(() =>
      pricingPhase1ConfigSchema.parse(DEFAULT_PRICING_LIMITS),
    ).not.toThrow();
  });
  it("rejects a malformed cutoff date", () => {
    expect(
      pricingPhase1ConfigSchema.safeParse({
        ...DEFAULT_PRICING_LIMITS,
        grandfatheringCutoffDate: "nope",
      }).success,
    ).toBe(false);
  });
  it("strips unknown keys rather than failing (forward-compatible)", () => {
    const parsed = pricingPhase1ConfigSchema.parse({
      ...DEFAULT_PRICING_LIMITS,
      futurePhaseKey: { something: true },
    });
    expect("futurePhaseKey" in parsed).toBe(false);
    expect(parsed.projects.free).toBe(1);
  });
});
