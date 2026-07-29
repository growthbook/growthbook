import {
  ALL_PERMISSIONS,
  DEPRECATED_POLICIES,
  ENV_SCOPED_PERMISSIONS,
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
  const { permission } = REVISION_PERMISSIONS[model][action];
  return perms[permission] === true;
}

describe("granular flag permissions", () => {
  describe("permissionsFromRole", () => {
    it("grants exactly what a bundled policy carries", () => {
      const perms = permissionsFromRole({
        policies: ["ReadData", "FlagsDelete", "FlagsRevert"],
      });
      expect(perms.readData).toBe(true);
      // A policy bundles the action across all three flag entities.
      expect(perms.deleteFeatures).toBe(true);
      expect(perms.deleteConfigs).toBe(true);
      expect(perms.deleteConstants).toBe(true);
      expect(perms.revertFeatures).toBe(true);
      // Not carried by any granted policy
      expect(perms.createFeatures).toBeUndefined();
    });

    it("grants nothing beyond readData for a read-only role", () => {
      const perms = permissionsFromRole({ policies: ["ReadData"] });
      expect(perms.readData).toBe(true);
      expect(perms.deleteFeatures).toBeUndefined();
    });

    it("grants only its own atoms for a review-only policy", () => {
      const perms = permissionsFromRole({ policies: ["FlagsReview"] });
      expect(perms.reviewFeatures).toBe(true);
      expect(perms.reviewConfigs).toBe(true);
      expect(perms.createFeatures).toBeUndefined();
      expect(perms.publishFeatures).toBeUndefined();
      expect(perms.deleteFeatures).toBeUndefined();
    });
  });

  describe("roleSupportsEnvLimitFromRole", () => {
    it("is true when a granted policy carries an environment-scoped atom", () => {
      expect(roleSupportsEnvLimitFromRole({ policies: ["FlagsRevert"] })).toBe(
        true,
      );
    });

    // Drafting touches nothing live, so it's the flags atom that stays
    // project-scoped — everything that reaches an environment is env-scoped.
    it("is false when no granted policy is env-scoped", () => {
      expect(
        roleSupportsEnvLimitFromRole({
          policies: ["ReadData", "FlagsEditDrafts"],
        }),
      ).toBe(false);
    });

    it("is true for a delete-only role, since delete reaches environments", () => {
      expect(
        roleSupportsEnvLimitFromRole({ policies: ["ReadData", "FlagsDelete"] }),
      ).toBe(true);
    });
  });

  describe("policy mapping", () => {
    it("FlagsFullAccess grants the full flag lifecycle including publish/revert", () => {
      const p = POLICY_PERMISSION_MAP.FlagsFullAccess;
      expect(p).toEqual(
        expect.arrayContaining([
          "createFeatures",
          "deleteFeatures",
          "editFeatureDrafts",
          "reviewFeatures",
          "publishFeatures",
          "revertFeatures",
          "createConfigs",
          "createConstants",
        ]),
      );
      // Full access alone does not grant approval bypass
      expect(p).not.toContain("bypassApprovalFeatures");
    });

    it("FlagsBypassApprovals adds only the flag bypass atoms", () => {
      const p = POLICY_PERMISSION_MAP.FlagsBypassApprovals;
      expect(p).toEqual(
        expect.arrayContaining([
          "bypassApprovalFeatures",
          "bypassApprovalConfigs",
          "bypassApprovalConstants",
        ]),
      );
      expect(p).not.toContain("bypassApprovalSavedGroups");
    });

    it("SavedGroupsBypassApprovals adds only the saved-group bypass atom", () => {
      const p = POLICY_PERMISSION_MAP.SavedGroupsBypassApprovals;
      expect(p).toContain("bypassApprovalSavedGroups");
      expect(p).not.toContain("bypassApprovalFeatures");
    });

    // The whole point of per-entity atoms: on main these granted `manageConfigs`
    // / `manageConstants`, so bundling the flag family here would hand a
    // Configs-only role full Feature Flag access on upgrade.
    it("deprecated Configs/Constants policies stay scoped to their own entity", () => {
      expect(POLICY_PERMISSION_MAP.ConfigsFullAccess).toEqual(
        expect.arrayContaining([
          "createConfigs",
          "deleteConfigs",
          "editConfigDrafts",
          "reviewConfigs",
        ]),
      );
      expect(POLICY_PERMISSION_MAP.ConfigsFullAccess).not.toContain(
        "createFeatures",
      );
      expect(POLICY_PERMISSION_MAP.ConstantsFullAccess).not.toContain(
        "createFeatures",
      );
      expect(POLICY_PERMISSION_MAP.ConstantsFullAccess).not.toContain(
        "createConfigs",
      );
    });

    it("deprecated Features access preserves legacy scope (no publish)", () => {
      const p = POLICY_PERMISSION_MAP.FeaturesFullAccess;
      expect(p).toEqual(
        expect.arrayContaining([
          "createFeatures",
          "deleteFeatures",
          "reviewFeatures",
        ]),
      );
      // Legacy Features Full Access never granted publish/revert directly
      expect(p).not.toContain("publishFeatures");
      expect(p).not.toContain("revertFeatures");
    });

    it("every deprecated policy still resolves to a non-empty permission set", () => {
      for (const policy of DEPRECATED_POLICIES) {
        expect((POLICY_PERMISSION_MAP[policy] || []).length).toBeGreaterThan(0);
      }
    });
  });

  describe("REVISION_PERMISSIONS matrix", () => {
    const ACTIONS: RevisionAction[] = [
      "create",
      "delete",
      "draft",
      "review",
      "publish",
      "revert",
      "bypass",
    ];

    it("defines every action for every model, mapped to a real atom", () => {
      for (const model of Object.keys(
        REVISION_PERMISSIONS,
      ) as RevisionModel[]) {
        for (const action of ACTIONS) {
          const entry = REVISION_PERMISSIONS[model][action];
          expect(entry).toBeDefined();
          expect(ALL_PERMISSIONS).toContain(entry.permission);
        }
      }
    });

    it("marks the atom's scope consistently with the scope arrays", () => {
      for (const model of Object.keys(
        REVISION_PERMISSIONS,
      ) as RevisionModel[]) {
        for (const action of ACTIONS) {
          const { permission, scope } = REVISION_PERMISSIONS[model][action];
          const isEnv = (ENV_SCOPED_PERMISSIONS as readonly string[]).includes(
            permission,
          );
          expect(scope === "environment").toBe(isEnv);
        }
      }
    });

    it("env-scopes flag publish/revert but keeps saved-group publish/revert project-scoped", () => {
      for (const model of ["feature", "config", "constant"] as const) {
        expect(REVISION_PERMISSIONS[model].publish.scope).toBe("environment");
        expect(REVISION_PERMISSIONS[model].revert.scope).toBe("environment");
      }
      expect(REVISION_PERMISSIONS["saved-group"].publish.scope).toBe("project");
      expect(REVISION_PERMISSIONS["saved-group"].revert.scope).toBe("project");
    });

    it("gives every model its own project-scoped bypass atom", () => {
      const bypass = (Object.keys(REVISION_PERMISSIONS) as RevisionModel[]).map(
        (m) => REVISION_PERMISSIONS[m].bypass,
      );
      bypass.forEach((b) => expect(b.scope).toBe("project"));
      // Distinct per model, so no entity's grant implies another's.
      expect(new Set(bypass.map((b) => b.permission)).size).toBe(bypass.length);
    });
  });

  // Guard against silently dropping access when the Flags merge remapped the
  // legacy policies. Each row is what the policy set could do BEFORE the merge,
  // when a config/constant/saved-group publish or revert was gated by the same
  // manage* atom as an edit, a feature publish/revert needed
  // manageFeatures + publishFeatures, and one shared bypassApprovalChecks atom
  // covered every family. Post-merge grants must be a superset.
  describe("pre-merge access is preserved", () => {
    const BASELINE: {
      policies: Policy[];
      model: RevisionModel;
      actions: RevisionAction[];
    }[] = [
      {
        policies: ["FeaturesFullAccess"],
        model: "feature",
        actions: ["create", "delete", "draft", "review"],
      },
      {
        policies: ["FeaturesBypassApprovals"],
        model: "feature",
        actions: ["create", "delete", "draft", "review", "bypass"],
      },
      {
        // The pre-split bypass atom was org-wide, so this policy covered every
        // entity. Splitting it must keep ALL the halves or a stored role
        // silently loses bypass somewhere on upgrade.
        policies: ["FeaturesBypassApprovals"],
        model: "saved-group",
        actions: ["bypass"],
      },
      {
        policies: ["FeaturesBypassApprovals"],
        model: "config",
        actions: ["bypass"],
      },
      {
        policies: ["FeaturesBypassApprovals"],
        model: "constant",
        actions: ["bypass"],
      },
      {
        // Legacy feature publish/revert required BOTH policies.
        policies: ["FeaturesFullAccess", "SDKPayloadPublish"],
        model: "feature",
        actions: ["create", "delete", "draft", "review", "publish", "revert"],
      },
      {
        policies: ["ConfigsFullAccess"],
        model: "config",
        actions: ["create", "delete", "draft", "review", "publish", "revert"],
      },
      {
        policies: ["ConstantsFullAccess"],
        model: "constant",
        actions: ["create", "delete", "draft", "review", "publish", "revert"],
      },
      {
        policies: ["SavedGroupsFullAccess"],
        model: "saved-group",
        actions: ["create", "delete", "draft", "review", "publish", "revert"],
      },
      {
        policies: ["SavedGroupsBypassSizeLimit"],
        model: "saved-group",
        actions: ["create", "delete", "draft", "review", "publish", "revert"],
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

// The bypass split means a model-agnostic caller must resolve the atom from the
// entity's family, never hardcode one. Pins the mapping so a path that reaches
// for the wrong family (flags authority clearing a Saved Group's validation, or
// vice versa) is a test failure rather than a silent cross-family leak.
describe("bypass is resolved per entity", () => {
  it("maps each model to its own bypass atom", () => {
    const expected: Record<RevisionModel, string> = {
      feature: "bypassApprovalFeatures",
      config: "bypassApprovalConfigs",
      constant: "bypassApprovalConstants",
      "saved-group": "bypassApprovalSavedGroups",
    };
    for (const [model, atom] of Object.entries(expected)) {
      expect(
        REVISION_PERMISSIONS[model as RevisionModel].bypass.permission,
      ).toBe(atom);
    }
  });

  it("keeps the flag and saved-group grants distinct, so neither implies the other", () => {
    const flags = permissionsFromRole({ policies: ["FlagsBypassApprovals"] });
    const sg = permissionsFromRole({
      policies: ["SavedGroupsBypassApprovals"],
    });
    expect(flags.bypassApprovalFeatures).toBe(true);
    expect(flags.bypassApprovalConfigs).toBe(true);
    expect(flags.bypassApprovalSavedGroups).toBeUndefined();
    expect(sg.bypassApprovalSavedGroups).toBe(true);
    expect(sg.bypassApprovalFeatures).toBeUndefined();
  });
});
