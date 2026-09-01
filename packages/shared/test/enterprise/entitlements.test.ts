import {
  makeOrgLimits,
  planTierFor,
  FREE_ORG_LIMITS,
  PRO_ORG_LIMITS,
} from "shared/enterprise";
import type { AccountPlan, OrgLimits } from "shared/enterprise";

const FREE_LIMITS: OrgLimits = FREE_ORG_LIMITS;

const LICENSE_LIMITS: OrgLimits = {
  maxProjects: 7,
  customEnvironments: false,
  roleManagement: false,
};

function accessorFor({
  effectivePlan,
  orgLimits,
  licenseLimits,
  planLimits,
}: {
  effectivePlan: AccountPlan;
  orgLimits?: OrgLimits;
  licenseLimits?: OrgLimits;
  planLimits?: OrgLimits;
}) {
  return makeOrgLimits({
    effectivePlan,
    orgLimits,
    licenseLimits,
    planLimits,
  });
}

describe("planTierFor", () => {
  it("maps free plans to the free tier", () => {
    expect(planTierFor("oss")).toBe("free");
    expect(planTierFor("starter")).toBe("free");
  });

  it("maps pro plans to the pro tier", () => {
    expect(planTierFor("pro")).toBe("pro");
    expect(planTierFor("pro_sso")).toBe("pro");
  });

  it("leaves enterprise untiered so it is never limited", () => {
    expect(planTierFor("enterprise")).toBeNull();
  });
});

describe("makeOrgLimits", () => {
  describe("grandfathered orgs (no stored limits)", () => {
    it.each<AccountPlan>(["oss", "starter", "pro", "pro_sso", "enterprise"])(
      "is unrestricted on plan=%s when no limits are stored anywhere",
      (effectivePlan) => {
        const limits = accessorFor({ effectivePlan });
        expect(limits.getMaxProjects()).toBeNull();
        expect(limits.isEnvironmentIdAllowed("some-custom-env")).toBe(true);
        expect(limits.orgSupportsRoles()).toBe(true);
      },
    );

    it("stays unrestricted on pro even when pro limits are configured", () => {
      const limits = accessorFor({
        effectivePlan: "pro",
        planLimits: PRO_ORG_LIMITS,
      });
      expect(limits.getMaxProjects()).toBeNull();
    });
  });

  describe("free plans (oss/starter) read org limits, ignore license limits", () => {
    it.each<AccountPlan>(["oss", "starter"])(
      "enforces org.limits on plan=%s",
      (effectivePlan) => {
        const limits = accessorFor({
          effectivePlan,
          orgLimits: FREE_LIMITS,
          licenseLimits: { maxProjects: 999 }, // should be ignored on free plans
          planLimits: PRO_ORG_LIMITS, // free never reads the live per-plan config
        });
        expect(limits.getMaxProjects()).toBe(1);
        expect(limits.isEnvironmentIdAllowed("production")).toBe(true);
        expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(false);
        expect(limits.orgSupportsRoles()).toBe(false);
      },
    );
  });

  describe("pro plans", () => {
    it.each<AccountPlan>(["pro", "pro_sso"])(
      "upgrades a stamped org to the pro tier's limits on plan=%s",
      (effectivePlan) => {
        // The stamp holds free values (every org is created free), so a pro org
        // must not be held to maxProjects: 1.
        const limits = accessorFor({ effectivePlan, orgLimits: FREE_LIMITS });
        expect(limits.getMaxProjects()).toBe(3);
        expect(limits.isEnvironmentIdAllowed("production")).toBe(true);
        expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(false);
        expect(limits.orgSupportsRoles()).toBe(true);
      },
    );

    it("prefers the live per-plan config over the hardcoded pro defaults", () => {
      const limits = accessorFor({
        effectivePlan: "pro",
        orgLimits: FREE_LIMITS,
        planLimits: { ...PRO_ORG_LIMITS, maxProjects: 10 },
      });
      expect(limits.getMaxProjects()).toBe(10);
    });

    it("lets an explicit license snapshot win over the tier defaults", () => {
      const limits = accessorFor({
        effectivePlan: "pro",
        orgLimits: FREE_LIMITS,
        licenseLimits: LICENSE_LIMITS,
        planLimits: PRO_ORG_LIMITS,
      });
      expect(limits.getMaxProjects()).toBe(7);
      expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(false);
    });

    it("keeps role management even if a license snapshot revokes it", () => {
      // Pro has the role-management commercial feature, so roles are never
      // gated by a limits snapshot on that plan.
      const limits = accessorFor({
        effectivePlan: "pro",
        orgLimits: FREE_LIMITS,
        licenseLimits: LICENSE_LIMITS,
      });
      expect(limits.orgSupportsRoles()).toBe(true);
    });
  });

  describe("enterprise is never affected by plan limits", () => {
    it("ignores a stamped org snapshot", () => {
      const limits = accessorFor({
        effectivePlan: "enterprise",
        orgLimits: FREE_LIMITS,
      });
      expect(limits.getMaxProjects()).toBeNull();
      expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(true);
      expect(limits.orgSupportsRoles()).toBe(true);
    });

    it("ignores a license snapshot", () => {
      const limits = accessorFor({
        effectivePlan: "enterprise",
        orgLimits: FREE_LIMITS,
        licenseLimits: LICENSE_LIMITS,
      });
      expect(limits.getMaxProjects()).toBeNull();
      expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(true);
      expect(limits.orgSupportsRoles()).toBe(true);
    });
  });

  describe("field-level defaults within a stored snapshot", () => {
    it("treats a missing maxProjects as unlimited even if other fields are restricted", () => {
      const limits = accessorFor({
        effectivePlan: "oss",
        orgLimits: { customEnvironments: false, roleManagement: false },
      });
      expect(limits.getMaxProjects()).toBeNull();
    });

    it("treats customEnvironments !== false as allowed (true or absent)", () => {
      expect(
        accessorFor({
          effectivePlan: "oss",
          orgLimits: { customEnvironments: true },
        }).isEnvironmentIdAllowed("custom-env"),
      ).toBe(true);
      expect(
        accessorFor({
          effectivePlan: "oss",
          orgLimits: {},
        }).isEnvironmentIdAllowed("custom-env"),
      ).toBe(true);
    });

    it("always allows the four default environment ids even when restricted", () => {
      const limits = accessorFor({
        effectivePlan: "oss",
        orgLimits: { customEnvironments: false },
      });
      expect(limits.isEnvironmentIdAllowed("production")).toBe(true);
      expect(limits.isEnvironmentIdAllowed("dev")).toBe(true);
      expect(limits.isEnvironmentIdAllowed("staging")).toBe(true);
      expect(limits.isEnvironmentIdAllowed("test")).toBe(true);
    });
  });
});
