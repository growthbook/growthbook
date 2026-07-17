import type {
  ApprovalFlowConfigurations,
  OrganizationSettings,
} from "../../../types/organization";
import type { TeamInterface } from "../../../types/team";
import {
  getRevisionKey,
  canUserReviewEntity,
  checkMergeConflicts,
  normalizeProposedChanges,
  applyTopLevelPatchOps,
  patchOpsToPartial,
  getApprovalFlowSettings,
  isUserBlockedFromApproving,
  isAutopublishOnApprovalEnabled,
  isSavedGroupRevisionMetadataOnly,
  isConstantRevisionMetadataOnly,
} from "../../../src/revisions/helpers";
import type {
  RevisionTargetType,
  Revision,
  JsonPatchOperation,
} from "../../../src/enterprise/validators/revisions";

// Helper to create a mock revision
const createRevision = (overrides: Partial<Revision> = {}): Revision =>
  ({
    id: "rev-1",
    target: {
      type: "saved-group" as const,
      id: "sg-1",
      snapshot: {} as Record<string, unknown>,
      proposedChanges: [] as JsonPatchOperation[],
    },
    status: "pending-review",
    authorId: "author-1",
    reviews: [],
    activityLog: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: "org-1",
    ...overrides,
  }) as Revision;

describe("revisions helpers", () => {
  describe("getRevisionKey", () => {
    it("maps saved-group to saved-groups", () => {
      expect(getRevisionKey("saved-group")).toBe("saved-groups");
    });
    it("returns null for unsupported type", () => {
      expect(getRevisionKey("unknown" as RevisionTargetType)).toBeNull();
    });
  });

  describe("canUserReviewEntity - saved-group", () => {
    const baseRevision = createRevision({
      authorId: "user-author",
    });

    it("returns true when user can edit and is not the author", () => {
      expect(
        canUserReviewEntity({
          entityType: "saved-group",
          revision: baseRevision,
          entity: {},
          approvalFlowSettings: { savedGroups: [{ required: true }] },
          userId: "user-reviewer",
          canEditEntity: true,
        }),
      ).toBe(true);
    });

    it("returns false when user is the author", () => {
      expect(
        canUserReviewEntity({
          entityType: "saved-group",
          revision: baseRevision,
          entity: {},
          approvalFlowSettings: { savedGroups: [{ required: true }] },
          userId: "user-author",
          canEditEntity: true,
        }),
      ).toBe(false);
    });

    it("returns false when user cannot edit", () => {
      expect(
        canUserReviewEntity({
          entityType: "saved-group",
          revision: baseRevision,
          entity: {},
          approvalFlowSettings: { savedGroups: [{ required: true }] },
          userId: "user-reviewer",
          canEditEntity: false,
        }),
      ).toBe(false);
    });

    it("returns false when revision is already merged", () => {
      const mergedFlow = createRevision({
        authorId: "user-author",
        status: "merged",
      });
      expect(
        canUserReviewEntity({
          entityType: "saved-group",
          revision: mergedFlow,
          entity: {},
          approvalFlowSettings: { savedGroups: [{ required: true }] },
          userId: "user-reviewer",
          canEditEntity: true,
        }),
      ).toBe(false);
    });

    it("returns false when revision is discarded", () => {
      const discardedFlow = createRevision({
        authorId: "user-author",
        status: "discarded",
      });
      expect(
        canUserReviewEntity({
          entityType: "saved-group",
          revision: discardedFlow,
          entity: {},
          approvalFlowSettings: { savedGroups: [{ required: true }] },
          userId: "user-reviewer",
          canEditEntity: true,
        }),
      ).toBe(false);
    });

    it("returns true when approvalFlowSettings is undefined", () => {
      expect(
        canUserReviewEntity({
          entityType: "saved-group",
          revision: baseRevision,
          entity: {},
          approvalFlowSettings:
            undefined as unknown as ApprovalFlowConfigurations,
          userId: "user-reviewer",
          canEditEntity: true,
        }),
      ).toBe(true);
    });
  });

  describe("checkMergeConflicts", () => {
    it("returns success when there are no conflicts", () => {
      const base = { name: "old", value: 1 };
      const live = { name: "old", value: 1 };
      const proposed: JsonPatchOperation[] = [
        { op: "replace", path: "/name", value: "new" },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);
      expect(result.canAutoMerge).toBe(true);
      expect(result.mergedChanges).toEqual({ name: "new", value: 1 });
    });

    it("detects conflicts when base, live, and proposed all differ", () => {
      const base = { name: "old" };
      const live = { name: "live-change" };
      const proposed: JsonPatchOperation[] = [
        { op: "replace", path: "/name", value: "proposed-change" },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].field).toBe("name");
      expect(result.canAutoMerge).toBe(false);
    });

    it("ignores ops for fields outside the updatable allowlist", () => {
      // A field the merge can't write can't truly conflict. This is exactly the
      // legacy-config `scopedOverrides` case: the field is no longer
      // revision-controlled (excluded from the snapshot, so base is undefined)
      // but an old draft still carries a stale op for it. Without the allowlist
      // it renders a phantom `undefined -> [...]` conflict on every rebase.
      const base = {}; // snapshot excludes scopedOverrides -> undefined
      const live = { scopedOverrides: [{ config: "flavor_dev_live" }] };
      const proposed: JsonPatchOperation[] = [
        {
          op: "replace",
          path: "/scopedOverrides",
          value: [{ config: "flavor_dev_draft" }],
        },
      ];
      // No allowlist -> the pre-fix behavior: phantom conflict.
      expect(checkMergeConflicts(base, live, proposed).success).toBe(false);
      // With the allowlist (scopedOverrides not updatable) -> no conflict.
      const result = checkMergeConflicts(
        base,
        live,
        proposed,
        new Set(["value", "name"]),
      );
      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it("still detects a conflict on an allowlisted field", () => {
      const base = { value: "old" };
      const live = { value: "live-change" };
      const proposed: JsonPatchOperation[] = [
        { op: "replace", path: "/value", value: "proposed-change" },
      ];
      const result = checkMergeConflicts(
        base,
        live,
        proposed,
        new Set(["value"]),
      );
      expect(result.success).toBe(false);
      expect(result.conflicts[0].field).toBe("value");
    });

    it("no conflict when live and proposed changed to the same value", () => {
      const base = { name: "old" };
      const live = { name: "same-new" };
      const proposed: JsonPatchOperation[] = [
        { op: "replace", path: "/name", value: "same-new" },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it("merges non-overlapping changes", () => {
      const base = { name: "old", color: "red" };
      const live = { name: "old", color: "blue" };
      const proposed: JsonPatchOperation[] = [
        { op: "replace", path: "/name", value: "new" },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.mergedChanges).toEqual({ name: "new", color: "blue" });
    });

    it("handles array values", () => {
      const base = { values: ["a", "b"] };
      const live = { values: ["a", "b", "c"] };
      const proposed: JsonPatchOperation[] = [
        { op: "replace", path: "/values", value: ["a", "d"] },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(false);
      expect(result.conflicts[0].field).toBe("values");
    });

    it("returns no conflict when proposed matches base (no real change)", () => {
      const base = { name: "same" };
      const live = { name: "same" };
      const proposed: JsonPatchOperation[] = [
        { op: "replace", path: "/name", value: "same" },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.fieldsChanged).toHaveLength(0);
    });

    it("treats add ops the same as replace ops", () => {
      const base = { name: "old" };
      const live = { name: "old" };
      const proposed: JsonPatchOperation[] = [
        { op: "add", path: "/description", value: "new desc" },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.fieldsChanged).toEqual(["description"]);
      expect(result.mergedChanges).toEqual({
        name: "old",
        description: "new desc",
      });
    });

    it("treats remove ops as setting field to undefined", () => {
      const base = { name: "old", description: "to-remove" };
      const live = { name: "old", description: "to-remove" };
      const proposed: JsonPatchOperation[] = [
        { op: "remove", path: "/description" },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      // remove sets the proposed value to undefined; hasChanged sees val1==null and bails,
      // so it ends up as "no change" (a quirky but documented behaviour)
      expect(result.success).toBe(true);
    });

    it("uses last-write-wins when multiple ops target the same field", () => {
      const base = { name: "old" };
      const live = { name: "old" };
      const proposed: JsonPatchOperation[] = [
        { op: "replace", path: "/name", value: "first" },
        { op: "replace", path: "/name", value: "winner" },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.mergedChanges).toEqual({ name: "winner" });
    });

    it("collects multiple conflicts across multiple fields", () => {
      const base = { name: "n0", color: "c0" };
      const live = { name: "n-live", color: "c-live" };
      const proposed: JsonPatchOperation[] = [
        { op: "replace", path: "/name", value: "n-prop" },
        { op: "replace", path: "/color", value: "c-prop" },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(false);
      expect(result.conflicts.map((c) => c.field).sort()).toEqual([
        "color",
        "name",
      ]);
      expect(result.canAutoMerge).toBe(false);
      expect(result.mergedChanges).toBeUndefined();
    });

    it("ignores nested paths when grouping by top-level field", () => {
      const base = { values: ["a", "b"] };
      const live = { values: ["a", "b"] };
      // Nested path /values/0 — top-level field is still "values"
      const proposed: JsonPatchOperation[] = [
        { op: "replace", path: "/values/0", value: "z" },
      ];
      const result = checkMergeConflicts(base, live, proposed);
      // proposedValue for "values" becomes "z" (not the array), differs from base — counted as change
      expect(result.fieldsChanged).toContain("values");
    });

    it("ignores legacy plain-object proposedChanges (treats as empty)", () => {
      const base = { name: "old" };
      const live = { name: "live" };
      // Legacy DB documents stored a plain object instead of an array.
      // checkMergeConflicts uses normalizeProposedChanges → empty.
      const proposed = { name: "new" } as unknown as JsonPatchOperation[];
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.fieldsChanged).toHaveLength(0);
      expect(result.mergedChanges).toEqual(live);
    });
  });

  describe("normalizeProposedChanges", () => {
    it("returns the array unchanged when given an array", () => {
      const ops: JsonPatchOperation[] = [
        { op: "replace", path: "/a", value: 1 },
      ];
      expect(normalizeProposedChanges(ops)).toBe(ops);
    });

    it("returns an empty array for null/undefined", () => {
      expect(normalizeProposedChanges(null)).toEqual([]);
      expect(normalizeProposedChanges(undefined)).toEqual([]);
    });

    it("returns an empty array for plain-object legacy values", () => {
      expect(normalizeProposedChanges({ name: "x" })).toEqual([]);
    });

    it("returns an empty array for primitives", () => {
      expect(normalizeProposedChanges("string")).toEqual([]);
      expect(normalizeProposedChanges(123)).toEqual([]);
    });
  });

  describe("applyTopLevelPatchOps", () => {
    it("returns the snapshot unchanged when no ops", () => {
      const snap = { a: 1, b: 2 };
      expect(applyTopLevelPatchOps(snap, [])).toBe(snap);
    });

    it("applies replace and add ops", () => {
      const snap = { a: 1, b: 2 };
      const result = applyTopLevelPatchOps(snap, [
        { op: "replace", path: "/a", value: 99 },
        { op: "add", path: "/c", value: 3 },
      ]);
      expect(result).toEqual({ a: 99, b: 2, c: 3 });
    });

    it("applies remove ops", () => {
      const snap = { a: 1, b: 2 };
      const result = applyTopLevelPatchOps(snap, [
        { op: "remove", path: "/b" },
      ]);
      expect(result).toEqual({ a: 1 });
    });

    it("does not mutate the original snapshot", () => {
      const snap = { a: 1 };
      applyTopLevelPatchOps(snap, [{ op: "replace", path: "/a", value: 2 }]);
      expect(snap).toEqual({ a: 1 });
    });

    it("ignores nested paths", () => {
      const snap = { values: ["a", "b"] };
      const result = applyTopLevelPatchOps(snap, [
        { op: "replace", path: "/values/0", value: "z" },
      ]);
      expect(result).toEqual({ values: ["a", "b"] });
    });

    it("ignores ops with empty top-level field", () => {
      const snap = { a: 1 };
      const result = applyTopLevelPatchOps(snap, [
        { op: "replace", path: "/", value: "x" },
      ]);
      expect(result).toEqual({ a: 1 });
    });

    it("returns snapshot unchanged for legacy plain-object input", () => {
      const snap = { a: 1 };
      const result = applyTopLevelPatchOps(snap, {
        a: 99,
      } as unknown as JsonPatchOperation[]);
      expect(result).toBe(snap);
    });
  });

  describe("patchOpsToPartial", () => {
    it("converts replace and add ops to a partial object", () => {
      const ops: JsonPatchOperation[] = [
        { op: "replace", path: "/name", value: "x" },
        { op: "add", path: "/desc", value: "d" },
      ];
      expect(patchOpsToPartial(ops)).toEqual({ name: "x", desc: "d" });
    });

    it("converts remove ops to undefined fields", () => {
      const ops: JsonPatchOperation[] = [{ op: "remove", path: "/name" }];
      expect(patchOpsToPartial(ops)).toEqual({ name: undefined });
    });

    it("returns the legacy plain object unchanged", () => {
      const legacy = { name: "x", desc: "d" };
      expect(patchOpsToPartial(legacy as unknown as JsonPatchOperation[])).toBe(
        legacy,
      );
    });

    it("ignores nested paths", () => {
      const ops: JsonPatchOperation[] = [
        { op: "replace", path: "/values/0", value: "z" },
      ];
      expect(patchOpsToPartial(ops)).toEqual({});
    });

    it("returns empty object for null/undefined and arrays", () => {
      // null is also an "object" in JS — function should treat it as empty
      expect(
        patchOpsToPartial(null as unknown as JsonPatchOperation[]),
      ).toEqual({});
      expect(patchOpsToPartial([])).toEqual({});
    });
  });

  describe("canUserReviewEntity - non-saved-group entity types", () => {
    // We simulate a hypothetical future entity type to exercise the
    // managedBy team/admin code paths. Cast to the union as needed.
    const otherType = "feature" as unknown as RevisionTargetType;

    const teamMember: TeamInterface = {
      id: "team-1",
      organization: "org-1",
      createdBy: "creator-1",
      name: "Team A",
      members: ["user-reviewer"],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "",
      role: "engineer",
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [],
      managedByIdp: false,
    };

    it("managedBy=team: allows team member reviewer", () => {
      const result = canUserReviewEntity({
        entityType: otherType,
        revision: createRevision({ authorId: "author-1" }),
        entity: { managedBy: "team", ownerTeam: "team-1" },
        approvalFlowSettings: {} as ApprovalFlowConfigurations,
        userId: "user-reviewer",
        teams: [teamMember],
      });
      expect(result).toBe(true);
    });

    it("managedBy=team: rejects non-team-member reviewer", () => {
      const result = canUserReviewEntity({
        entityType: otherType,
        revision: createRevision({ authorId: "author-1" }),
        entity: { managedBy: "team", ownerTeam: "team-1" },
        approvalFlowSettings: {} as ApprovalFlowConfigurations,
        userId: "stranger",
        teams: [teamMember],
      });
      expect(result).toBe(false);
    });

    it("managedBy=team: rejects when no ownerTeam set", () => {
      const result = canUserReviewEntity({
        entityType: otherType,
        revision: createRevision({ authorId: "author-1" }),
        entity: { managedBy: "team" },
        approvalFlowSettings: {} as ApprovalFlowConfigurations,
        userId: "user-reviewer",
        teams: [teamMember],
      });
      expect(result).toBe(false);
    });

    it("managedBy=admin: allows reviewer with manageOfficialResources permission", () => {
      const result = canUserReviewEntity({
        entityType: otherType,
        revision: createRevision({ authorId: "author-1" }),
        entity: { managedBy: "admin" },
        approvalFlowSettings: {} as ApprovalFlowConfigurations,
        userId: "user-reviewer",
        userPermissions: { manageOfficialResources: true },
      });
      expect(result).toBe(true);
    });

    it("managedBy=admin: rejects reviewer without manageOfficialResources", () => {
      const result = canUserReviewEntity({
        entityType: otherType,
        revision: createRevision({ authorId: "author-1" }),
        entity: { managedBy: "admin" },
        approvalFlowSettings: {} as ApprovalFlowConfigurations,
        userId: "user-reviewer",
        userPermissions: { manageOfficialResources: false },
      });
      expect(result).toBe(false);
    });

    it("managedBy=admin: still rejects the author even if they have permission", () => {
      const result = canUserReviewEntity({
        entityType: otherType,
        revision: createRevision({ authorId: "user-reviewer" }),
        entity: { managedBy: "admin" },
        approvalFlowSettings: {} as ApprovalFlowConfigurations,
        userId: "user-reviewer",
        userPermissions: { manageOfficialResources: true },
      });
      expect(result).toBe(false);
    });

    it("returns false when managedBy is unset", () => {
      const result = canUserReviewEntity({
        entityType: otherType,
        revision: createRevision({ authorId: "author-1" }),
        entity: {},
        approvalFlowSettings: {} as ApprovalFlowConfigurations,
        userId: "user-reviewer",
      });
      expect(result).toBe(false);
    });

    it("uses the latest proposed managedBy value when resolving review eligibility", () => {
      const revision = createRevision({
        authorId: "author-1",
        target: {
          type: "saved-group" as const,
          id: "sg-1",
          snapshot: {} as Record<string, unknown>,
          proposedChanges: [
            { op: "replace", path: "/managedBy", value: "admin" },
          ] as JsonPatchOperation[],
        },
      });
      // Live entity says team — but the revision proposes "admin",
      // so the admin path should be used.
      const result = canUserReviewEntity({
        entityType: otherType,
        revision,
        entity: { managedBy: "team", ownerTeam: "team-1" },
        approvalFlowSettings: {} as ApprovalFlowConfigurations,
        userId: "user-reviewer",
        userPermissions: { manageOfficialResources: true },
      });
      expect(result).toBe(true);
    });

    it("uses the latest proposed ownerTeam value when resolving review eligibility", () => {
      const revision = createRevision({
        authorId: "author-1",
        target: {
          type: "saved-group" as const,
          id: "sg-1",
          snapshot: {} as Record<string, unknown>,
          proposedChanges: [
            { op: "replace", path: "/ownerTeam", value: "team-1" },
          ] as JsonPatchOperation[],
        },
      });
      const result = canUserReviewEntity({
        entityType: otherType,
        revision,
        entity: { managedBy: "team" }, // no ownerTeam on live entity
        approvalFlowSettings: {} as ApprovalFlowConfigurations,
        userId: "user-reviewer",
        teams: [teamMember],
      });
      expect(result).toBe(true);
    });
  });

  describe("getApprovalFlowSettings", () => {
    it("returns undefined when approvalFlows is undefined", () => {
      expect(getApprovalFlowSettings(undefined, "saved-group")).toBeUndefined();
    });

    it("returns the first savedGroups config for saved-group entityType", () => {
      const cfg = {
        savedGroups: [
          {
            required: true,
            requireMetadataReview: false,
            blockSelfApproval: true,
          },
        ],
      } as ApprovalFlowConfigurations;
      expect(getApprovalFlowSettings(cfg, "saved-group")).toEqual(
        cfg.savedGroups[0],
      );
    });

    it("returns undefined for unknown entityType", () => {
      const cfg = {
        savedGroups: [{ required: true, requireMetadataReview: false }],
      } as ApprovalFlowConfigurations;
      expect(
        getApprovalFlowSettings(cfg, "unknown" as RevisionTargetType),
      ).toBeUndefined();
    });
  });

  describe("isUserBlockedFromApproving", () => {
    const sgSettings = (blockSelfApproval: boolean) =>
      ({
        approvalFlows: {
          savedGroups: [
            { required: true, requireMetadataReview: false, blockSelfApproval },
          ],
        },
      }) as OrganizationSettings;

    const baseRevision = createRevision({
      authorId: "author-1",
      contributors: ["author-1", "user-2"],
    });

    it("returns false when blockSelfApproval is not enabled", () => {
      expect(
        isUserBlockedFromApproving({
          settings: sgSettings(false),
          entityType: "saved-group",
          revision: baseRevision,
          userId: "user-2",
        }),
      ).toBe(false);
    });

    it("returns true when user is in contributors and blockSelfApproval is on", () => {
      expect(
        isUserBlockedFromApproving({
          settings: sgSettings(true),
          entityType: "saved-group",
          revision: baseRevision,
          userId: "user-2",
        }),
      ).toBe(true);
    });

    it("returns true for the author when blockSelfApproval is on", () => {
      expect(
        isUserBlockedFromApproving({
          settings: sgSettings(true),
          entityType: "saved-group",
          revision: baseRevision,
          userId: "author-1",
        }),
      ).toBe(true);
    });

    it("returns false for a non-contributor reviewer", () => {
      expect(
        isUserBlockedFromApproving({
          settings: sgSettings(true),
          entityType: "saved-group",
          revision: baseRevision,
          userId: "user-3",
        }),
      ).toBe(false);
    });

    it("falls back to [authorId] for legacy revisions with no contributors field", () => {
      const legacy = createRevision({
        authorId: "author-1",
        contributors: undefined,
      });
      expect(
        isUserBlockedFromApproving({
          settings: sgSettings(true),
          entityType: "saved-group",
          revision: legacy,
          userId: "author-1",
        }),
      ).toBe(true);
      expect(
        isUserBlockedFromApproving({
          settings: sgSettings(true),
          entityType: "saved-group",
          revision: legacy,
          userId: "user-2",
        }),
      ).toBe(false);
    });

    it("returns false when settings is undefined", () => {
      expect(
        isUserBlockedFromApproving({
          settings: undefined,
          entityType: "saved-group",
          revision: baseRevision,
          userId: "author-1",
        }),
      ).toBe(false);
    });

    it("reads blockSelfApproval from requireReviews for constants", () => {
      const constantRevision = createRevision({
        authorId: "author-1",
        contributors: ["author-1", "user-2"],
        target: {
          type: "constant",
          id: "const-1",
          snapshot: { project: "prj_a" } as Record<string, unknown>,
          proposedChanges: [],
        },
      });
      const settings = (blockSelfApproval: boolean) =>
        ({
          requireReviews: [
            {
              requireReviewOn: true,
              blockSelfApproval,
              projects: [],
              environments: [],
            },
          ],
        }) as unknown as OrganizationSettings;
      expect(
        isUserBlockedFromApproving({
          settings: settings(true),
          entityType: "constant",
          revision: constantRevision,
          userId: "user-2",
        }),
      ).toBe(true);
      expect(
        isUserBlockedFromApproving({
          settings: settings(false),
          entityType: "constant",
          revision: constantRevision,
          userId: "user-2",
        }),
      ).toBe(false);
    });
  });

  describe("isAutopublishOnApprovalEnabled", () => {
    const sgSettings = (autopublishOnApproval?: boolean) =>
      ({
        approvalFlows: {
          savedGroups: [
            {
              required: true,
              requireMetadataReview: false,
              autopublishOnApproval,
            },
          ],
        },
      }) as OrganizationSettings;

    it("returns false when settings is undefined", () => {
      expect(isAutopublishOnApprovalEnabled(undefined, "saved-group")).toBe(
        false,
      );
    });

    it("returns true when autopublishOnApproval is enabled for the entity type", () => {
      expect(
        isAutopublishOnApprovalEnabled(sgSettings(true), "saved-group"),
      ).toBe(true);
    });

    it("returns false when autopublishOnApproval is disabled", () => {
      expect(
        isAutopublishOnApprovalEnabled(sgSettings(false), "saved-group"),
      ).toBe(false);
    });

    it("returns false when the flag is absent from the config", () => {
      expect(
        isAutopublishOnApprovalEnabled(sgSettings(undefined), "saved-group"),
      ).toBe(false);
    });

    it("returns false for an entity type with no approval-flow config", () => {
      expect(
        isAutopublishOnApprovalEnabled(
          sgSettings(true),
          "unknown" as RevisionTargetType,
        ),
      ).toBe(false);
    });

    it("reads autopublishOnApproval from requireReviews for constants", () => {
      const settings = {
        requireReviews: [
          {
            requireReviewOn: true,
            autopublishOnApproval: true,
            projects: [],
            environments: [],
          },
        ],
      } as unknown as OrganizationSettings;
      expect(
        isAutopublishOnApprovalEnabled(settings, "constant", "prj_a"),
      ).toBe(true);
    });
  });

  describe("isSavedGroupRevisionMetadataOnly", () => {
    it("returns false for an empty proposed-changes list", () => {
      expect(isSavedGroupRevisionMetadataOnly([])).toBe(false);
    });

    it("returns false when proposedChanges is not an array (legacy format)", () => {
      expect(
        isSavedGroupRevisionMetadataOnly({ groupName: "v2" } as unknown),
      ).toBe(false);
    });

    it.each([
      [{ op: "replace", path: "/groupName", value: "v2" }],
      [{ op: "replace", path: "/owner", value: "user-2" }],
      [{ op: "replace", path: "/description", value: "new desc" }],
      [{ op: "replace", path: "/projects", value: ["p1"] }],
      [{ op: "replace", path: "/archived", value: true }],
    ] as const)("returns true for a single metadata-field op (%j)", (op) => {
      expect(isSavedGroupRevisionMetadataOnly([op])).toBe(true);
    });

    it("returns true when every op touches a metadata field", () => {
      expect(
        isSavedGroupRevisionMetadataOnly([
          { op: "replace", path: "/groupName", value: "v2" },
          { op: "add", path: "/description", value: "new desc" },
          { op: "remove", path: "/owner" },
        ]),
      ).toBe(true);
    });

    it.each([
      ["values", { op: "replace", path: "/values", value: ["a", "b"] }],
      [
        "condition",
        {
          op: "replace",
          path: "/condition",
          value: '{"id":"1"}',
        },
      ],
      [
        "attributeKey",
        { op: "replace", path: "/attributeKey", value: "user_id" },
      ],
    ] as const)("returns false for a content-field op (%s)", (_label, op) => {
      expect(isSavedGroupRevisionMetadataOnly([op])).toBe(false);
    });

    it("returns false when ops mix metadata and content fields", () => {
      expect(
        isSavedGroupRevisionMetadataOnly([
          { op: "replace", path: "/groupName", value: "v2" },
          { op: "replace", path: "/values", value: ["a"] },
        ]),
      ).toBe(false);
    });

    it("returns false for ops with malformed/unparseable paths", () => {
      expect(
        isSavedGroupRevisionMetadataOnly([
          { op: "replace", path: "", value: "x" } as unknown as {
            op: "replace";
            path: string;
            value: unknown;
          },
        ]),
      ).toBe(false);
      expect(
        isSavedGroupRevisionMetadataOnly([
          { op: "replace", path: "/", value: "x" } as unknown as {
            op: "replace";
            path: string;
            value: unknown;
          },
        ]),
      ).toBe(false);
    });

    it("treats nested paths by their top-level field (e.g. `/projects/0`)", () => {
      // Top-level field is `projects` (a metadata field), so a nested write to
      // `/projects/0` is still considered metadata-only. We never produce these
      // in practice — saved-group revisions only patch top-level fields — but
      // make the behaviour explicit.
      expect(
        isSavedGroupRevisionMetadataOnly([
          { op: "replace", path: "/projects/0", value: "p1" },
        ]),
      ).toBe(true);
    });
  });

  describe("isConstantRevisionMetadataOnly", () => {
    it("returns false for an empty proposed-changes list", () => {
      expect(isConstantRevisionMetadataOnly([])).toBe(false);
    });

    it("returns false when proposedChanges is not an array (legacy format)", () => {
      expect(isConstantRevisionMetadataOnly({ name: "v2" } as unknown)).toBe(
        false,
      );
    });

    it.each([
      [{ op: "replace", path: "/name", value: "v2" }],
      [{ op: "replace", path: "/owner", value: "user-2" }],
      [{ op: "replace", path: "/description", value: "new desc" }],
      [{ op: "replace", path: "/project", value: "p1" }],
      [{ op: "replace", path: "/archived", value: true }],
    ] as const)("returns true for a single metadata-field op (%j)", (op) => {
      expect(isConstantRevisionMetadataOnly([op])).toBe(true);
    });

    it.each([
      ["value", { op: "replace", path: "/value", value: "https://x" }],
      [
        "environmentValues",
        {
          op: "replace",
          path: "/environmentValues",
          value: { staging: "https://staging" },
        },
      ],
    ] as const)("returns false for a content-field op (%s)", (_label, op) => {
      expect(isConstantRevisionMetadataOnly([op])).toBe(false);
    });

    it("returns false when ops mix metadata and content fields", () => {
      expect(
        isConstantRevisionMetadataOnly([
          { op: "replace", path: "/name", value: "v2" },
          { op: "replace", path: "/value", value: "v" },
        ]),
      ).toBe(false);
    });
  });
});
