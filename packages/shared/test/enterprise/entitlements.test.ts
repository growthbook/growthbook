import {
  makeOrgLimits,
  planTierFor,
  FREE_ORG_LIMITS,
  PRO_ORG_LIMITS,
  PAID_PLAN_LIMITS_START_DATE,
} from "shared/enterprise";
import type { AccountPlan, OrgLimits } from "shared/enterprise";

const FREE_LIMITS: OrgLimits = FREE_ORG_LIMITS;

const LICENSE_LIMITS: OrgLimits = {
  maxProjects: 7,
  customEnvironments: false,
  roleManagement: false,
};

const AFTER_CUTOFF = new Date(PAID_PLAN_LIMITS_START_DATE.getTime() + 1);
const BEFORE_CUTOFF = new Date(PAID_PLAN_LIMITS_START_DATE.getTime() - 1);

function accessorFor({
  effectivePlan,
  orgLimits,
  licenseLimits,
  planLimits,
  orgDateCreated = AFTER_CUTOFF,
}: {
  effectivePlan: AccountPlan;
  orgLimits?: OrgLimits;
  licenseLimits?: OrgLimits;
  planLimits?: OrgLimits;
  orgDateCreated?: Date | string;
}) {
  return makeOrgLimits({
    effectivePlan,
    orgLimits,
    licenseLimits,
    planLimits,
    orgDateCreated,
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
      const limits = accessorFor({
        effectivePlan: "pro",
        orgLimits: FREE_LIMITS,
        licenseLimits: LICENSE_LIMITS,
      });
      expect(limits.orgSupportsRoles()).toBe(true);
    });
  });

  describe("orgs that signed up before paid plan limits shipped", () => {
    it.each<AccountPlan>(["pro", "pro_sso"])(
      "keeps a stamped org unrestricted on plan=%s",
      (effectivePlan) => {
        const limits = accessorFor({
          effectivePlan,
          orgLimits: FREE_LIMITS,
          planLimits: PRO_ORG_LIMITS,
          orgDateCreated: BEFORE_CUTOFF,
        });
        expect(limits.getMaxProjects()).toBeNull();
        expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(true);
        expect(limits.orgSupportsRoles()).toBe(true);
      },
    );

    it.each<AccountPlan>(["oss", "starter"])(
      "still enforces free limits on plan=%s, which #6325 shipped correctly",
      (effectivePlan) => {
        const limits = accessorFor({
          effectivePlan,
          orgLimits: FREE_LIMITS,
          orgDateCreated: BEFORE_CUTOFF,
        });
        expect(limits.getMaxProjects()).toBe(1);
        expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(false);
        expect(limits.orgSupportsRoles()).toBe(false);
      },
    );

    it("accepts an ISO string signup date", () => {
      const limits = accessorFor({
        effectivePlan: "pro",
        orgLimits: FREE_LIMITS,
        orgDateCreated: BEFORE_CUTOFF.toISOString(),
      });
      expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(true);
    });

    it.each<Date | string | undefined>([undefined, "not-a-date"])(
      "grandfathers rather than revokes when the signup date is %p",
      (orgDateCreated) => {
        const limits = makeOrgLimits({
          effectivePlan: "pro",
          orgLimits: FREE_LIMITS,
          orgDateCreated,
        });
        expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(true);
      },
    );

    it("lets an explicit license snapshot override the grandfathering", () => {
      const limits = accessorFor({
        effectivePlan: "pro",
        orgLimits: FREE_LIMITS,
        licenseLimits: LICENSE_LIMITS,
        orgDateCreated: BEFORE_CUTOFF,
      });
      expect(limits.getMaxProjects()).toBe(7);
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
