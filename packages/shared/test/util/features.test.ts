import {
  FeatureInterface,
  FeatureRule,
  SchemaField,
  SimpleSchema,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { OrganizationSettings, RequireReview } from "shared/types/organization";
import {
  validateFeatureValue,
  assertSchemaMatchesValueType,
  getValidation,
  validateJSONFeatureValue,
  autoMerge,
  getLiveChangesSinceBase,
  evaluatePublishGovernance,
  isScheduledPublishPending,
  isScheduledPublishDue,
  isScheduledPublishLockActive,
  isRevisionEditLockedBySchedule,
  findPublishLockingScheduledRevision,
  RevisionFields,
  MergeConflict,
  validateCondition,
  checkEnvironmentsMatch,
  checkIfRevisionNeedsReview,
  getDraftAffectedEnvironments,
  getEnvsFromRampSchedule,
  liveRevisionFromFeature,
  resetReviewOnChange,
  simpleToJSONSchema,
  inferSchemaField,
  inferSchemaFields,
  inferSimpleSchemaFromValue,
  extractConditionAttributeKeys,
  findUnregisteredAttributes,
  categorizeUnregisteredAttributes,
  getRequireRegisteredAttributesSettings,
  ruleAppliesToEnv,
  ruleFootprint,
  getRulesForEnvironment,
  getRevertValueValidationWarnings,
  pruneOrphanedRampActions,
  toV2FeatureSnapshot,
  parsePlainJSONObject,
  resolveSparseJSONValue,
  stripDefaultsForSparse,
  expandSparseToFull,
  draftHasChangesOutsideTargetRef,
} from "../../src/util";
import type { RampScheduleInterface } from "../../src/validators/ramp-schedule";

const feature: FeatureInterface = {
  dateCreated: new Date("2020-04-20"),
  dateUpdated: new Date("2020-04-20"),
  defaultValue: "true",
  environmentSettings: {},
  id: "feature-123",
  organization: "123",
  owner: "adnan",
  valueType: "boolean",
  version: 1,
};

const exampleJsonSchema = {
  type: "object",
  properties: {
    test: {
      type: "string",
    },
  },
};
const rules: Record<string, FeatureRule[]> = {
  dev: [
    {
      description: "test",
      id: "test",
      type: "rollout",
      value: "test",
      coverage: 1,
      hashAttribute: "test",
    },
  ],
  prod: [
    {
      description: "test",
      id: "test",
      type: "rollout",
      value: "test",
      coverage: 1,
      hashAttribute: "test",
    },
  ],
};
const changedRules: Record<string, FeatureRule[]> = {
  ...rules,
  prod: [
    ...rules.prod,

    {
      description: "test1",
      id: "test1",
      type: "rollout",
      value: "test",
      coverage: 1,
      hashAttribute: "test",
    },
  ],
};
const baseRevision: FeatureRevisionInterface = {
  featureId: feature.id,
  organization: feature.organization,
  baseVersion: 0,
  version: 0,
  dateCreated: new Date(),
  dateUpdated: new Date(),
  datePublished: null,
  publishedBy: null,
  createdBy: null,
  comment: "",
  status: "draft",
  defaultValue: "",
  rules: rules,
};

const revision: FeatureRevisionInterface = {
  featureId: feature.id,
  organization: feature.organization,
  baseVersion: 0,
  version: 1,
  dateCreated: new Date(),
  dateUpdated: new Date(),
  datePublished: null,
  publishedBy: null,
  createdBy: null,
  comment: "",
  status: "draft",
  defaultValue: "",
  rules: changedRules,
};

describe("autoMerge", () => {
  // v2: rules live on a single flat top-level array. Each rule carries an
  // `allEnvironments` boolean + optional `environments` scope. Helpers below
  // stamp force rules with `environments: [env]` so the v2 shape is easy to
  // read in each test.
  const devRule = (id: string, value = "force"): FeatureRule => ({
    type: "force",
    description: "",
    id,
    value,
    allEnvironments: false,
    environments: ["dev"],
  });
  const prodRule = (id: string, value = "force"): FeatureRule => ({
    type: "force",
    description: "",
    id,
    value,
    allEnvironments: false,
    environments: ["prod"],
  });

  it("Auto merges when there are no conflicts", () => {
    const liveForce = prodRule("liveForce");
    const revisionForce = devRule("revisionForce");

    const base: RevisionFields = {
      defaultValue: "base",
      rules: [],
      version: 4,
    };
    const live: RevisionFields = {
      defaultValue: "base",
      rules: [liveForce],
      version: 6,
    };
    const revision: RevisionFields = {
      defaultValue: "revision",
      rules: [revisionForce],
      version: 5,
    };

    // Diverged (live.version !== base.version) so autoMerge runs a three-way
    // merge. Both sides added different ids, so tryRuleLevelMerge produces the
    // union in live-first order.
    expect(autoMerge(live, base, revision, ["dev", "prod"], {})).toEqual({
      success: true,
      conflicts: [],
      result: {
        defaultValue: revision.defaultValue,
        rules: [liveForce, revisionForce],
      },
    });
  });

  it("Auto merges when live and base are the same revision", () => {
    const revisionForce = devRule("revisionForce");

    const base: RevisionFields = {
      defaultValue: "base",
      rules: [],
      version: 4,
    };
    const revision: RevisionFields = {
      defaultValue: "revision",
      rules: [revisionForce],
      version: 5,
    };

    // Not diverged: autoMerge only reports the deltas (defaultValue +
    // the new rule set).
    expect(autoMerge(base, base, revision, ["dev", "prod"], {})).toEqual({
      success: true,
      conflicts: [],
      result: {
        defaultValue: revision.defaultValue,
        rules: [revisionForce],
      },
    });
  });

  it("Handles merge conflicts", () => {
    const baseShared = prodRule("sharedForce", "base");
    const liveShared = prodRule("sharedForce", "live");
    const revisionShared = prodRule("sharedForce", "revision");
    const revisionForce = devRule("revisionForce");

    const base: RevisionFields = {
      defaultValue: "base",
      rules: [baseShared],
      version: 4,
    };
    const live: RevisionFields = {
      defaultValue: "live",
      rules: [liveShared],
      version: 6,
    };
    const revision: RevisionFields = {
      defaultValue: "revision",
      rules: [revisionForce, revisionShared],
      version: 5,
    };

    const defaultValueConflict: MergeConflict = {
      key: "defaultValue",
      name: "Default Value",
      resolved: false,
      base: "base",
      live: "live",
      revision: "revision",
    };
    // Granular rule merge: `sharedForce` was edited by both sides, so it gets
    // its own per-rule conflict (`rules.<ruleId>`), while the draft's
    // independent `revisionForce` addition merges automatically.
    const rulesConflict: MergeConflict = {
      key: "rules.sharedForce",
      name: "Rule – sharedForce",
      resolved: false,
      base: JSON.stringify(baseShared, null, 2),
      live: JSON.stringify(liveShared, null, 2),
      revision: JSON.stringify(revisionShared, null, 2),
    };

    expect(autoMerge(live, base, revision, ["dev", "prod"], {})).toEqual({
      success: false,
      conflicts: [defaultValueConflict, rulesConflict],
    });

    expect(
      autoMerge(live, base, revision, ["dev", "prod"], {
        rules: "discard",
      }),
    ).toEqual({
      success: false,
      conflicts: [
        {
          ...defaultValueConflict,
        },
        {
          ...rulesConflict,
          resolved: true,
        },
      ],
    });

    // Discarding the conflicted rule no longer throws away the draft's
    // independent `revisionForce` addition — it still merges in. (Previously
    // the whole-array conflict made "discard" drop every draft rule change.)
    expect(
      autoMerge(live, base, revision, ["dev", "prod"], {
        rules: "discard",
        defaultValue: "discard",
      }),
    ).toEqual({
      success: true,
      conflicts: [
        {
          ...defaultValueConflict,
          resolved: true,
        },
        {
          ...rulesConflict,
          resolved: true,
        },
      ],
      result: {
        rules: [liveShared, revisionForce],
      },
    });

    expect(
      autoMerge(live, base, revision, ["dev", "prod"], {
        rules: "discard",
        defaultValue: "overwrite",
      }),
    ).toEqual({
      success: true,
      conflicts: [
        {
          ...defaultValueConflict,
          resolved: true,
        },
        {
          ...rulesConflict,
          resolved: true,
        },
      ],
      result: {
        defaultValue: revision.defaultValue,
        rules: [liveShared, revisionForce],
      },
    });

    expect(
      autoMerge(live, base, revision, ["dev", "prod"], {
        rules: "overwrite",
        defaultValue: "overwrite",
      }),
    ).toEqual({
      success: true,
      conflicts: [
        {
          ...defaultValueConflict,
          resolved: true,
        },
        {
          ...rulesConflict,
          resolved: true,
        },
      ],
      result: {
        defaultValue: revision.defaultValue,
        // Live ordering wins (neither side reordered); the draft's edit of
        // sharedForce and its new rule both land.
        rules: [revisionShared, revisionForce],
      },
    });
  });

  describe("granular rule merge (via autoMerge)", () => {
    // v2: flat FeatureRule[]. We keep the `environments: ["dev"]` scope on
    // every rule so the merge semantics match the v1 "dev-only" tests.
    const A = devRule("a", "a");
    const B = devRule("b", "b");
    const C = devRule("c", "c");

    it("live reorders rules, draft modifies one — absorbs reorder, uses live ordering", () => {
      const Bmod = { ...B, value: "b-updated" };
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B, C],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [C, A, B],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [A, Bmod, C],
        version: 1,
      };

      const result = autoMerge(live, base, revision, ["dev"], {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result.rules).toEqual([C, A, Bmod]);
      }
    });

    it("both sides add new rules — draft addition appended after live rules", () => {
      const D = devRule("d", "d");
      const E = devRule("e", "e");

      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [A, E],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [A, D],
        version: 1,
      };

      const result = autoMerge(live, base, revision, ["dev"], {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result.rules).toEqual([A, E, D]);
      }
    });

    it("live deletes rule, draft modifies different rule — deletion preserved", () => {
      const Cmod = { ...C, value: "c-updated" };
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B, C],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [A, C],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [A, B, Cmod],
        version: 1,
      };

      const result = autoMerge(live, base, revision, ["dev"], {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result.rules).toEqual([A, Cmod]);
      }
    });

    it("live deletes rule that draft also modified — conflict", () => {
      const Bmod = { ...B, value: "b-updated" };
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [A],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [A, Bmod],
        version: 1,
      };

      const result = autoMerge(live, base, revision, ["dev"], {});
      expect(result.success).toBe(false);
      if (!result.success) {
        // Granular merge: the delete-vs-modify clash surfaces as a conflict
        // scoped to the specific rule, not the whole array.
        expect(result.conflicts).toEqual(
          expect.arrayContaining([expect.objectContaining({ key: "rules.b" })]),
        );
      }
    });

    // Regression: a draft that DELETES a rule must not have that deletion
    // silently dropped just because live happened to edit a *different* rule.
    // Previously the live-walk pushed the live copy of any rule missing from
    // the revision, so the draft's intent to remove `B` was lost and `B`
    // reappeared in the published feature with no conflict warning.
    it("draft deletes a rule, live modifies a different rule — deletion honored", () => {
      const Cmod = { ...C, value: "c-updated" };
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B, C],
        version: 1,
      };
      // live left B untouched but rolled out C
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [A, B, Cmod],
        version: 2,
      };
      // draft removed B, left C alone
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [A, C],
        version: 1,
      };

      const result = autoMerge(live, base, revision, ["dev"], {});
      expect(result.success).toBe(true);
      if (result.success) {
        // B is gone (draft deletion respected) and live's C rollout is kept.
        expect(result.result.rules).toEqual([A, Cmod]);
      }
    });

    // Mirror of the existing "live deletes / draft modifies" conflict: when the
    // draft deletes a rule that live concurrently MODIFIED, that is a genuine
    // delete-vs-modify conflict and must not auto-merge.
    it("draft deletes a rule that live also modified — conflict", () => {
      const Bmod = { ...B, value: "b-live-updated" };
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [A, Bmod],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [A],
        version: 1,
      };

      const result = autoMerge(live, base, revision, ["dev"], {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.conflicts).toEqual(
          expect.arrayContaining([expect.objectContaining({ key: "rules.b" })]),
        );
      }
    });

    // Honoring deletions must not over-correct: a rule that is brand new in
    // live (never in base, absent from the draft) is NOT a draft deletion and
    // must be preserved, otherwise publishing would silently drop a concurrent
    // live addition.
    it("draft deletes a rule while live adds a new rule — both respected", () => {
      const E = devRule("e", "e");
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [A, B, E],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [A],
        version: 1,
      };

      const result = autoMerge(live, base, revision, ["dev"], {});
      expect(result.success).toBe(true);
      if (result.success) {
        // B removed (draft deletion), E kept (live addition).
        expect(result.result.rules).toEqual([A, E]);
      }
    });

    // Regression for PR #5800: legacy v1 docs (Mongoose `Mixed`) can land
    // with sparse `null`/`undefined` rule slots. Before `naiveFlattenV1Rules`
    // filtered them out, autoMerge → tryRuleLevelMerge would crash on
    // `r.id` access while building its by-id map, blocking publish with
    // "Cannot read properties of undefined (reading 'id'/'type')".
    it("tolerates sparse null/undefined slots in any of base/live/revision rules", () => {
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, null as unknown as FeatureRule, B],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [A, B, undefined as unknown as FeatureRule],
        version: 2,
      };
      const Bmod = { ...B, value: "b-updated" };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [A, Bmod, null as unknown as FeatureRule],
        version: 1,
      };

      const result = autoMerge(live, base, revision, ["dev"], {});
      expect(result.success).toBe(true);
      if (result.success && result.result.rules) {
        // Filtered: only A and Bmod survive, ordered by live's positions
        // with revision-side edits substituted in.
        expect(result.result.rules.map((r) => r.id)).toEqual(["a", "b"]);
        expect(result.result.rules[1].value).toBe("b-updated");
      }
    });

    it("emits one conflict per clashing rule, each independently resolvable", () => {
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B, C],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [{ ...A, value: "a-live" }, { ...B, value: "b-live" }, C],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [
          { ...A, value: "a-draft" },
          { ...B, value: "b-draft" },
          { ...C, value: "c-draft" },
        ],
        version: 1,
      };

      const unresolved = autoMerge(live, base, revision, ["dev"], {});
      expect(unresolved.success).toBe(false);
      expect(unresolved.conflicts.map((c) => c.key).sort()).toEqual([
        "rules.a",
        "rules.b",
      ]);

      // Mixed resolution: keep live's edit of A, the draft's edit of B. The
      // draft's uncontested edit of C merges automatically either way.
      const resolved = autoMerge(live, base, revision, ["dev"], {
        "rules.a": "discard",
        "rules.b": "overwrite",
      });
      expect(resolved.success).toBe(true);
      if (resolved.success) {
        expect(resolved.result.rules).toEqual([
          { ...A, value: "a-live" },
          { ...B, value: "b-draft" },
          { ...C, value: "c-draft" },
        ]);
      }
    });

    it("resolves a delete-vs-modify conflict in either direction", () => {
      const Bmod = { ...B, value: "b-draft" };
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [A],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [A, Bmod],
        version: 1,
      };

      const keepDraft = autoMerge(live, base, revision, ["dev"], {
        "rules.b": "overwrite",
      });
      expect(keepDraft.success).toBe(true);
      if (keepDraft.success) {
        expect(keepDraft.result.rules).toEqual([A, Bmod]);
      }

      const keepDeletion = autoMerge(live, base, revision, ["dev"], {
        "rules.b": "discard",
      });
      expect(keepDeletion.success).toBe(true);
      if (keepDeletion.success) {
        // Live's deletion stands; merged rules equal live so no rules delta.
        expect(keepDeletion.result.rules).toBeUndefined();
      }
    });

    it("honors a draft-only reorder when live changed content but not order", () => {
      const Amod = { ...A, value: "a-live" };
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B, C],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [Amod, B, C],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [C, A, B],
        version: 1,
      };

      const result = autoMerge(live, base, revision, ["dev"], {});
      expect(result.success).toBe(true);
      if (result.success) {
        // Draft ordering with live's content edit of A substituted in.
        expect(result.result.rules).toEqual([C, Amod, B]);
      }
    });

    it("escalates competing reorders to a rules.order conflict", () => {
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B, C],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [B, A, C],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [C, A, B],
        version: 1,
      };

      const unresolved = autoMerge(live, base, revision, ["dev"], {});
      expect(unresolved.success).toBe(false);
      expect(unresolved.conflicts).toEqual([
        expect.objectContaining({ key: "rules.order", resolved: false }),
      ]);

      const draftOrder = autoMerge(live, base, revision, ["dev"], {
        "rules.order": "overwrite",
      });
      expect(draftOrder.success).toBe(true);
      if (draftOrder.success) {
        expect(draftOrder.result.rules).toEqual([C, A, B]);
      }

      const liveOrder = autoMerge(live, base, revision, ["dev"], {
        "rules.order": "discard",
      });
      expect(liveOrder.success).toBe(true);
      if (liveOrder.success) {
        // Live's order is the merged outcome — identical to live, no delta.
        expect(liveOrder.result.rules).toBeUndefined();
      }
    });

    it("applies the blanket 'rules' strategy to every rule-level conflict", () => {
      const base: RevisionFields = {
        defaultValue: "true",
        rules: [A, B],
        version: 1,
      };
      const live: RevisionFields = {
        defaultValue: "true",
        rules: [
          { ...A, value: "a-live" },
          { ...B, value: "b-live" },
        ],
        version: 2,
      };
      const revision: RevisionFields = {
        defaultValue: "true",
        rules: [
          { ...A, value: "a-draft" },
          { ...B, value: "b-draft" },
        ],
        version: 1,
      };

      const result = autoMerge(live, base, revision, ["dev"], {
        rules: "overwrite",
      });
      expect(result.success).toBe(true);
      expect(result.conflicts.every((c) => c.resolved)).toBe(true);
      if (result.success) {
        expect(result.result.rules).toEqual([
          { ...A, value: "a-draft" },
          { ...B, value: "b-draft" },
        ]);
      }
    });
  });
});

describe("getLiveChangesSinceBase", () => {
  const envs = ["dev", "prod"];
  const rule = (id: string, value = "force"): FeatureRule => ({
    type: "force",
    description: "",
    id,
    value,
    allEnvironments: true,
  });

  const makeBase = (): RevisionFields => ({
    version: 1,
    defaultValue: "base",
    rules: [rule("a", "a")],
    environmentsEnabled: { dev: true, prod: false },
    prerequisites: [],
    archived: false,
    holdout: null,
    metadata: { description: "d0", owner: "o0", project: "", tags: [] },
  });

  it("returns no changes when live equals base", () => {
    expect(getLiveChangesSinceBase(makeBase(), makeBase(), envs)).toEqual([]);
  });

  it("detects a defaultValue change", () => {
    const live = { ...makeBase(), defaultValue: "live" };
    expect(getLiveChangesSinceBase(live, makeBase(), envs)).toEqual([
      { key: "defaultValue", name: "Default Value" },
    ]);
  });

  it("detects a rules change", () => {
    const live = { ...makeBase(), rules: [rule("a", "a"), rule("b", "b")] };
    expect(getLiveChangesSinceBase(live, makeBase(), envs)).toEqual([
      { key: "rules", name: "Rules" },
    ]);
  });

  it("ignores rule array identity (same content, different reference)", () => {
    const base = makeBase();
    const live = { ...makeBase(), rules: [rule("a", "a")] };
    expect(getLiveChangesSinceBase(live, base, envs)).toEqual([]);
  });

  it("detects a per-environment enabled change with the env in the key", () => {
    const live = {
      ...makeBase(),
      environmentsEnabled: { dev: true, prod: true },
    };
    expect(getLiveChangesSinceBase(live, makeBase(), envs)).toEqual([
      { key: "environmentsEnabled.prod", name: "Env Enabled - prod" },
    ]);
  });

  it("only considers environments passed in", () => {
    const live = {
      ...makeBase(),
      environmentsEnabled: { dev: true, prod: true, staging: true },
    };
    // staging is not in the provided env list, so it's ignored
    const base = {
      ...makeBase(),
      environmentsEnabled: { dev: true, prod: false, staging: false },
    };
    expect(getLiveChangesSinceBase(live, base, envs)).toEqual([
      { key: "environmentsEnabled.prod", name: "Env Enabled - prod" },
    ]);
  });

  it("detects a prerequisites change", () => {
    const live = {
      ...makeBase(),
      prerequisites: [{ id: "parent", condition: "{}" }],
    };
    expect(getLiveChangesSinceBase(live, makeBase(), envs)).toEqual([
      { key: "prerequisites", name: "Prerequisites" },
    ]);
  });

  it("detects an archived change", () => {
    const live = { ...makeBase(), archived: true };
    expect(getLiveChangesSinceBase(live, makeBase(), envs)).toEqual([
      { key: "archived", name: "Archived" },
    ]);
  });

  it("detects a holdout change (added)", () => {
    const live = { ...makeBase(), holdout: { id: "ho_1", value: "0" } };
    expect(getLiveChangesSinceBase(live, makeBase(), envs)).toEqual([
      { key: "holdout", name: "Holdout" },
    ]);
  });

  it("detects per-field metadata changes", () => {
    const live = {
      ...makeBase(),
      metadata: { description: "d1", owner: "o0", project: "", tags: [] },
    };
    expect(getLiveChangesSinceBase(live, makeBase(), envs)).toEqual([
      { key: "metadata.description", name: "Metadata - description" },
    ]);
  });

  it("treats normalized-equal metadata as unchanged", () => {
    const base = {
      ...makeBase(),
      metadata: { description: "", owner: "", project: "", tags: [] },
    };
    const live = {
      ...makeBase(),
      // null/undefined normalize to the same empty values as base
      metadata: {
        description: undefined,
        owner: null,
        project: undefined,
        tags: undefined,
      } as unknown as RevisionFields["metadata"],
    };
    expect(getLiveChangesSinceBase(live, base, envs)).toEqual([]);
  });

  it("reports every changed field when several change at once", () => {
    const live: RevisionFields = {
      ...makeBase(),
      defaultValue: "live",
      rules: [rule("a", "a"), rule("b", "b")],
      environmentsEnabled: { dev: false, prod: false },
      archived: true,
    };
    const result = getLiveChangesSinceBase(live, makeBase(), envs);
    expect(result.map((c) => c.key).sort()).toEqual(
      ["archived", "defaultValue", "environmentsEnabled.dev", "rules"].sort(),
    );
  });
});

describe("evaluatePublishGovernance", () => {
  const baseInput = {
    revisionStatus: "draft" as const,
    baseVersion: 5,
    liveVersion: 5,
    mergeSuccess: true,
    liveChanges: [],
  };

  it("current draft (base === live, no conflicts): publish allowed, no rebase", () => {
    const r = evaluatePublishGovernance(baseInput);
    expect(r.divergence).toBe("current");
    expect(r.diverged).toBe(false);
    expect(r.staleApproval).toBe(false);
    expect(r.recommendRebase).toBe(false);
    expect(r.rebaseRequired).toBe(false);
    expect(r.canPublish).toBe(true);
    expect(r.blockReason).toBe(null);
  });

  it("diverged but auto-mergeable, setting OFF: encourage rebase, still publishable", () => {
    const r = evaluatePublishGovernance({
      ...baseInput,
      liveVersion: 8,
      liveChanges: [{ key: "rules", name: "Rules" }],
    });
    expect(r.divergence).toBe("diverged");
    expect(r.diverged).toBe(true);
    expect(r.recommendRebase).toBe(true);
    expect(r.rebaseRequired).toBe(false);
    expect(r.canPublish).toBe(true);
    expect(r.liveChanges).toHaveLength(1);
  });

  it("diverged but auto-mergeable, setting ON: rebase required, publish blocked", () => {
    const r = evaluatePublishGovernance({
      ...baseInput,
      liveVersion: 8,
      requireRebaseBeforePublish: true,
    });
    expect(r.divergence).toBe("diverged");
    expect(r.rebaseRequired).toBe(true);
    expect(r.canPublish).toBe(false);
    expect(r.blockReason).toMatch(/older version/i);
  });

  it("hard conflict: always blocks publish and requires resolution", () => {
    const r = evaluatePublishGovernance({
      ...baseInput,
      liveVersion: 8,
      mergeSuccess: false,
    });
    expect(r.divergence).toBe("conflict");
    expect(r.recommendRebase).toBe(true);
    expect(r.rebaseRequired).toBe(true);
    expect(r.canPublish).toBe(false);
    expect(r.blockReason).toMatch(/resolve conflicts/i);
  });

  it("approved + live advanced past approval point: stale approval surfaced", () => {
    const r = evaluatePublishGovernance({
      ...baseInput,
      revisionStatus: "approved",
      baseVersion: 5,
      liveVersion: 7,
      approvedBaseVersion: 5,
    });
    expect(r.staleApproval).toBe(true);
    expect(r.recommendRebase).toBe(true);
    // setting off → still publishable, just warned
    expect(r.rebaseRequired).toBe(false);
    expect(r.canPublish).toBe(true);
  });

  it("approved + live unchanged since approval: not stale", () => {
    const r = evaluatePublishGovernance({
      ...baseInput,
      revisionStatus: "approved",
      baseVersion: 7,
      liveVersion: 7,
      approvedBaseVersion: 7,
    });
    expect(r.staleApproval).toBe(false);
    expect(r.divergence).toBe("current");
    expect(r.canPublish).toBe(true);
  });

  it("approved legacy (no approvedBaseVersion) but diverged: treated as stale", () => {
    const r = evaluatePublishGovernance({
      ...baseInput,
      revisionStatus: "approved",
      baseVersion: 5,
      liveVersion: 9,
      approvedBaseVersion: null,
    });
    expect(r.staleApproval).toBe(true);
  });

  it("approved + stale + setting ON: blocked with re-approval guidance", () => {
    const r = evaluatePublishGovernance({
      ...baseInput,
      revisionStatus: "approved",
      baseVersion: 5,
      liveVersion: 7,
      approvedBaseVersion: 5,
      requireRebaseBeforePublish: true,
    });
    expect(r.staleApproval).toBe(true);
    expect(r.rebaseRequired).toBe(true);
    expect(r.canPublish).toBe(false);
    expect(r.blockReason).toMatch(/approved/i);
  });
});

describe("scheduled / deferred publish helpers", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 60 * 1000);

  type SchedRev = Parameters<typeof isScheduledPublishPending>[0] &
    Partial<Parameters<typeof isRevisionEditLockedBySchedule>[0]>;

  const rev = (over: Partial<SchedRev> = {}): SchedRev => ({
    status: "approved",
    autoPublishOnApproval: true,
    scheduledPublishAt: future,
    ...over,
  });

  describe("isScheduledPublishPending", () => {
    it("true for an armed, dated, active draft", () => {
      expect(isScheduledPublishPending(rev())).toBe(true);
    });
    it("false when not armed", () => {
      expect(
        isScheduledPublishPending(rev({ autoPublishOnApproval: false })),
      ).toBe(false);
    });
    it("false when no date (on-approval, not deferred)", () => {
      expect(isScheduledPublishPending(rev({ scheduledPublishAt: null }))).toBe(
        false,
      );
    });
    it("false once published or discarded", () => {
      expect(isScheduledPublishPending(rev({ status: "published" }))).toBe(
        false,
      );
      expect(isScheduledPublishPending(rev({ status: "discarded" }))).toBe(
        false,
      );
    });
  });

  describe("isScheduledPublishDue", () => {
    it("false while the target date is in the future", () => {
      expect(isScheduledPublishDue(rev())).toBe(false);
    });
    it("true once the target date has passed", () => {
      expect(isScheduledPublishDue(rev({ scheduledPublishAt: past }))).toBe(
        true,
      );
    });
    it("coerces ISO-string dates (front-end JSON shape)", () => {
      expect(
        isScheduledPublishDue(
          rev({ scheduledPublishAt: past.toISOString() as unknown as Date }),
        ),
      ).toBe(true);
    });
    it("false when not pending even if date passed", () => {
      expect(
        isScheduledPublishDue(
          rev({ scheduledPublishAt: past, status: "published" }),
        ),
      ).toBe(false);
    });
  });

  describe("isScheduledPublishLockActive", () => {
    it("true for an armed, dated, approved revision", () => {
      expect(isScheduledPublishLockActive(rev())).toBe(true);
    });
    it("true for an armed draft (no-approval committed schedule)", () => {
      // The schedule-publish endpoint only commits a schedule on a draft when
      // the change doesn't require review, so a pending draft schedule is
      // locked in and its locks engage.
      expect(isScheduledPublishLockActive(rev({ status: "draft" }))).toBe(true);
    });
    it("false while still awaiting approval (locks don't apply yet)", () => {
      expect(
        isScheduledPublishLockActive(rev({ status: "pending-review" })),
      ).toBe(false);
      expect(
        isScheduledPublishLockActive(rev({ status: "changes-requested" })),
      ).toBe(false);
    });
  });

  describe("isRevisionEditLockedBySchedule", () => {
    it("true when an active (approved) schedule locks edits", () => {
      expect(
        isRevisionEditLockedBySchedule(
          rev({ scheduledPublishLockEdits: true }),
        ),
      ).toBe(true);
    });
    it("true when a committed draft (no-approval) schedule locks edits", () => {
      expect(
        isRevisionEditLockedBySchedule(
          rev({ scheduledPublishLockEdits: true, status: "draft" }),
        ),
      ).toBe(true);
    });
    it("false while still pending approval — edits stay open", () => {
      expect(
        isRevisionEditLockedBySchedule(
          rev({ scheduledPublishLockEdits: true, status: "pending-review" }),
        ),
      ).toBe(false);
      expect(
        isRevisionEditLockedBySchedule(
          rev({ scheduledPublishLockEdits: true, status: "changes-requested" }),
        ),
      ).toBe(false);
    });
    it("false when lock flag is off", () => {
      expect(
        isRevisionEditLockedBySchedule(
          rev({ scheduledPublishLockEdits: false }),
        ),
      ).toBe(false);
    });
    it("false when the schedule isn't pending", () => {
      expect(
        isRevisionEditLockedBySchedule(
          rev({ scheduledPublishLockEdits: true, scheduledPublishAt: null }),
        ),
      ).toBe(false);
    });
  });

  describe("findPublishLockingScheduledRevision", () => {
    const list = [
      { version: 1, ...rev({ scheduledPublishLockOthers: true }) },
      { version: 2, ...rev({ scheduledPublishLockOthers: false }) },
    ];
    it("finds a sibling whose pending schedule locks others", () => {
      expect(findPublishLockingScheduledRevision(list, 2)?.version).toBe(1);
    });
    it("excludes the revision being published itself", () => {
      expect(findPublishLockingScheduledRevision(list, 1)).toBe(null);
    });
    it("ignores schedules without the lock-others flag", () => {
      expect(
        findPublishLockingScheduledRevision(
          [{ version: 2, ...rev({ scheduledPublishLockOthers: false }) }],
          99,
        ),
      ).toBe(null);
    });
    it("ignores a sibling still pending approval (lock not active yet)", () => {
      expect(
        findPublishLockingScheduledRevision(
          [
            {
              version: 1,
              ...rev({
                scheduledPublishLockOthers: true,
                status: "pending-review",
              }),
            },
          ],
          99,
        ),
      ).toBe(null);
    });
  });
});

describe("simpleToJSONSchema", () => {
  const simpleSchema: SimpleSchema = {
    type: "object",
    fields: [
      {
        key: "a_string",
        type: "string",
        description: "foo",
        required: true,
        enum: [],
        default: "",
        min: 0,
        max: 256,
      },
      {
        key: "a_integer",
        type: "integer",
        description: "",
        required: false,
        enum: [],
        default: "",
        min: -10,
        max: -1,
      },
      {
        key: "a_float",
        type: "float",
        description: "",
        required: true,
        enum: ["0.5", "0.75", "1.5", "3.0"],
        default: "0.5",
        min: 0,
        max: 25,
      },
      {
        key: "a_boolean",
        type: "boolean",
        description: "",
        required: false,
        enum: [],
        default: "",
        min: 5,
        max: 10,
      },
    ],
  };
  const expectedProperties = {
    a_string: {
      type: "string",
      description: "foo",
      minLength: 0,
      maxLength: 256,
    },
    a_integer: {
      type: "number",
      format: "number",
      minimum: -10,
      maximum: -1,
      multipleOf: 1,
    },
    a_float: {
      type: "number",
      enum: [0.5, 0.75, 1.5, 3],
      default: 0.5,
    },
    a_boolean: {
      type: "boolean",
    },
  };

  it("converts object", () => {
    expect(JSON.parse(simpleToJSONSchema(simpleSchema))).toEqual({
      type: "object",
      properties: expectedProperties,
      required: ["a_string", "a_float"],
      additionalProperties: false,
    });
  });
  it("honors a field's raw jsonSchema, superseding the simple type", () => {
    const schema: SimpleSchema = {
      type: "object",
      fields: [
        {
          key: "kv",
          type: "string",
          description: "",
          required: true,
          enum: [],
          default: "",
          jsonSchema: JSON.stringify({ type: "object" }),
        },
        {
          key: "ship",
          type: "string",
          description: "how it ships",
          required: true,
          enum: [],
          default: "",
          jsonSchema: JSON.stringify({ type: ["string", "null"] }),
        },
      ],
    };
    expect(JSON.parse(simpleToJSONSchema(schema))).toEqual({
      type: "object",
      properties: {
        kv: { type: "object" },
        ship: { type: ["string", "null"], description: "how it ships" },
      },
      required: ["kv", "ship"],
      additionalProperties: false,
    });
  });
  it("converts array of objects", () => {
    const arraySchema: SimpleSchema = { ...simpleSchema, type: "object[]" };
    expect(JSON.parse(simpleToJSONSchema(arraySchema))).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: expectedProperties,
        required: ["a_string", "a_float"],
        additionalProperties: false,
      },
    });
  });
  it("converts primitive", () => {
    const primitiveSchema: SimpleSchema = {
      ...simpleSchema,
      type: "primitive",
    };
    expect(JSON.parse(simpleToJSONSchema(primitiveSchema))).toEqual(
      expectedProperties.a_string,
    );
  });
  it("converts array of primitives", () => {
    const primitiveArraySchema: SimpleSchema = {
      ...simpleSchema,
      type: "primitive[]",
    };
    expect(JSON.parse(simpleToJSONSchema(primitiveArraySchema))).toEqual({
      type: "array",
      items: expectedProperties.a_string,
    });
  });

  it("throws an error if type is invalid", () => {
    const invalidSchema = { ...simpleSchema, type: "invalid" };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Invalid simple schema type");
  });

  it("throws an error if min is greater than max", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "integer",
          description: "",
          required: false,
          enum: [],
          default: "",
          min: 10,
          max: 5,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Invalid min or max for field invalid");
  });

  it("throws an error if min is greater than max for strings", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "string",
          description: "",
          required: false,
          enum: [],
          default: "",
          min: 10,
          max: 5,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Invalid min or max for field invalid");
  });

  it("throws an error if min is less than zero for strings", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "string",
          description: "",
          required: false,
          enum: [],
          default: "",
          min: -1,
          max: 5,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Invalid min or max for field invalid");
  });

  it("throws if default value not in enum", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "float",
          description: "",
          required: true,
          enum: ["0.5", "0.75", "1.5", "3.0"],
          default: "0.25",
          min: 0,
          max: 25,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Value '0.25' not in enum for field invalid");
  });

  it("throws if fields are empty", () => {
    const invalidSchema = { ...simpleSchema, fields: [] };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Schema must have at least 1 field");
  });

  it("throws if default value is outside of min/max", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "integer",
          description: "",
          required: true,
          enum: [],
          default: "100",
          min: 0,
          max: 25,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Value '100' is greater than max value for field invalid");
  });

  it("ignores min/max for enums", () => {
    const validSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "valid",
          type: "string",
          description: "",
          required: true,
          enum: ["a", "b", "cdefghijklm"],
          min: 2,
          max: 4,
        },
      ],
    };
    expect(JSON.parse(simpleToJSONSchema(validSchema as SimpleSchema))).toEqual(
      {
        type: "object",
        properties: {
          ...expectedProperties,
          valid: {
            type: "string",
            enum: ["a", "b", "cdefghijklm"],
          },
        },
        required: ["a_string", "a_float", "valid"],
        additionalProperties: false,
      },
    );
  });

  it("throws an error when integer value is a float", () => {
    const invalidSchema = {
      ...simpleSchema,
      fields: [
        ...simpleSchema.fields,
        {
          key: "invalid",
          type: "integer",
          description: "",
          required: true,
          enum: [],
          default: "0.5",
          min: 0,
          max: 25,
        },
      ],
    };
    expect(() =>
      JSON.parse(simpleToJSONSchema(invalidSchema as SimpleSchema)),
    ).toThrowError("Value '0.5' is not an integer for field invalid");
  });
});

describe("inferSchemaField", () => {
  it("Infers primitive values in isolation", () => {
    expect(inferSchemaField("test", "t")).toEqual({
      type: "string",
      key: "t",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 64,
    });
    expect(inferSchemaField(123, "")).toEqual({
      type: "integer",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 999,
    });
    expect(inferSchemaField(-0.5, "")).toEqual({
      type: "float",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: -999,
      max: 999,
    });
    expect(inferSchemaField(true, "")).toEqual({
      type: "boolean",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 0,
    });
  });
  it("Takes a bigger max/min if the value exceeds the current max/min", () => {
    expect(inferSchemaField(1000, "")).toEqual({
      type: "integer",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 1000,
    });
    expect(inferSchemaField(-1000, "")).toEqual({
      type: "integer",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: -1000,
      max: 999,
    });
    expect(inferSchemaField(1000.5, "")).toEqual({
      type: "float",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 1000.5,
    });
    expect(inferSchemaField(-1000.5, "")).toEqual({
      type: "float",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: -1000.5,
      max: 999,
    });

    // Does the same for max string length
    expect(inferSchemaField("a".repeat(300), "")).toEqual({
      type: "string",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 300,
    });
  });
  it("Infers primitive values given an existing schema", () => {
    // Existing string with long max length should keep the max length
    expect(
      inferSchemaField("test", "h", {
        type: "string",
        key: "h",
        description: "",
        required: true,
        enum: [],
        default: "",
        min: 0,
        max: 256,
      }),
    ).toEqual({
      type: "string",
      key: "h",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 256,
    });

    // Existing integer with a min value should keep the min value
    expect(
      inferSchemaField(123, "", {
        type: "integer",
        key: "",
        description: "",
        required: true,
        enum: [],
        default: "",
        min: -999,
        max: 999,
      }),
    ).toEqual({
      type: "integer",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: -999,
      max: 999,
    });
  });

  it("Upgrades from integer to float", () => {
    // Existing float with a new integer value should keep the float type
    expect(
      inferSchemaField(123, "", {
        type: "float",
        key: "",
        description: "",
        required: true,
        enum: [],
        default: "",
        min: 0,
        max: 999,
      }),
    ).toEqual({
      type: "float",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 999,
    });

    // Existing integer type, given a new float value, should change the type to float
    expect(
      inferSchemaField(123.5, "", {
        type: "integer",
        key: "",
        description: "",
        required: true,
        enum: [],
        default: "",
        min: 0,
        max: 999,
      }),
    ).toEqual({
      type: "float",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 999,
    });
  });

  it("throws when the types change in an incompatible way", () => {
    // Changing from string to integer should throw
    expect(() =>
      inferSchemaField(123, "", {
        type: "string",
        key: "",
        description: "",
        required: true,
        enum: [],
        default: "",
        min: 0,
        max: 999,
      }),
    ).toThrowError("Conflicting types");
  });

  it("throws when an unknown type is encountered", () => {
    // Try to infer type of an object (only primitives are supported)
    expect(() => inferSchemaField({ a: 1 }, "")).toThrowError(
      "Invalid value type: object",
    );
  });

  it("returns early when value is null or undefined", () => {
    expect(inferSchemaField(null, "")).toEqual(undefined);
    expect(inferSchemaField(undefined, "")).toEqual(undefined);

    // If given an existing schema, should return that
    const schema: SchemaField = {
      type: "string",
      key: "",
      description: "",
      required: true,
      enum: [],
      default: "",
      min: 0,
      max: 999,
    };
    expect(inferSchemaField(null, "", schema)).toEqual(schema);
    expect(inferSchemaField(undefined, "", schema)).toEqual(schema);
  });
});

describe("inferSchemaFields", () => {
  // structuredClone missing from our jest version
  // This is a hack, but should work since we aren't using Dates or other non-JSON types
  const structuredClone = (obj: unknown) => JSON.parse(JSON.stringify(obj));
  it("Infers object fields in isolation", () => {
    const obj = {
      a_string: "test",
      a_integer: 123,
    };
    expect([...inferSchemaFields(obj).entries()]).toEqual([
      ["a_string", inferSchemaField("test", "a_string")],
      ["a_integer", inferSchemaField(123, "a_integer")],
    ]);
  });
  it("Infers object fields given an existing schema", () => {
    const obj = {
      a_string: "test",
      a_float: -50,
    };
    const existing_float_schema = inferSchemaField(
      256.1,
      "a_float",
    ) as SchemaField;
    const existing_str_schema = inferSchemaField(
      "test",
      "a_string",
    ) as SchemaField;
    const existing = new Map([
      ["a_float", structuredClone(existing_float_schema)],
      ["a_string", structuredClone(existing_str_schema)],
    ]);
    expect([...inferSchemaFields(obj, existing).entries()]).toEqual([
      ["a_float", inferSchemaField(-50, "a_float", existing_float_schema)],
      ["a_string", inferSchemaField("test", "a_string")],
    ]);
  });
  it("Sets required to false when a field is missing from existing schema", () => {
    // Field missing from existing schema
    const obj = {
      a_string: "test",
      a_integer: 123,
    };
    const existing_int = inferSchemaField(50, "a_integer") as SchemaField;
    const existing = new Map([["a_integer", structuredClone(existing_int)]]);
    expect([...inferSchemaFields(obj, existing).entries()]).toEqual([
      ["a_integer", inferSchemaField(123, "a_integer", existing_int)],
      [
        "a_string",
        { ...inferSchemaField("test", "a_string"), required: false },
      ],
    ]);
  });
  it("Sets required to false when a field is missing from the new schema", () => {
    // Field missing from new schema
    const obj = {
      a_string: "test",
    };
    const existing_str = inferSchemaField("test", "a_string") as SchemaField;
    const existing_int = inferSchemaField(50, "a_integer") as SchemaField;
    const existing = new Map([
      // Need to clone since the function mutates the arguments
      ["a_integer", structuredClone(existing_int)],
      ["a_string", structuredClone(existing_str)],
    ]);
    expect([...inferSchemaFields(obj, existing).entries()]).toEqual([
      ["a_integer", { ...existing_int, required: false }],
      ["a_string", existing_str],
    ]);
  });
});

describe("inferSimpleSchemaFromValue", () => {
  it("Infers a primitive value", () => {
    expect(inferSimpleSchemaFromValue(JSON.stringify("test"))).toEqual({
      type: "primitive",
      fields: [inferSchemaField("test", "")],
    });

    expect(inferSimpleSchemaFromValue(JSON.stringify(123))).toEqual({
      type: "primitive",
      fields: [inferSchemaField(123, "")],
    });

    expect(inferSimpleSchemaFromValue(JSON.stringify(-0.5))).toEqual({
      type: "primitive",
      fields: [inferSchemaField(-0.5, "")],
    });

    expect(inferSimpleSchemaFromValue(JSON.stringify(false))).toEqual({
      type: "primitive",
      fields: [inferSchemaField(false, "")],
    });
  });
  it("Returns generic schema when value is null, undefined, or invalid JSON", () => {
    expect(inferSimpleSchemaFromValue(JSON.stringify(null))).toEqual({
      type: "object",
      fields: [],
    });
    expect(inferSimpleSchemaFromValue("not json")).toEqual({
      type: "object",
      fields: [],
    });
  });
  it("Inferes a primitive array", () => {
    expect(
      inferSimpleSchemaFromValue(JSON.stringify(["test", "test2"])),
    ).toEqual({
      type: "primitive[]",
      fields: [inferSchemaField("test", "")],
    });
    expect(
      inferSimpleSchemaFromValue(
        JSON.stringify([null, null, 123, 456, 1000, 26.5, -50]),
      ),
    ).toEqual({
      type: "primitive[]",
      fields: [{ ...inferSchemaField(1000, ""), min: -999, type: "float" }],
    });
    expect(inferSimpleSchemaFromValue(JSON.stringify([true, false]))).toEqual({
      type: "primitive[]",
      fields: [inferSchemaField(true, "")],
    });
  });
  it("Returns generic schema when primitive array values are mixed", () => {
    expect(
      inferSimpleSchemaFromValue(JSON.stringify(["test", 123, false])),
    ).toEqual({
      type: "object",
      fields: [],
    });
  });
  it("Infers an object", () => {
    expect(
      inferSimpleSchemaFromValue(JSON.stringify({ a: "test", b: 123 })),
    ).toEqual({
      type: "object",
      fields: [inferSchemaField("test", "a"), inferSchemaField(123, "b")],
    });
  });
  it("Infers an array of objects", () => {
    expect(
      inferSimpleSchemaFromValue(
        JSON.stringify([
          { a: null, b: 123.5 },
          { a: "test2", b: 1000 },
          { b: -50, c: true },
        ]),
      ),
    ).toEqual({
      type: "object[]",
      fields: [
        { ...inferSchemaField(123.5, "b"), min: -999, max: 1000 },
        { ...inferSchemaField("test", "a"), required: false },
        { ...inferSchemaField(true, "c"), required: false },
      ],
    });
  });
  it("Returns generic schema when value has too much nesting", () => {
    expect(
      inferSimpleSchemaFromValue(
        JSON.stringify({ a: { b: { c: { d: { e: "test" } } } } }),
      ),
    ).toEqual({
      type: "object",
      fields: [],
    });
  });
  it("Returns generic array schema given an empty array (or one full of nulls)", () => {
    expect(inferSimpleSchemaFromValue(JSON.stringify([]))).toEqual({
      type: "object[]",
      fields: [],
    });
    expect(inferSimpleSchemaFromValue(JSON.stringify([null, null]))).toEqual({
      type: "object[]",
      fields: [],
    });
  });
});

// TODO: add test cases for simple schemas
describe("getValidation", () => {
  it("returns validationEnabled as true if jsonSchema is populated and enabled", () => {
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(getValidation(feature).validationEnabled).toEqual(true);
  });
  it("returns validationEnabled as false if jsonSchema enabled value is false", () => {
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: false,
    };
    expect(getValidation(feature).validationEnabled).toEqual(false);
  });
  it("returns validationEnabled as false if jsonSchema is invalid", () => {
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: "blahblah",
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(getValidation(feature).validationEnabled).toEqual(false);
  });
  it("returns validationEnabled if simple is set, even if schema is invalid", () => {
    feature.jsonSchema = {
      schemaType: "simple",
      simple: {
        type: "primitive",
        fields: [
          {
            default: "",
            type: "string",
            description: "",
            enum: [],
            key: "",
            max: 256,
            min: 0,
            required: true,
          },
        ],
      },
      schema: "blahblah",
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(getValidation(feature).validationEnabled).toEqual(true);
  });
  it("returns validationEnabled false if simple schema is invalid", () => {
    feature.jsonSchema = {
      schemaType: "simple",
      simple: { type: "object", fields: [] },
      schema: "blahblah",
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(getValidation(feature).validationEnabled).toEqual(false);
  });
  it("returns validationEnabled as false if jsonSchema is undefined", () => {
    feature.jsonSchema = undefined;
    expect(getValidation(feature).validationEnabled).toEqual(false);
  });
});

describe("validateJSONFeatureValue", () => {
  it("returns valid as true if all values are valid and json schema test passes", () => {
    const value = { test: "123" };
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(true);
  });
  it("returns valid as false if all values are valid but json schema test fails", () => {
    const value = { test: 999 };
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(false);
  });
  it("returns valid as false if json schema is invalid", () => {
    const value = { test: 999 };
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: '{ "type": 123 }',
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(false);
  });
  it("returns valid as false if unparseable json value is supplied", () => {
    const value = "{ not json }";
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: true,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(false);
  });
  it("returns valid as true if validation is not enabled", () => {
    const value = { test: "123" };
    feature.jsonSchema = {
      schemaType: "schema",
      simple: { type: "object", fields: [] },
      schema: JSON.stringify(exampleJsonSchema),
      date: new Date("2020-04-20"),
      enabled: false,
    };
    expect(validateJSONFeatureValue(value, feature).valid).toEqual(true);
  });
});

describe("validateFeatureValue", () => {
  beforeAll(() => {
    feature.valueType = "boolean";
  });
  describe("boolean values", () => {
    it('returns "true" if value is truthy', () => {
      expect(validateFeatureValue(feature, "true", "testVal")).toEqual("true");
      expect(validateFeatureValue(feature, "0", "testVal")).toEqual("true");
    });
    it('returns "false" if value is "false"', () => {
      expect(validateFeatureValue(feature, "false", "testVal")).toEqual(
        "false",
      );
    });
  });

  describe("number values", () => {
    beforeAll(() => {
      feature.valueType = "number";
    });
    it("returns value if its a valid number", () => {
      let value = "0";
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(value);
      value = "9918";
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(value);
    });
    it("throws an error if value is not a valid number", () => {
      const value = "not-a-number";
      expect(() =>
        validateFeatureValue(feature, value, "testVal"),
      ).toThrowError();
    });
  });

  describe("json values", () => {
    beforeAll(() => {
      feature.valueType = "json";
    });

    it("returns unmodified string when already valid", () => {
      const value = '{ "test": 123 }';
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(value);
    });

    it('parses json that is "slightly" invalid', () => {
      let value = "{ technically: 'not valid' }";
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(
        '{"technically": "not valid"}',
      );
      value = "this is not jsonbruv";
      expect(validateFeatureValue(feature, value, "testVal")).toEqual(
        `"${value}"`,
      );
    });

    it("throws an error with invalid json", () => {
      const value = "{ not-an-object }";
      expect(() =>
        validateFeatureValue(feature, value, "testVal"),
      ).toThrowError();
    });
  });

  describe("string values with a schema", () => {
    const stringFeature = (
      schema: object,
    ): Pick<FeatureInterface, "valueType" | "jsonSchema"> => ({
      valueType: "string",
      jsonSchema: {
        schemaType: "schema",
        schema: JSON.stringify(schema),
        simple: { type: "primitive", fields: [] },
        date: new Date(),
        enabled: true,
      },
    });

    it("accepts a string within maxLength and rejects one over it", () => {
      const f = stringFeature({ type: "string", maxLength: 5 });
      expect(validateFeatureValue(f, "hello", "testVal")).toEqual("hello");
      expect(() =>
        validateFeatureValue(f, "toolong", "testVal"),
      ).toThrowError();
    });

    it("enforces an enum", () => {
      const f = stringFeature({ type: "string", enum: ["a", "b"] });
      expect(validateFeatureValue(f, "a", "testVal")).toEqual("a");
      expect(() => validateFeatureValue(f, "c", "testVal")).toThrowError();
    });
  });

  describe("number values with a schema", () => {
    const numberFeature = (
      schema: object,
    ): Pick<FeatureInterface, "valueType" | "jsonSchema"> => ({
      valueType: "number",
      jsonSchema: {
        schemaType: "schema",
        schema: JSON.stringify(schema),
        simple: { type: "primitive", fields: [] },
        date: new Date(),
        enabled: true,
      },
    });

    it("enforces minimum and maximum", () => {
      const f = numberFeature({ type: "number", minimum: 1, maximum: 10 });
      expect(validateFeatureValue(f, "5", "testVal")).toEqual("5");
      expect(() => validateFeatureValue(f, "0", "testVal")).toThrowError();
      expect(() => validateFeatureValue(f, "50", "testVal")).toThrowError();
    });

    it("enforces integer type", () => {
      const f = numberFeature({ type: "integer" });
      expect(validateFeatureValue(f, "5", "testVal")).toEqual("5");
      expect(() => validateFeatureValue(f, "5.5", "testVal")).toThrowError();
    });
  });
});

describe("getRevertValueValidationWarnings", () => {
  const numberSchema: Pick<FeatureInterface, "valueType" | "jsonSchema"> = {
    valueType: "number",
    jsonSchema: {
      schemaType: "schema",
      schema: JSON.stringify({ type: "number", minimum: 1, maximum: 10 }),
      simple: { type: "primitive", fields: [] },
      date: new Date(),
      enabled: true,
    },
  };

  it("returns no warnings when all restored values are valid", () => {
    expect(
      getRevertValueValidationWarnings(numberSchema, {
        defaultValue: "5",
        rules: [
          { id: "a", type: "force", value: "3" } as never,
          {
            id: "b",
            type: "experiment-ref",
            variations: [
              { variationId: "0", value: "2" },
              { variationId: "1", value: "9" },
            ],
          } as never,
        ],
      }),
    ).toEqual([]);
  });

  it("flags a default value that no longer parses under the current schema", () => {
    const warnings = getRevertValueValidationWarnings(numberSchema, {
      defaultValue: "50",
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("Default value");
  });

  it("flags invalid values inside reverted rules", () => {
    const warnings = getRevertValueValidationWarnings(numberSchema, {
      rules: [
        { id: "a", type: "force", value: "not-a-number" } as never,
        {
          id: "b",
          type: "experiment",
          values: [
            { value: "5", weight: 0.5 },
            { value: "999", weight: 0.5 },
          ],
        } as never,
      ],
    });
    expect(warnings.length).toBe(2);
    expect(warnings[0]).toContain("Rule #1");
    expect(warnings[1]).toContain("Rule #2 variation #2");
  });

  it("validates against the revert's own metadata schema when it changes too", () => {
    // Reverting valueType back to json: a value that fails as a number should
    // pass once the schema is also reverted to json.
    const warnings = getRevertValueValidationWarnings(numberSchema, {
      defaultValue: '{"a":1}',
      metadata: { valueType: "json", jsonSchema: undefined },
    });
    expect(warnings).toEqual([]);
  });
});

describe("assertSchemaMatchesValueType", () => {
  const rawSchema = (schema: object, enabled = true) => ({
    schemaType: "schema" as const,
    schema: JSON.stringify(schema),
    simple: { type: "primitive" as const, fields: [] },
    enabled,
  });

  it("allows any schema for json flags", () => {
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ type: "object" }), "json"),
    ).not.toThrow();
  });

  it("rejects any schema for boolean flags", () => {
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ type: "string" }), "boolean"),
    ).toThrow();
  });

  it("requires a number/integer top-level type for number flags", () => {
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ type: "number" }), "number"),
    ).not.toThrow();
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ type: "integer" }), "number"),
    ).not.toThrow();
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ type: "object" }), "number"),
    ).toThrow();
  });

  it("requires a string top-level type for string flags", () => {
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ type: "string" }), "string"),
    ).not.toThrow();
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ type: "number" }), "string"),
    ).toThrow();
  });

  it("allows type-less schemas with an enum matching the value type", () => {
    expect(() =>
      assertSchemaMatchesValueType(
        rawSchema({ enum: ["red", "green", "blue"] }),
        "string",
      ),
    ).not.toThrow();
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ enum: [1, 2, 3] }), "number"),
    ).not.toThrow();
  });

  it("rejects type-less schemas whose enum values don't match the value type", () => {
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ enum: [1, 2, 3] }), "string"),
    ).toThrow();
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ enum: ["red", 2] }), "string"),
    ).toThrow();
    expect(() =>
      assertSchemaMatchesValueType(rawSchema({ enum: ["1", "2"] }), "number"),
    ).toThrow();
  });

  it("rejects type-less schemas without an enum", () => {
    expect(() =>
      assertSchemaMatchesValueType(
        rawSchema({ properties: { test: { type: "string" } } }),
        "string",
      ),
    ).toThrow();
    expect(() =>
      assertSchemaMatchesValueType(
        rawSchema({ items: { type: "number" } }),
        "number",
      ),
    ).toThrow();
    expect(() =>
      assertSchemaMatchesValueType(
        rawSchema({ anyOf: [{ const: "a" }, { const: "b" }] }),
        "string",
      ),
    ).toThrow();
  });

  it("does not enforce anything when the schema is disabled", () => {
    expect(() =>
      assertSchemaMatchesValueType(
        rawSchema({ type: "object" }, false),
        "number",
      ),
    ).not.toThrow();
  });

  it("validates a simple primitive schema against the flag type", () => {
    const simpleString = {
      schemaType: "simple" as const,
      schema: "",
      simple: {
        type: "primitive" as const,
        fields: [
          {
            key: "",
            type: "string" as const,
            required: true,
            default: "",
            description: "",
            enum: [],
            min: 0,
            max: 10,
          },
        ],
      },
      enabled: true,
    };
    expect(() =>
      assertSchemaMatchesValueType(simpleString, "string"),
    ).not.toThrow();
    expect(() =>
      assertSchemaMatchesValueType(simpleString, "number"),
    ).toThrow();
  });
});

describe("validateCondition", () => {
  it("returns success when condition is undefined", () => {
    expect(validateCondition(undefined)).toEqual({
      success: true,
      empty: true,
    });
  });
  it("returns success when condition is empty", () => {
    expect(validateCondition("")).toEqual({
      success: true,
      empty: true,
    });
  });
  it("returns success when condition is empty object", () => {
    expect(validateCondition("{}")).toEqual({
      success: true,
      empty: true,
    });
  });
  it("returns error when condition is completely invalid", () => {
    expect(validateCondition("{(+")).toEqual({
      success: false,
      empty: false,
      error:
        "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
    });
  });
  it("returns error when condition is not an object", () => {
    expect(validateCondition("123")).toEqual({
      success: false,
      empty: false,
      error: "Must be object",
    });
  });
  it("returns suggested value when condition is invalid, but able to be fixed automatically", () => {
    expect(validateCondition("{test: true}")).toEqual({
      success: false,
      empty: false,
      error:
        "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
      suggestedValue: '{"test":true}',
    });
  });
  it("returns success when condition is valid", () => {
    expect(validateCondition('{"test": true}')).toEqual({
      success: true,
      empty: false,
    });
  });
  it("returns error when condition has unknown nested saved group id", () => {
    expect(
      validateCondition(
        JSON.stringify({
          foo: "bar",
          $savedGroups: ["a"],
        }),
        new Map([
          [
            "known-group-id",
            {
              id: "known-group-id",
              type: "condition",
              condition: JSON.stringify({
                bar: "baz",
              }),
            },
          ],
        ]),
      ),
    ).toEqual({
      success: false,
      empty: false,
      error: "Condition includes invalid or cyclic saved group reference",
    });
  });
  it("returns success when condition has known nested saved group id", () => {
    expect(
      validateCondition(
        JSON.stringify({
          foo: "bar",
          $savedGroups: ["known-group-id"],
        }),
        new Map([
          [
            "known-group-id",
            {
              id: "known-group-id",
              type: "condition",
              condition: JSON.stringify({
                bar: "baz",
              }),
            },
          ],
        ]),
      ),
    ).toEqual({
      success: true,
      empty: false,
    });
  });
});

describe("extractConditionAttributeKeys", () => {
  it("returns empty for nullish / non-object input", () => {
    expect(extractConditionAttributeKeys(undefined)).toEqual([]);
    expect(extractConditionAttributeKeys(null)).toEqual([]);
    expect(extractConditionAttributeKeys("string")).toEqual([]);
    expect(extractConditionAttributeKeys({})).toEqual([]);
  });

  it("extracts bare equality keys", () => {
    expect(
      extractConditionAttributeKeys({ userId: "abc", country: "US" }).sort(),
    ).toEqual(["country", "userId"]);
  });

  it("skips operator keys ($eq, $gte, $in, $elemMatch)", () => {
    expect(
      extractConditionAttributeKeys({
        age: { $gte: 18, $lte: 99 },
        country: { $in: ["US", "CA"] },
        roles: { $elemMatch: { $eq: "admin" } },
      }).sort(),
    ).toEqual(["age", "country", "roles"]);
  });

  it("treats $inGroup / $notInGroup as operators, not attributes", () => {
    expect(
      extractConditionAttributeKeys({
        userId: { $inGroup: "sg_123" },
        tenant: { $notInGroup: "sg_456" },
      }).sort(),
    ).toEqual(["tenant", "userId"]);
  });

  it("recurses into $and / $or / $nor / $not", () => {
    expect(
      extractConditionAttributeKeys({
        $and: [{ userId: "x" }, { $or: [{ plan: "free" }, { plan: "trial" }] }],
        $nor: [{ banned: true }],
        $not: { archived: true },
      }).sort(),
    ).toEqual(["archived", "banned", "plan", "userId"]);
  });

  it("deduplicates repeated attribute keys", () => {
    expect(
      extractConditionAttributeKeys({
        $or: [{ plan: "free" }, { plan: "trial" }, { plan: "paid" }],
      }),
    ).toEqual(["plan"]);
  });

  it("keeps dot-notation keys intact (caller checks root segment)", () => {
    expect(
      extractConditionAttributeKeys({ "user.id": "x", "user.role": "admin" }),
    ).toEqual(["user.id", "user.role"]);
  });
});

describe("findUnregisteredAttributes", () => {
  const schema = [
    { property: "userId", datatype: "string" as const },
    { property: "country", datatype: "string" as const },
    { property: "user", datatype: "string" as const },
    {
      property: "legacyId",
      datatype: "string" as const,
      archived: true,
    },
  ];

  it("returns empty when every key is registered and active", () => {
    expect(findUnregisteredAttributes(["userId", "country"], schema)).toEqual(
      [],
    );
  });

  it("flags truly unknown keys", () => {
    expect(
      findUnregisteredAttributes(["userId", "accountUUID"], schema),
    ).toEqual(["accountUUID"]);
  });

  it("flags archived attributes as unregistered", () => {
    expect(findUnregisteredAttributes(["legacyId"], schema)).toEqual([
      "legacyId",
    ]);
  });

  it("treats dot-notation keys as registered via their root segment", () => {
    expect(
      findUnregisteredAttributes(["user.id", "user.role"], schema),
    ).toEqual([]);
  });

  it("deduplicates repeated bad keys in the output", () => {
    expect(
      findUnregisteredAttributes(["typo", "typo", "other_typo"], schema),
    ).toEqual(["typo", "other_typo"]);
  });

  it("treats undefined schema as empty (everything unregistered)", () => {
    expect(findUnregisteredAttributes(["userId"], undefined)).toEqual([
      "userId",
    ]);
  });
});

describe("categorizeUnregisteredAttributes", () => {
  const schema = [
    { property: "userId", datatype: "string" as const },
    {
      property: "country",
      datatype: "string" as const,
      projects: ["proj_one"],
    },
    {
      property: "betaFlag",
      datatype: "string" as const,
      projects: ["proj_two", "proj_three"],
    },
    {
      property: "legacyId",
      datatype: "string" as const,
      archived: true,
    },
  ];

  it("returns empty buckets when every key is registered for the project", () => {
    expect(
      categorizeUnregisteredAttributes(
        ["userId", "country"],
        schema,
        "proj_one",
      ),
    ).toEqual({ unknown: [], outOfProject: [] });
  });

  it("flags truly unknown keys as unknown", () => {
    expect(
      categorizeUnregisteredAttributes(["typo"], schema, "proj_one"),
    ).toEqual({ unknown: ["typo"], outOfProject: [] });
  });

  it("flags attributes scoped to other projects as outOfProject", () => {
    expect(
      categorizeUnregisteredAttributes(["betaFlag"], schema, "proj_one"),
    ).toEqual({ unknown: [], outOfProject: ["betaFlag"] });
  });

  it("includes both buckets when input has a mix", () => {
    expect(
      categorizeUnregisteredAttributes(
        ["userId", "betaFlag", "typo"],
        schema,
        "proj_one",
      ),
    ).toEqual({ unknown: ["typo"], outOfProject: ["betaFlag"] });
  });

  it("matches multi-project context if any project overlaps", () => {
    expect(
      categorizeUnregisteredAttributes(["betaFlag"], schema, [
        "proj_one",
        "proj_two",
      ]),
    ).toEqual({ unknown: [], outOfProject: [] });
  });

  it("treats archived attributes as unknown, not outOfProject", () => {
    expect(
      categorizeUnregisteredAttributes(["legacyId"], schema, "proj_one"),
    ).toEqual({ unknown: ["legacyId"], outOfProject: [] });
  });

  it("does not produce outOfProject entries when no project context is provided", () => {
    expect(categorizeUnregisteredAttributes(["betaFlag"], schema)).toEqual({
      unknown: [],
      outOfProject: [],
    });
  });
});

describe("getRequireRegisteredAttributesSettings", () => {
  it("treats undefined / null / false / missing as fully off", () => {
    for (const v of [undefined, null, false]) {
      expect(getRequireRegisteredAttributesSettings(v)).toEqual({
        isOn: false,
        requireProjectScoping: false,
      });
    }
  });

  it("normalizes legacy boolean true to strict mode (preserves prior behavior)", () => {
    // Older orgs only had the boolean and were already getting project-scoped
    // checks. Migrating them to { isOn:false } or
    // { requireProjectScoping:false } would silently relax their guards.
    expect(getRequireRegisteredAttributesSettings(true)).toEqual({
      isOn: true,
      requireProjectScoping: true,
    });
  });

  it("passes through the canonical object shape", () => {
    expect(
      getRequireRegisteredAttributesSettings({
        isOn: true,
        requireProjectScoping: false,
      }),
    ).toEqual({ isOn: true, requireProjectScoping: false });
    expect(
      getRequireRegisteredAttributesSettings({
        isOn: false,
        requireProjectScoping: true,
      }),
    ).toEqual({ isOn: false, requireProjectScoping: true });
  });

  it("defaults requireProjectScoping to true when missing on the object (strict default)", () => {
    expect(
      getRequireRegisteredAttributesSettings({
        isOn: true,
      } as unknown as { isOn: boolean; requireProjectScoping: boolean }),
    ).toEqual({ isOn: true, requireProjectScoping: true });
  });
});

describe("check enviroments match", () => {
  it("should find a environment match", () => {
    const environments = ["prod", "staging"];
    const reviewSetting = {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: ["prod"],
      projects: [],
    };
    expect(checkEnvironmentsMatch(environments, reviewSetting)).toEqual(true);
  });

  it("should not find a environment match", () => {
    const environments = ["prod-1"];
    const reviewSetting = {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: ["prod"],
      projects: [],
    };
    expect(checkEnvironmentsMatch(environments, reviewSetting)).toEqual(false);
  });

  it("should turn on when everything is empty", () => {
    const environments = ["prod", "staging"];
    const reviewSetting: RequireReview = {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: [],
      projects: [],
    };
    expect(checkEnvironmentsMatch(environments, reviewSetting)).toEqual(true);
  });
});
describe("check revision needs review", () => {
  it("should require review when env matches", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["prod"],
          projects: [],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(true);
  });
  it("should not require review", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["dev"],
          projects: [],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(false);
  });

  it("should require review with multi rules", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["dev"],
          projects: ["a"],
        },
        {
          requireReviewOn: false,
          resetReviewOnChange: false,
          environments: [],
          projects: ["b"],
        },
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["prod"],
          projects: [],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(true);
  });
  it("should not require review with multi rules", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["dev"],
          projects: [],
        },
        {
          requireReviewOn: false,
          resetReviewOnChange: false,
          environments: [],
          projects: [],
        },
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["staging"],
          projects: [],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(false);
  });
  it("does not require review for a non-gated env change on a brand-new feature (holdout undefined vs null)", () => {
    // Mirrors FeaturesOverview.tsx: filledLive is built via liveRevisionFromFeature
    // and used as BOTH base and the spread-target for effectiveRevision. On a
    // brand-new feature neither the feature nor the live revision has a `holdout`
    // field, so liveRevisionFromFeature falls through to `liveRevision.holdout`
    // (undefined). The asymmetric `?? null` in revisionHasGlobalChange used to
    // compare undefined vs null and report a global change, returning "all"
    // affected envs and forcing review even when only a non-gated env changed.
    const allEnvironments = ["production", "staging"];
    const newFeature: FeatureInterface = {
      ...feature,
      defaultValue: "false",
      environmentSettings: {
        production: { enabled: false, rules: [] },
        staging: { enabled: true, rules: [] },
      },
      // No `holdout` key — matches a freshly-created feature.
    };
    const liveRev: FeatureRevisionInterface = {
      ...baseRevision,
      version: 1,
      defaultValue: "false",
      rules: { production: [], staging: [] },
      environmentsEnabled: { production: false, staging: true },
      // No `holdout` key — createInitialRevision does not set one.
    };
    const filledLive = {
      ...liveRev,
      ...liveRevisionFromFeature(liveRev, newFeature),
    };
    // Draft only changes staging rules; everything else inherited from filledLive.
    const effectiveRevision = {
      ...filledLive,
      rules: {
        ...filledLive.rules,
        staging: [
          {
            id: "fr_1",
            type: "force" as const,
            description: "",
            value: "true",
            enabled: true,
          },
        ],
      },
    };
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["production"],
          projects: [],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature: newFeature,
        baseRevision: filledLive,
        revision: effectiveRevision,
        allEnvironments,
        settings,
      }),
    ).toEqual(false);
  });
  it("legacy rules", () => {
    const settings: OrganizationSettings = {
      requireReviews: true,
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(true);
    settings.requireReviews = false;
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision,
        revision,
        allEnvironments: ["prod", "dev", "staging"],
        settings,
      }),
    ).toEqual(false);
  });
});

describe("reset review on change", () => {
  it("require reset with single rule", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: true,
          environments: ["prod"],
          projects: [],
        },
      ],
    };
    const settingsOff: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["prod"],
          projects: [],
        },
      ],
    };
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(true);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings: settingsOff,
      }),
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings: settingsOff,
      }),
    ).toEqual(false);
  });

  it("require reset with multiple rules", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: true,
          environments: ["prod"],
          projects: [],
        },
        {
          requireReviewOn: true,
          resetReviewOnChange: true,
          environments: [],
          projects: [],
        },
      ],
    };
    const settingsOff: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["prod"],
          projects: [],
        },
        {
          requireReviewOn: true,
          resetReviewOnChange: true,
          environments: [],
          projects: [],
        },
      ],
    };
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(true);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["prod"],
        defaultValueChanged: false,
        settings: settingsOff,
      }),
    ).toEqual(false);
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings: settingsOff,
      }),
    ).toEqual(false);
  });
  it("turn off for first project", () => {
    const settings: OrganizationSettings = {
      requireReviews: [
        {
          requireReviewOn: false,
          resetReviewOnChange: false,
          environments: [],
          projects: ["a"],
        },
        {
          requireReviewOn: true,
          resetReviewOnChange: true,
          environments: [],
          projects: [],
        },
      ],
    };
    feature.project = "a";
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["env"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(false);
    feature.project = "b";
    expect(
      resetReviewOnChange({
        feature,
        changedEnvironments: ["staging"],
        defaultValueChanged: false,
        settings,
      }),
    ).toEqual(true);
  });
});

describe("ruleAppliesToEnv", () => {
  const baseRule = {
    type: "force" as const,
    id: "r1",
    description: "",
    enabled: true,
    value: "x",
  };

  it("returns true when allEnvironments is true regardless of environments[]", () => {
    const rule: FeatureRule = {
      ...baseRule,
      allEnvironments: true,
      environments: ["dev"],
    } as FeatureRule;
    expect(ruleAppliesToEnv(rule, "production")).toBe(true);
    expect(ruleAppliesToEnv(rule, "dev")).toBe(true);
  });

  it("uses environments[] membership when allEnvironments is false", () => {
    const rule: FeatureRule = {
      ...baseRule,
      allEnvironments: false,
      environments: ["production", "dev"],
    } as FeatureRule;
    expect(ruleAppliesToEnv(rule, "production")).toBe(true);
    expect(ruleAppliesToEnv(rule, "dev")).toBe(true);
    expect(ruleAppliesToEnv(rule, "staging")).toBe(false);
  });

  it("permissive fallback when neither allEnvironments nor environments[] is declared", () => {
    const rule: FeatureRule = {
      ...baseRule,
    } as FeatureRule;
    expect(ruleAppliesToEnv(rule, "production")).toBe(true);
  });

  it("strict: explicit environments:[] applies to no env (intentional 'pending' / ramp-not-yet-scoped)", () => {
    const rule: FeatureRule = {
      ...baseRule,
      allEnvironments: false,
      environments: [],
    } as FeatureRule;
    expect(ruleAppliesToEnv(rule, "production")).toBe(false);
    expect(ruleAppliesToEnv(rule, "dev")).toBe(false);
    expect(ruleAppliesToEnv(rule, "staging")).toBe(false);
  });
});

describe("ruleFootprint", () => {
  const baseRule = {
    type: "force" as const,
    id: "r1",
    description: "",
    enabled: true,
    value: "x",
  };
  const applicable = ["dev", "staging", "production"];

  it("allEnvironments: true expands to the applicable env set", () => {
    const rule: FeatureRule = {
      ...baseRule,
      allEnvironments: true,
    } as FeatureRule;
    expect(ruleFootprint(rule, applicable)).toEqual(applicable);
  });

  it("allEnvironments wins over environments[] when both are set", () => {
    const rule: FeatureRule = {
      ...baseRule,
      allEnvironments: true,
      environments: ["dev"],
    } as FeatureRule;
    expect(ruleFootprint(rule, applicable)).toEqual(applicable);
  });

  it("environments:[list] intersects with the applicable set", () => {
    const rule: FeatureRule = {
      ...baseRule,
      allEnvironments: false,
      environments: ["production", "dev", "unknown"],
    } as FeatureRule;
    expect(ruleFootprint(rule, applicable)).toEqual(["production", "dev"]);
  });

  it("strict: explicit environments:[] returns [] (applies nowhere)", () => {
    const rule: FeatureRule = {
      ...baseRule,
      allEnvironments: false,
      environments: [],
    } as FeatureRule;
    expect(ruleFootprint(rule, applicable)).toEqual([]);
  });

  it("permissive fallback: neither field declared expands to applicable envs", () => {
    const rule: FeatureRule = {
      ...baseRule,
    } as FeatureRule;
    expect(ruleFootprint(rule, applicable)).toEqual(applicable);
  });

  it("aligns with ruleAppliesToEnv across the four scope states", () => {
    const cases: Array<{ rule: FeatureRule; label: string }> = [
      {
        label: "allEnvironments: true",
        rule: { ...baseRule, allEnvironments: true } as FeatureRule,
      },
      {
        label: "environments: [list]",
        rule: {
          ...baseRule,
          allEnvironments: false,
          environments: ["dev", "production"],
        } as FeatureRule,
      },
      {
        label: "environments: []",
        rule: {
          ...baseRule,
          allEnvironments: false,
          environments: [],
        } as FeatureRule,
      },
      {
        label: "neither declared (malformed)",
        rule: { ...baseRule } as FeatureRule,
      },
    ];
    for (const { rule, label } of cases) {
      const footprint = new Set(ruleFootprint(rule, applicable));
      for (const env of applicable) {
        expect({ label, env, applies: ruleAppliesToEnv(rule, env) }).toEqual({
          label,
          env,
          applies: footprint.has(env),
        });
      }
    }
  });
});

describe("getRulesForEnvironment", () => {
  const mk = (
    id: string,
    scope: { allEnvironments?: boolean; environments?: string[] },
  ): FeatureRule =>
    ({
      type: "force",
      id,
      description: "",
      enabled: true,
      value: id,
      ...scope,
    }) as FeatureRule;

  it("preserves input order while filtering to env", () => {
    const rules = [
      mk("a", { environments: ["production"] }),
      mk("b", { environments: ["dev"] }),
      mk("c", { allEnvironments: true }),
      mk("d", { environments: ["production", "dev"] }),
    ];
    expect(
      getRulesForEnvironment(rules, "production").map((r) => r.id),
    ).toEqual(["a", "c", "d"]);
    expect(getRulesForEnvironment(rules, "dev").map((r) => r.id)).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect(getRulesForEnvironment(rules, "staging").map((r) => r.id)).toEqual([
      "c",
    ]);
  });

  it("treats undefined/null as empty", () => {
    expect(getRulesForEnvironment(undefined, "production")).toEqual([]);
    expect(getRulesForEnvironment(null, "production")).toEqual([]);
  });

  it("treats a v1 Record<env, rules[]> (non-array) defensively as empty", () => {
    const v1Like = {
      production: [mk("a", { allEnvironments: true })],
    } as unknown as FeatureRule[];
    expect(getRulesForEnvironment(v1Like, "production")).toEqual([]);
  });
});

describe("toV2FeatureSnapshot", () => {
  const mkRule = (id: string, extra?: Partial<FeatureRule>): FeatureRule =>
    ({
      type: "force",
      id,
      description: "",
      value: "x",
      enabled: true,
      ...extra,
    }) as FeatureRule;

  it("passes through a v2-shaped snapshot unchanged (same reference)", () => {
    const v2: FeatureInterface = {
      ...feature,
      rules: [mkRule("r1", { allEnvironments: true, environments: [] })],
      environmentSettings: {
        production: { enabled: true },
        dev: { enabled: false },
      },
    };
    expect(toV2FeatureSnapshot(v2)).toBe(v2);
  });

  it("flattens a v1 snapshot (rules under envSettings) to v2 and strips env rules", () => {
    const v1 = {
      ...feature,
      environmentSettings: {
        production: {
          enabled: true,
          rules: [mkRule("a"), mkRule("b")],
        },
        dev: {
          enabled: false,
          rules: [mkRule("c")],
        },
      },
    } as unknown as FeatureInterface;

    const migrated = toV2FeatureSnapshot(v1);

    expect(Array.isArray(migrated.rules)).toBe(true);
    expect((migrated.rules ?? []).map((r) => r.id)).toEqual(["a", "b", "c"]);
    for (const r of migrated.rules ?? []) {
      expect(r.allEnvironments).toBe(false);
    }
    expect((migrated.rules ?? [])[0].environments).toEqual(["production"]);
    expect((migrated.rules ?? [])[2].environments).toEqual(["dev"]);

    // env settings no longer carry rules
    const envSettings = migrated.environmentSettings as Record<
      string,
      Record<string, unknown>
    >;
    expect(envSettings.production).not.toHaveProperty("rules");
    expect(envSettings.dev).not.toHaveProperty("rules");
    expect(envSettings.production.enabled).toBe(true);
    expect(envSettings.dev.enabled).toBe(false);
  });

  it("leaves snapshots without rules-in-envSettings unchanged", () => {
    const bare: FeatureInterface = {
      ...feature,
      environmentSettings: {
        production: { enabled: true },
      },
    };
    expect(toV2FeatureSnapshot(bare)).toBe(bare);
  });

  it("is idempotent", () => {
    const v1 = {
      ...feature,
      environmentSettings: {
        production: { enabled: true, rules: [mkRule("a")] },
      },
    } as unknown as FeatureInterface;
    const once = toV2FeatureSnapshot(v1);
    const twice = toV2FeatureSnapshot(once);
    expect(twice).toBe(once);
  });

  it("does not mutate the input snapshot", () => {
    const prodRules = [mkRule("a")];
    const input = {
      ...feature,
      environmentSettings: {
        production: { enabled: true, rules: prodRules },
      },
    } as unknown as FeatureInterface;
    toV2FeatureSnapshot(input);
    expect(
      (
        input.environmentSettings.production as unknown as {
          rules?: FeatureRule[];
        }
      ).rules,
    ).toBe(prodRules);
    expect(
      (input as unknown as { rules?: FeatureRule[] }).rules,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// rampActions env-gating helpers
// ---------------------------------------------------------------------------

/** Minimal RampScheduleInterface for test purposes */
function makeSchedule(
  patches: Array<{ environments?: string[]; allEnvironments?: boolean }>,
): Pick<RampScheduleInterface, "startActions" | "steps" | "endActions"> {
  return {
    startActions: [],
    steps: patches.map((patch) => ({
      interval: 86400,
      actions: [
        {
          targetType: "feature-rule" as const,
          targetId: "rule-1",
          patch: {
            ruleId: "rule-1",
            ...patch,
          },
        },
      ],
    })),
    endActions: [],
  };
}

const allEnvs = ["dev", "staging", "prod"];
// Wider env list used in tests that check specific env detection without
// triggering the "all envs affected → collapse to 'all'" shortcut.
const allEnvsWider = ["dev", "staging", "prod", "qa"];

/** Base revision with no env changes (acts as a clean live state). */
const baseRev: FeatureRevisionInterface = {
  ...baseRevision,
  rules: [
    {
      id: "rule-1",
      type: "force" as const,
      description: "",
      value: "true",
      allEnvironments: false,
      environments: ["dev", "staging"],
    },
  ],
  environmentsEnabled: {},
};

const noReviewSettings: OrganizationSettings = {
  requireReviews: [
    {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: ["prod"],
      projects: [],
    },
  ],
};

describe("getEnvsFromRampSchedule", () => {
  it("collects all environments mentioned in any step patch", () => {
    const sched = makeSchedule([
      { environments: ["dev"] },
      { environments: ["dev", "staging"] },
      { environments: ["dev", "staging", "prod"] },
    ]);
    expect(getEnvsFromRampSchedule(sched)).toEqual(
      expect.arrayContaining(["dev", "staging", "prod"]),
    );
  });

  it("returns 'all' if any patch has allEnvironments: true", () => {
    const sched = makeSchedule([
      { environments: ["dev"] },
      { allEnvironments: true },
    ]);
    expect(getEnvsFromRampSchedule(sched)).toBe("all");
  });

  it("returns empty array when no patches specify environments", () => {
    const sched = makeSchedule([{ environments: [] }, {}]);
    expect(getEnvsFromRampSchedule(sched)).toEqual([]);
  });

  it("includes patches from startActions and endActions", () => {
    const sched: Pick<
      RampScheduleInterface,
      "startActions" | "steps" | "endActions"
    > = {
      startActions: [
        {
          targetType: "feature-rule" as const,
          targetId: "rule-1",
          patch: { ruleId: "rule-1", environments: ["dev"] },
        },
      ],
      steps: [],
      endActions: [
        {
          targetType: "feature-rule" as const,
          targetId: "rule-1",
          patch: { ruleId: "rule-1", environments: ["prod"] },
        },
      ],
    };
    const result = getEnvsFromRampSchedule(sched);
    expect(result).toEqual(expect.arrayContaining(["dev", "prod"]));
  });
});

describe("getDraftAffectedEnvironments — rampActions", () => {
  /** Draft revision with a ramp CREATE action on rule-1 */
  function draftWithCreate(
    stepEnvs: Array<string[] | null>,
  ): FeatureRevisionInterface {
    return {
      ...baseRev,
      rampActions: [
        {
          mode: "create",
          ruleId: "rule-1",
          steps: stepEnvs.map((envs) => ({
            interval: 86400,
            actions: [
              {
                targetType: "feature-rule" as const,
                targetId: "rule-1",
                patch: {
                  ruleId: "rule-1",
                  ...(envs !== null ? { environments: envs } : {}),
                },
              },
            ],
          })),
        },
      ],
    };
  }

  it("create: includes rule base environments", () => {
    // rule-1 has environments: ["dev", "staging"]; ramp steps don't add envs
    const draft = draftWithCreate([["dev", "staging"]]);
    const result = getDraftAffectedEnvironments(draft, baseRev, allEnvs);
    expect(result).toEqual(expect.arrayContaining(["dev", "staging"]));
    expect(result).not.toContain("prod");
  });

  it("create: step patches that add prod are captured even when rule has no prod", () => {
    // rule starts as ["dev", "staging"]; step 2 adds prod
    const draft = draftWithCreate([
      ["dev", "staging"],
      ["dev", "staging", "prod"],
    ]);
    const result = getDraftAffectedEnvironments(draft, baseRev, allEnvsWider);
    expect(result).toEqual(expect.arrayContaining(["dev", "staging", "prod"]));
    expect(result).not.toContain("qa");
  });

  it("create: rule has no environments, step patches are the sole source", () => {
    const draftNoRuleEnvs: FeatureRevisionInterface = {
      ...baseRev,
      rules: [
        {
          id: "rule-1",
          type: "force" as const,
          description: "",
          value: "true",
          allEnvironments: false,
          environments: [],
        },
      ],
      rampActions: [
        {
          mode: "create",
          ruleId: "rule-1",
          steps: [
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: { ruleId: "rule-1", environments: ["dev"] },
                },
              ],
            },
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: { ruleId: "rule-1", environments: ["dev", "staging"] },
                },
              ],
            },
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: {
                    ruleId: "rule-1",
                    environments: ["dev", "staging", "prod"],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const result = getDraftAffectedEnvironments(
      draftNoRuleEnvs,
      baseRev,
      allEnvsWider,
    );
    expect(result).toEqual(expect.arrayContaining(["dev", "staging", "prod"]));
    expect(result).not.toContain("qa");
  });

  it("create: allEnvironments:true in a step patch returns 'all'", () => {
    const draft: FeatureRevisionInterface = {
      ...baseRev,
      rules: [
        {
          id: "rule-1",
          type: "force" as const,
          description: "",
          value: "true",
          allEnvironments: false,
          environments: [],
        },
      ],
      rampActions: [
        {
          mode: "create",
          ruleId: "rule-1",
          steps: [
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: { ruleId: "rule-1", allEnvironments: true },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(getDraftAffectedEnvironments(draft, baseRev, allEnvs)).toBe("all");
  });

  it("detach: environments come from the rule lookup in base rules", () => {
    // Rule in base has ["dev", "staging"]; draft removes it (detach)
    const draftDetach: FeatureRevisionInterface = {
      ...baseRev,
      rules: [], // rule removed from draft
      rampActions: [
        {
          mode: "detach",
          ruleId: "rule-1",
          rampScheduleId: "sched-1",
        },
      ],
    };
    const result = getDraftAffectedEnvironments(draftDetach, baseRev, allEnvs);
    expect(result).toEqual(expect.arrayContaining(["dev", "staging"]));
    expect(result).not.toContain("prod");
  });

  it("update: without liveRampScheduleEnvs only new step patches contribute", () => {
    const draft: FeatureRevisionInterface = {
      ...baseRev,
      rampActions: [
        {
          mode: "update",
          ruleId: "rule-1",
          rampScheduleId: "sched-1",
          steps: [
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: { ruleId: "rule-1", environments: ["prod"] },
                },
              ],
            },
          ],
        },
      ],
    };
    const result = getDraftAffectedEnvironments(draft, baseRev, allEnvsWider);
    // rule-1 base envs ["dev","staging"] + new step patch ["prod"]
    expect(result).toEqual(expect.arrayContaining(["dev", "staging", "prod"]));
    expect(result).not.toContain("qa");
  });

  it("update: liveRampScheduleEnvs detects environments removed from steps", () => {
    // New steps only target ["prod"]; live schedule used to target ["dev","staging","prod"]
    const draft: FeatureRevisionInterface = {
      ...baseRev,
      rules: [
        {
          id: "rule-1",
          type: "force" as const,
          description: "",
          value: "true",
          allEnvironments: false,
          environments: [], // rule has no base envs
        },
      ],
      rampActions: [
        {
          mode: "update",
          ruleId: "rule-1",
          rampScheduleId: "sched-1",
          steps: [
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: { ruleId: "rule-1", environments: ["prod"] },
                },
              ],
            },
          ],
        },
      ],
    };
    const liveRampScheduleEnvs = new Map<string, string[] | "all">([
      ["sched-1", ["dev", "staging", "prod"]],
    ]);
    const result = getDraftAffectedEnvironments(
      draft,
      baseRev,
      allEnvsWider,
      liveRampScheduleEnvs,
    );
    // "dev" and "staging" are being removed; "prod" is being kept — all three affected
    expect(result).toEqual(expect.arrayContaining(["dev", "staging", "prod"]));
    expect(result).not.toContain("qa");
  });
});

describe("checkIfRevisionNeedsReview — rampActions", () => {
  const prodGatedSettings: OrganizationSettings = {
    requireReviews: [
      {
        requireReviewOn: true,
        resetReviewOnChange: false,
        environments: ["prod"],
        projects: [],
      },
    ],
  };

  it("create ramp targeting prod requires review", () => {
    const draft: FeatureRevisionInterface = {
      ...baseRev,
      rules: [
        {
          id: "rule-1",
          type: "force" as const,
          description: "",
          value: "true",
          allEnvironments: false,
          environments: ["prod"],
        },
      ],
      rampActions: [
        {
          mode: "create",
          ruleId: "rule-1",
          steps: [
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: { ruleId: "rule-1", coverage: 0.1 },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision: baseRev,
        revision: draft,
        allEnvironments: allEnvs,
        settings: prodGatedSettings,
      }),
    ).toBe(true);
  });

  it("create ramp only targeting dev/staging does not require prod review", () => {
    const draft: FeatureRevisionInterface = {
      ...baseRev,
      rampActions: [
        {
          mode: "create",
          ruleId: "rule-1",
          steps: [
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: { ruleId: "rule-1", environments: ["dev", "staging"] },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision: baseRev,
        revision: draft,
        allEnvironments: allEnvs,
        settings: prodGatedSettings,
      }),
    ).toBe(false);
  });

  it("step patch widening to prod mid-ramp requires review", () => {
    // Rule starts on dev/staging; a later step patch adds prod
    const draft: FeatureRevisionInterface = {
      ...baseRev,
      rules: [
        {
          id: "rule-1",
          type: "force" as const,
          description: "",
          value: "true",
          allEnvironments: false,
          environments: [],
        },
      ],
      rampActions: [
        {
          mode: "create",
          ruleId: "rule-1",
          steps: [
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: { ruleId: "rule-1", environments: ["dev", "staging"] },
                },
              ],
            },
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: {
                    ruleId: "rule-1",
                    environments: ["dev", "staging", "prod"],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision: baseRev,
        revision: draft,
        allEnvironments: allEnvs,
        settings: prodGatedSettings,
      }),
    ).toBe(true);
  });

  it("update that removes prod from steps still requires review when liveRampScheduleEnvs provided", () => {
    const draftRemovesProd: FeatureRevisionInterface = {
      ...baseRev,
      rules: [
        {
          id: "rule-1",
          type: "force" as const,
          description: "",
          value: "true",
          allEnvironments: false,
          environments: [],
        },
      ],
      rampActions: [
        {
          mode: "update",
          ruleId: "rule-1",
          rampScheduleId: "sched-1",
          steps: [
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: { ruleId: "rule-1", environments: ["dev", "staging"] },
                },
              ],
            },
          ],
        },
      ],
    };
    const liveRampScheduleEnvs = new Map<string, string[] | "all">([
      ["sched-1", ["dev", "staging", "prod"]],
    ]);
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision: baseRev,
        revision: draftRemovesProd,
        allEnvironments: allEnvs,
        settings: prodGatedSettings,
        liveRampScheduleEnvs,
      }),
    ).toBe(true);
  });

  it("update that removes prod from steps bypasses review WITHOUT liveRampScheduleEnvs (known gap, documented)", () => {
    // This is the partial coverage case: without live schedule data, we can't
    // detect removed environments when the rule itself has no base envs.
    const draftRemovesProd: FeatureRevisionInterface = {
      ...baseRev,
      rules: [
        {
          id: "rule-1",
          type: "force" as const,
          description: "",
          value: "true",
          allEnvironments: false,
          environments: [],
        },
      ],
      rampActions: [
        {
          mode: "update",
          ruleId: "rule-1",
          rampScheduleId: "sched-1",
          steps: [
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule" as const,
                  targetId: "rule-1",
                  patch: { ruleId: "rule-1", environments: ["dev", "staging"] },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision: baseRev,
        revision: draftRemovesProd,
        allEnvironments: allEnvs,
        settings: prodGatedSettings,
        // no liveRampScheduleEnvs
      }),
    ).toBe(false);
  });

  it("detach from a prod rule requires review", () => {
    const draftDetach: FeatureRevisionInterface = {
      ...baseRev,
      rules: [
        {
          id: "rule-1",
          type: "force" as const,
          description: "",
          value: "true",
          allEnvironments: false,
          environments: ["prod"],
        },
      ],
      rampActions: [
        {
          mode: "detach",
          ruleId: "rule-1",
          rampScheduleId: "sched-1",
        },
      ],
    };
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision: baseRev,
        revision: draftDetach,
        allEnvironments: allEnvs,
        settings: prodGatedSettings,
      }),
    ).toBe(true);
  });

  it("revision with no rampActions and no other changes does not require review", () => {
    expect(
      checkIfRevisionNeedsReview({
        feature,
        baseRevision: baseRev,
        revision: { ...baseRev },
        allEnvironments: allEnvs,
        settings: noReviewSettings,
      }),
    ).toBe(false);
  });
});

describe("pruneOrphanedRampActions", () => {
  const rule = (id: string): FeatureRule => ({
    id,
    type: "force",
    value: "true",
    description: "",
    environments: ["production"],
  });

  it("keeps actions whose target rule survived the merge", () => {
    const actions = [
      { mode: "create" as const, ruleId: "a" },
      { mode: "detach" as const, ruleId: "b" },
    ];
    const { kept, pruned } = pruneOrphanedRampActions(actions, [
      rule("a"),
      rule("b"),
    ]);
    expect(kept).toEqual(actions);
    expect(pruned).toEqual([]);
  });

  it("prunes actions whose target rule no longer exists", () => {
    const actions = [
      { mode: "create" as const, ruleId: "a" },
      { mode: "update" as const, ruleId: "gone" },
      { mode: "detach" as const, ruleId: "also-gone" },
    ];
    const { kept, pruned } = pruneOrphanedRampActions(actions, [rule("a")]);
    expect(kept).toEqual([{ mode: "create", ruleId: "a" }]);
    expect(pruned).toEqual([
      { mode: "update", ruleId: "gone" },
      { mode: "detach", ruleId: "also-gone" },
    ]);
  });

  it("keeps actions without a rule reference", () => {
    const actions = [{ mode: "create" as const, ruleId: undefined }];
    const { kept, pruned } = pruneOrphanedRampActions(actions, []);
    expect(kept).toEqual(actions);
    expect(pruned).toEqual([]);
  });

  it("handles undefined rampActions", () => {
    const { kept, pruned } = pruneOrphanedRampActions(undefined, [rule("a")]);
    expect(kept).toEqual([]);
    expect(pruned).toEqual([]);
  });
});

describe("sparse JSON rule helpers", () => {
  describe("parsePlainJSONObject", () => {
    it("returns the object for a plain key/val object", () => {
      expect(parsePlainJSONObject('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
    });
    it("returns null for arrays", () => {
      expect(parsePlainJSONObject("[1,2,3]")).toBeNull();
    });
    it("returns null for null", () => {
      expect(parsePlainJSONObject("null")).toBeNull();
    });
    it("returns null for primitives", () => {
      expect(parsePlainJSONObject("42")).toBeNull();
      expect(parsePlainJSONObject('"hi"')).toBeNull();
    });
    it("returns null for unparseable input", () => {
      expect(parsePlainJSONObject("not json")).toBeNull();
    });
  });

  describe("resolveSparseJSONValue", () => {
    const defaultObj = { a: "default", b: 1, c: true };

    it("merges the sparse value onto the default object", () => {
      expect(resolveSparseJSONValue('{"a":"over"}', defaultObj)).toEqual({
        a: "over",
        b: 1,
        c: true,
      });
    });

    it("adds keys not present in the default (no schema filtering for json)", () => {
      expect(resolveSparseJSONValue('{"d":"new"}', defaultObj)).toEqual({
        a: "default",
        b: 1,
        c: true,
        d: "new",
      });
    });

    it("replaces nested objects wholesale (top-level merge, not deep merge)", () => {
      // A nested object in the patch overwrites the default's entire object for
      // that key — keys only present in the default's nested object are dropped.
      expect(
        resolveSparseJSONValue('{"theme":{"primary":"green"}}', {
          theme: { primary: "blue", secondary: "red" },
          other: 1,
        }),
      ).toEqual({
        theme: { primary: "green" },
        other: 1,
      });
    });

    it("returns the parsed value as-is when the default isn't an object", () => {
      expect(resolveSparseJSONValue('{"a":"over"}', null)).toEqual({
        a: "over",
      });
    });

    it("returns the parsed value as-is when the rule value isn't an object", () => {
      // Misconfigured sparse flag degrades to full-value behavior.
      expect(resolveSparseJSONValue("[1,2]", defaultObj)).toEqual([1, 2]);
      expect(resolveSparseJSONValue("42", defaultObj)).toEqual(42);
    });

    it("returns null when the rule value is unparseable and there's no object default", () => {
      expect(resolveSparseJSONValue("not json", null)).toBeNull();
    });
  });

  describe("stripDefaultsForSparse", () => {
    const def = JSON.stringify({ a: "x", b: { n: 1 }, c: [1, 2] });

    it("drops keys equal to the default (full default → clean slate)", () => {
      expect(JSON.parse(stripDefaultsForSparse(def, def))).toEqual({});
    });

    it("keeps changed and added keys, order-insensitive on nested values", () => {
      expect(
        JSON.parse(
          stripDefaultsForSparse(
            // b is deep-equal (key order flipped), so it's dropped; a changed, d added
            JSON.stringify({ a: "y", b: { n: 1 }, d: true }),
            def,
          ),
        ),
      ).toEqual({ a: "y", d: true });
    });

    it("treats a nested object as changed when it differs", () => {
      expect(
        JSON.parse(
          stripDefaultsForSparse(JSON.stringify({ b: { n: 2 } }), def),
        ),
      ).toEqual({ b: { n: 2 } });
    });

    it("returns the input unchanged when either side isn't a plain object", () => {
      expect(stripDefaultsForSparse("[1,2]", def)).toBe("[1,2]");
      expect(stripDefaultsForSparse('{"a":"x"}', "not json")).toBe('{"a":"x"}');
    });

    it("keeps only $extends refs not already in the default", () => {
      expect(
        JSON.parse(
          stripDefaultsForSparse(
            JSON.stringify({ $extends: ["@const:foo", "@const:bar"], b: 2 }),
            JSON.stringify({ $extends: ["@const:foo"], a: 1 }),
          ),
        ),
      ).toEqual({ $extends: ["@const:bar"], b: 2 });
    });

    it("drops $extends entirely when identical to the default's", () => {
      expect(
        JSON.parse(
          stripDefaultsForSparse(
            JSON.stringify({ $extends: ["@const:foo"], a: 1 }),
            JSON.stringify({ $extends: ["@const:foo"], a: 1 }),
          ),
        ),
      ).toEqual({});
    });
  });

  describe("expandSparseToFull", () => {
    const def = JSON.stringify({ a: "x", b: 1 });

    it("merges the patch onto the default (top-level)", () => {
      expect(
        JSON.parse(expandSparseToFull(JSON.stringify({ a: "y" }), def)),
      ).toEqual({ a: "y", b: 1 });
    });

    it("round-trips with stripDefaultsForSparse", () => {
      const full = JSON.stringify({ a: "y", b: 1 });
      const patch = stripDefaultsForSparse(full, def);
      expect(JSON.parse(patch)).toEqual({ a: "y" });
      expect(JSON.parse(expandSparseToFull(patch, def))).toEqual({
        a: "y",
        b: 1,
      });
    });

    it("returns the input unchanged when either side isn't a plain object", () => {
      expect(expandSparseToFull("[1,2]", def)).toBe("[1,2]");
    });

    it("unions $extends refs instead of clobbering the default's", () => {
      expect(
        JSON.parse(
          expandSparseToFull(
            JSON.stringify({ $extends: ["@const:bar"], b: 2 }),
            JSON.stringify({ $extends: ["@const:foo"], a: 1 }),
          ),
        ),
      ).toEqual({ $extends: ["@const:foo", "@const:bar"], a: 1, b: 2 });
    });

    it("round-trips $extends with stripDefaultsForSparse", () => {
      const def2 = JSON.stringify({ $extends: ["@const:foo"], a: 1 });
      const full = JSON.stringify({
        $extends: ["@const:foo", "@const:bar"],
        a: 1,
        b: 2,
      });
      const patch = stripDefaultsForSparse(full, def2);
      expect(JSON.parse(patch)).toEqual({ $extends: ["@const:bar"], b: 2 });
      expect(JSON.parse(expandSparseToFull(patch, def2))).toEqual({
        $extends: ["@const:foo", "@const:bar"],
        a: 1,
        b: 2,
      });
    });

    it("preserves an inline-object $extends entry through a round-trip", () => {
      // Inline objects are positional, so the toggle keeps the $extends array
      // verbatim rather than ref-diffing it.
      const def2 = JSON.stringify({ $extends: ["@const:foo"], a: 1 });
      const full = JSON.stringify({
        $extends: ["@const:foo", { b: 2 }],
        a: 1,
        c: 3,
      });
      const patch = stripDefaultsForSparse(full, def2);
      // $extends kept verbatim; own keys still diffed (a stripped, c kept)
      expect(JSON.parse(patch)).toEqual({
        $extends: ["@const:foo", { b: 2 }],
        c: 3,
      });
      expect(JSON.parse(expandSparseToFull(patch, def2))).toEqual(
        JSON.parse(full),
      );
    });
  });
});

describe("draftHasChangesOutsideTargetRef", () => {
  const makeRev = (overrides: Partial<RevisionFields>): RevisionFields => ({
    defaultValue: "control",
    rules: {},
    version: 1,
    environmentsEnabled: { production: true },
    prerequisites: [],
    archived: false,
    metadata: {},
    holdout: null,
    rampActions: [],
    ...overrides,
  });

  const targetRule = {
    id: "tr_1",
    type: "contextual-bandit-ref",
    contextualBanditId: "cb_1",
    description: "",
    enabled: true,
  } as unknown as FeatureRule;

  const isTarget = (rule: FeatureRule): boolean =>
    rule.type === "contextual-bandit-ref" &&
    (rule as unknown as { contextualBanditId?: string }).contextualBanditId ===
      "cb_1";

  it("returns false when the draft only adds the target ref rule", () => {
    const live = makeRev({ rules: { production: [] } });
    const draft = makeRev({ rules: { production: [targetRule] } });
    expect(draftHasChangesOutsideTargetRef(draft, live, isTarget)).toBe(false);
  });

  it("returns false when live and draft are identical", () => {
    const live = makeRev({ rules: { production: [targetRule] } });
    const draft = makeRev({ rules: { production: [targetRule] } });
    expect(draftHasChangesOutsideTargetRef(draft, live, isTarget)).toBe(false);
  });

  it("returns true when defaultValue changes alongside the target ref", () => {
    const live = makeRev({
      defaultValue: "control",
      rules: { production: [] },
    });
    const draft = makeRev({
      defaultValue: "treatment",
      rules: { production: [targetRule] },
    });
    expect(draftHasChangesOutsideTargetRef(draft, live, isTarget)).toBe(true);
  });

  it("returns true when a non-target rule is added", () => {
    const otherRule = {
      id: "fr_1",
      type: "force",
      description: "",
      enabled: true,
      value: "treatment",
    } as unknown as FeatureRule;
    const live = makeRev({ rules: { production: [] } });
    const draft = makeRev({
      rules: { production: [targetRule, otherRule] },
    });
    expect(draftHasChangesOutsideTargetRef(draft, live, isTarget)).toBe(true);
  });

  it("ignores a different ref id (only the matched target is stripped)", () => {
    const otherCbRule = {
      id: "tr_2",
      type: "contextual-bandit-ref",
      contextualBanditId: "cb_2",
      description: "",
      enabled: true,
    } as unknown as FeatureRule;
    const live = makeRev({ rules: { production: [otherCbRule] } });
    const draft = makeRev({
      rules: { production: [otherCbRule, targetRule] },
    });
    expect(draftHasChangesOutsideTargetRef(draft, live, isTarget)).toBe(false);
  });

  it("returns true when prerequisites change", () => {
    const live = makeRev({ rules: { production: [targetRule] } });
    const draft = makeRev({
      rules: { production: [targetRule] },
      prerequisites: [{ id: "feat_x", condition: '{"value": true}' }],
    });
    expect(draftHasChangesOutsideTargetRef(draft, live, isTarget)).toBe(true);
  });
});
