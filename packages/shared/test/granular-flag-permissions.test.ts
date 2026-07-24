import {
  ALL_PERMISSIONS,
  DEPRECATED_POLICIES,
  ENV_SCOPED_PERMISSIONS,
  MODEL_FAMILY,
  POLICY_PERMISSION_MAP,
  Policy,
  REVISION_PERMISSIONS,
  RevisionAction,
  RevisionModel,
  permissionsFromRole,
  roleSupportsEnvLimitFromRole,
} from "../src/permissions";

// Does a role built from these policies alone hold the atom for (model, action)?
// Atom-level: environment narrowing is a separate, per-role concern.
function grants(
  policies: Policy[],
  model: RevisionModel,
  action: RevisionAction,
): boolean {
  const perms = permissionsFromRole({ policies });
  const { permission } = REVISION_PERMISSIONS[MODEL_FAMILY[model]][action];
  return perms[permission] === true;
}

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

  describe("REVISION_PERMISSIONS matrix", () => {
    const ACTIONS: RevisionAction[] = [
      "manage",
      "delete",
      "draft",
      "review",
      "publish",
      "revert",
    ];

    it("defines every action for every family, mapped to a real atom", () => {
      for (const family of Object.keys(REVISION_PERMISSIONS) as Array<
        keyof typeof REVISION_PERMISSIONS
      >) {
        for (const action of ACTIONS) {
          const entry = REVISION_PERMISSIONS[family][action];
          expect(entry).toBeDefined();
          expect(ALL_PERMISSIONS).toContain(entry.permission);
        }
      }
    });

    it("marks the atom's scope consistently with the scope arrays", () => {
      for (const family of Object.keys(REVISION_PERMISSIONS) as Array<
        keyof typeof REVISION_PERMISSIONS
      >) {
        for (const action of ACTIONS) {
          const { permission, scope } = REVISION_PERMISSIONS[family][action];
          const isEnv = (ENV_SCOPED_PERMISSIONS as readonly string[]).includes(
            permission,
          );
          expect(scope === "environment").toBe(isEnv);
        }
      }
    });

    it("env-scopes flag publish/revert but keeps saved-group publish/revert project-scoped", () => {
      expect(REVISION_PERMISSIONS.flags.publish.scope).toBe("environment");
      expect(REVISION_PERMISSIONS.flags.revert.scope).toBe("environment");
      expect(REVISION_PERMISSIONS.savedGroups.publish.scope).toBe("project");
      expect(REVISION_PERMISSIONS.savedGroups.revert.scope).toBe("project");
    });
  });

  // Guard against silently dropping access when the Flags merge remapped the
  // legacy policies. Each row is what the policy set could do BEFORE the merge,
  // when a config/constant/saved-group publish or revert was gated by the same
  // manage* atom as an edit, and a feature publish/revert needed
  // manageFeatures + publishFeatures. Post-merge grants must be a superset.
  describe("pre-merge access is preserved", () => {
    const BASELINE: {
      policies: Policy[];
      model: RevisionModel;
      actions: RevisionAction[];
    }[] = [
      {
        policies: ["FeaturesFullAccess"],
        model: "feature",
        actions: ["manage", "delete", "draft", "review"],
      },
      {
        policies: ["FeaturesBypassApprovals"],
        model: "feature",
        actions: ["manage", "delete", "draft", "review"],
      },
      {
        // Legacy feature publish/revert required BOTH policies.
        policies: ["FeaturesFullAccess", "SDKPayloadPublish"],
        model: "feature",
        actions: ["manage", "delete", "draft", "review", "publish", "revert"],
      },
      {
        policies: ["ConfigsFullAccess"],
        model: "config",
        actions: ["manage", "delete", "draft", "review", "publish", "revert"],
      },
      {
        policies: ["ConstantsFullAccess"],
        model: "constant",
        actions: ["manage", "delete", "draft", "review", "publish", "revert"],
      },
      {
        policies: ["SavedGroupsFullAccess"],
        model: "saved-group",
        actions: ["manage", "delete", "draft", "review", "publish", "revert"],
      },
      {
        policies: ["SavedGroupsBypassSizeLimit"],
        model: "saved-group",
        actions: ["manage", "delete", "draft", "review", "publish", "revert"],
      },
    ];

    BASELINE.forEach(({ policies, model, actions }) => {
      it(`[${policies.join(" + ")}] keeps ${model} ${actions.join("/")}`, () => {
        actions.forEach((action) => {
          expect({ action, granted: grants(policies, model, action) }).toEqual({
            action,
            granted: true,
          });
        });
      });
    });

    it("still lets a feature-edit-only legacy role not publish or revert", () => {
      // FeaturesFullAccess never carried production write on its own; the
      // deprecated shims must not hand it one.
      expect(grants(["FeaturesFullAccess"], "feature", "publish")).toBe(false);
      expect(grants(["FeaturesFullAccess"], "feature", "revert")).toBe(false);
    });
  });
});
