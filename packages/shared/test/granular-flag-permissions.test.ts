import {
  DEPRECATED_POLICIES,
  POLICY_PERMISSION_MAP,
  permissionsFromRole,
  roleSupportsEnvLimitFromRole,
} from "../src/permissions";

describe("granular flag permissions", () => {
  describe("permissionsFromRole", () => {
    it("unions policy-derived permissions with additive permissions[]", () => {
      const perms = permissionsFromRole({
        policies: ["ReadData"],
        permissions: ["deleteFlags", "revertFlags"],
      });
      expect(perms.readData).toBe(true);
      expect(perms.deleteFlags).toBe(true);
      expect(perms.revertFlags).toBe(true);
      // Not granted by ReadData nor listed explicitly
      expect(perms.manageFlags).toBeUndefined();
    });

    it("works with no additive permissions", () => {
      const perms = permissionsFromRole({ policies: ["ReadData"] });
      expect(perms.readData).toBe(true);
      expect(perms.deleteFlags).toBeUndefined();
    });

    it("grants only the single atom for a review-only custom role", () => {
      const perms = permissionsFromRole({
        policies: [],
        permissions: ["reviewFlags"],
      });
      expect(perms.reviewFlags).toBe(true);
      expect(perms.manageFlags).toBeUndefined();
      expect(perms.publishFlags).toBeUndefined();
      expect(perms.deleteFlags).toBeUndefined();
    });
  });

  describe("roleSupportsEnvLimitFromRole", () => {
    it("is true when an additive permission is environment-scoped", () => {
      expect(
        roleSupportsEnvLimitFromRole({
          policies: [],
          permissions: ["revertFlags"],
        }),
      ).toBe(true);
    });

    it("is false when neither policies nor permissions are env-scoped", () => {
      expect(
        roleSupportsEnvLimitFromRole({
          policies: ["ReadData"],
          permissions: ["deleteFlags"],
        }),
      ).toBe(false);
    });
  });

  describe("policy mapping", () => {
    it("FlagsFullAccess grants the full flag lifecycle including publish/revert", () => {
      const p = POLICY_PERMISSION_MAP.FlagsFullAccess;
      expect(p).toEqual(
        expect.arrayContaining([
          "manageFlags",
          "deleteFlags",
          "manageFlagDrafts",
          "reviewFlags",
          "publishFlags",
          "revertFlags",
        ]),
      );
      // Full access alone does not grant approval bypass
      expect(p).not.toContain("bypassApprovalChecks");
    });

    it("FlagsBypassApprovals adds bypassApprovalChecks", () => {
      expect(POLICY_PERMISSION_MAP.FlagsBypassApprovals).toContain(
        "bypassApprovalChecks",
      );
    });

    it("deprecated Configs/Constants policies resolve to the merged Flags atoms", () => {
      for (const policy of [
        "ConfigsFullAccess",
        "ConstantsFullAccess",
      ] as const) {
        const p = POLICY_PERMISSION_MAP[policy];
        expect(p).toEqual(
          expect.arrayContaining([
            "manageFlags",
            "deleteFlags",
            "manageFlagDrafts",
            "reviewFlags",
          ]),
        );
      }
    });

    it("deprecated Features access preserves legacy scope (no publish)", () => {
      const p = POLICY_PERMISSION_MAP.FeaturesFullAccess;
      expect(p).toEqual(
        expect.arrayContaining(["manageFlags", "deleteFlags", "reviewFlags"]),
      );
      // Legacy Features Full Access never granted publish/revert directly
      expect(p).not.toContain("publishFlags");
      expect(p).not.toContain("revertFlags");
    });

    it("every deprecated policy still resolves to a non-empty permission set", () => {
      for (const policy of DEPRECATED_POLICIES) {
        expect((POLICY_PERMISSION_MAP[policy] || []).length).toBeGreaterThan(0);
      }
    });
  });
});
