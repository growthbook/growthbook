import { makeOrgLimits, FREE_ORG_LIMITS } from "shared/enterprise";
import type { AccountPlan, OrgLimits } from "shared/enterprise";

const FREE_LIMITS: OrgLimits = FREE_ORG_LIMITS;

const PAID_LIMITS: OrgLimits = {
  maxProjects: 3,
  customEnvironments: false,
  roleManagement: false,
};

function accessorFor({
  effectivePlan,
  orgLimits,
  licenseLimits,
}: {
  effectivePlan: AccountPlan;
  orgLimits?: OrgLimits;
  licenseLimits?: OrgLimits;
}) {
  return makeOrgLimits({ effectivePlan, orgLimits, licenseLimits });
}

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
  });

  describe("free plans (oss/starter) read org limits, ignore license limits", () => {
    it.each<AccountPlan>(["oss", "starter"])(
      "enforces org.limits on plan=%s",
      (effectivePlan) => {
        const limits = accessorFor({
          effectivePlan,
          orgLimits: FREE_LIMITS,
          licenseLimits: { maxProjects: 999 }, // should be ignored on free plans
        });
        expect(limits.getMaxProjects()).toBe(1);
        expect(limits.isEnvironmentIdAllowed("production")).toBe(true);
        expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(false);
        expect(limits.orgSupportsRoles()).toBe(false);
      },
    );
  });

  describe("active paid plans read license limits, ignore org limits", () => {
    it.each<AccountPlan>(["pro", "pro_sso", "enterprise"])(
      "enforces license.limits on plan=%s",
      (effectivePlan) => {
        const limits = accessorFor({
          effectivePlan,
          orgLimits: FREE_LIMITS, // should be ignored on paid plans
          licenseLimits: PAID_LIMITS,
        });
        expect(limits.getMaxProjects()).toBe(3);
        expect(limits.isEnvironmentIdAllowed("custom-env")).toBe(false);
        expect(limits.orgSupportsRoles()).toBe(false);
      },
    );

    it("resolves to unlimited when the license has no limits snapshot", () => {
      const limits = accessorFor({
        effectivePlan: "enterprise",
        orgLimits: FREE_LIMITS,
        licenseLimits: undefined,
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
