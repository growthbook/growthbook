import type { SavedGroupInterface } from "shared/types/saved-group";
import type { Revision, JsonPatchOperation } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { savedGroupAdapter } from "back-end/src/revisions/adapters/saved-group.adapter";
import { getAdapter, getEntityModel } from "back-end/src/revisions/index";
import { isRevisionRequired } from "back-end/src/revisions/util";

const buildRevision = (proposedChanges: JsonPatchOperation[]): Revision =>
  ({
    id: "rev-1",
    target: {
      type: "saved-group",
      id: "sg-1",
      snapshot: {} as Record<string, unknown>,
      proposedChanges,
    },
    status: "draft",
    authorId: "user-1",
    reviews: [],
    activityLog: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: "org-1",
  }) as unknown as Revision;

const baseGroup: SavedGroupInterface = {
  id: "sg-1",
  organization: "org-1",
  groupName: "My Group",
  owner: "user-1",
  type: "list",
  values: ["a", "b"],
  attributeKey: "userId",
  description: "desc",
  projects: ["prj-1"],
  useEmptyListGroup: true,
  dateCreated: new Date("2025-01-01"),
  dateUpdated: new Date("2025-01-02"),
};

// Build a minimal context that satisfies the parts of `Context` actually
// touched by the adapter under test. We deliberately cast through `unknown`
// to avoid pulling the entire context surface into a unit test.
function makeContext(overrides: {
  approvalRequired?: boolean;
  hasRequireApprovals?: boolean;
  // When provided, controls the `requireMetadataReview` org setting. Defaults
  // to `undefined` (which behaves like the historical "true" default).
  requireMetadataReview?: boolean;
  permissions?: Partial<Record<string, (...args: unknown[]) => boolean>>;
  savedGroupsModel?: unknown;
}): Context {
  const permissions = {
    canReadMultiProjectResource: () => true,
    canUpdateSavedGroup: () => true,
    canBypassApprovalChecks: () => true,
    ...(overrides.permissions ?? {}),
  };
  return {
    org: {
      settings: {
        approvalFlows: overrides.approvalRequired
          ? {
              savedGroups: [
                {
                  required: true,
                  ...(overrides.requireMetadataReview !== undefined
                    ? { requireMetadataReview: overrides.requireMetadataReview }
                    : {}),
                },
              ],
            }
          : { savedGroups: [{ required: false }] },
      },
    },
    permissions,
    hasPremiumFeature: (feature: string) =>
      feature === "require-approvals"
        ? (overrides.hasRequireApprovals ?? true)
        : false,
    models: {
      savedGroups: overrides.savedGroupsModel ?? {
        getById: jest.fn(),
        update: jest.fn(),
      },
    },
  } as unknown as Context;
}

describe("savedGroupAdapter", () => {
  describe("buildSnapshot", () => {
    it("strips _id and normalises nullish optional fields", () => {
      const withNulls = {
        ...baseGroup,
        _id: "internal",
        values: null as unknown as string[],
        condition: null as unknown as string,
        attributeKey: null as unknown as string,
        description: null as unknown as string,
        projects: null as unknown as string[],
        useEmptyListGroup: null as unknown as boolean,
      } as SavedGroupInterface & { _id?: unknown };

      const snap = savedGroupAdapter.buildSnapshot(
        withNulls as unknown as SavedGroupInterface,
      );

      expect(snap).not.toHaveProperty("_id");
      expect(snap.values).toBeUndefined();
      expect(snap.condition).toBeUndefined();
      expect(snap.attributeKey).toBeUndefined();
      expect(snap.description).toBeUndefined();
      expect(snap.projects).toBeUndefined();
      expect(snap.useEmptyListGroup).toBeUndefined();
      // Required fields preserved
      expect(snap.id).toBe("sg-1");
      expect(snap.groupName).toBe("My Group");
      expect(snap.type).toBe("list");
    });

    it("preserves all valid optional fields", () => {
      const snap = savedGroupAdapter.buildSnapshot(baseGroup);
      expect(snap).toEqual(baseGroup);
    });

    it("strips legacy fields no longer in the schema", () => {
      // Saved group docs created before #2904 still have `passByReferenceOnly`
      // (and could in principle have other since-removed fields). The
      // snapshot validator runs in .strict() mode, so we must drop them.
      const withLegacy = {
        ...baseGroup,
        passByReferenceOnly: true,
        someOtherUnknownField: "x",
      } as unknown as SavedGroupInterface;

      const snap = savedGroupAdapter.buildSnapshot(withLegacy);

      expect(snap).not.toHaveProperty("passByReferenceOnly");
      expect(snap).not.toHaveProperty("someOtherUnknownField");
      expect(snap.id).toBe("sg-1");
      expect(snap.groupName).toBe("My Group");
    });
  });

  describe("getUpdatableFields", () => {
    it("returns the documented set of updatable fields", () => {
      const fields = savedGroupAdapter.getUpdatableFields();
      expect(fields.has("groupName")).toBe(true);
      expect(fields.has("owner")).toBe(true);
      expect(fields.has("values")).toBe(true);
      expect(fields.has("condition")).toBe(true);
      expect(fields.has("attributeKey")).toBe(true);
      expect(fields.has("description")).toBe(true);
      expect(fields.has("projects")).toBe(true);
      expect(fields.has("useEmptyListGroup")).toBe(true);
      expect(fields.has("archived")).toBe(true);
    });

    it("does NOT include sensitive / immutable fields", () => {
      const fields = savedGroupAdapter.getUpdatableFields();
      expect(fields.has("id")).toBe(false);
      expect(fields.has("organization")).toBe(false);
      expect(fields.has("type")).toBe(false);
      expect(fields.has("dateCreated")).toBe(false);
      expect(fields.has("dateUpdated")).toBe(false);
    });

    it("returns the same Set instance across calls (cheap to call)", () => {
      const a = savedGroupAdapter.getUpdatableFields();
      const b = savedGroupAdapter.getUpdatableFields();
      expect(a).toBe(b);
    });
  });

  describe("isRevisionRequired / isApprovalRequired", () => {
    it("returns true when org settings require approval for saved groups", () => {
      const ctx = makeContext({ approvalRequired: true });
      expect(savedGroupAdapter.isRevisionRequired(ctx)).toBe(true);
      expect(savedGroupAdapter.isApprovalRequired(ctx)).toBe(true);
    });

    it("returns false when org settings do not require approval", () => {
      const ctx = makeContext({ approvalRequired: false });
      expect(savedGroupAdapter.isRevisionRequired(ctx)).toBe(false);
      expect(savedGroupAdapter.isApprovalRequired(ctx)).toBe(false);
    });

    it("returns false when the org does not have the require-approvals feature", () => {
      const ctx = makeContext({
        approvalRequired: true,
        hasRequireApprovals: false,
      });
      expect(savedGroupAdapter.isRevisionRequired(ctx)).toBe(false);
      expect(savedGroupAdapter.isApprovalRequired(ctx)).toBe(false);
    });

    it("returns false when settings are missing entirely", () => {
      const ctx = {
        org: { settings: undefined },
        permissions: {},
        hasPremiumFeature: () => true,
        models: {},
      } as unknown as Context;
      expect(savedGroupAdapter.isRevisionRequired(ctx)).toBe(false);
      expect(savedGroupAdapter.isApprovalRequired(ctx)).toBe(false);
    });
  });

  describe("isApprovalRequiredForRevision", () => {
    const metadataOnlyChanges: JsonPatchOperation[] = [
      { op: "replace", path: "/groupName", value: "renamed" },
      { op: "replace", path: "/description", value: "new desc" },
    ];
    const contentChanges: JsonPatchOperation[] = [
      { op: "replace", path: "/values", value: ["a", "b"] },
    ];
    const mixedChanges: JsonPatchOperation[] = [
      { op: "replace", path: "/groupName", value: "renamed" },
      { op: "replace", path: "/values", value: ["a"] },
    ];

    it("returns false when org-wide approval is disabled, regardless of contents", () => {
      const ctx = makeContext({ approvalRequired: false });
      expect(
        savedGroupAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(metadataOnlyChanges),
        ),
      ).toBe(false);
      expect(
        savedGroupAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChanges),
        ),
      ).toBe(false);
    });

    it("returns false when approval settings are enabled but not licensed", () => {
      const ctx = makeContext({
        approvalRequired: true,
        hasRequireApprovals: false,
      });
      expect(
        savedGroupAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChanges),
        ),
      ).toBe(false);
    });

    it("returns true for any revision when metadata review is required (default)", () => {
      const ctx = makeContext({ approvalRequired: true });
      expect(
        savedGroupAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(metadataOnlyChanges),
        ),
      ).toBe(true);
      expect(
        savedGroupAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChanges),
        ),
      ).toBe(true);
    });

    it("returns true for any revision when requireMetadataReview is explicitly true", () => {
      const ctx = makeContext({
        approvalRequired: true,
        requireMetadataReview: true,
      });
      expect(
        savedGroupAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(metadataOnlyChanges),
        ),
      ).toBe(true);
    });

    // The headline behaviour the user asked for: when metadata review is off
    // and the revision only changes metadata fields, the per-revision gate
    // releases approval.
    it("returns false for metadata-only revisions when requireMetadataReview is disabled", () => {
      const ctx = makeContext({
        approvalRequired: true,
        requireMetadataReview: false,
      });
      expect(
        savedGroupAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(metadataOnlyChanges),
        ),
      ).toBe(false);
    });

    it("still requires approval for content-touching revisions when requireMetadataReview is disabled", () => {
      const ctx = makeContext({
        approvalRequired: true,
        requireMetadataReview: false,
      });
      expect(
        savedGroupAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChanges),
        ),
      ).toBe(true);
      expect(
        savedGroupAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(mixedChanges),
        ),
      ).toBe(true);
    });

    // Empty proposed changes can't be "metadata-only" — there's nothing to
    // publish — so we fall back to the org-wide rule. This matches the
    // shared helper's contract and keeps a no-op revision from accidentally
    // skipping review.
    it("requires approval for an empty proposed-changes list when approval is on", () => {
      const ctx = makeContext({
        approvalRequired: true,
        requireMetadataReview: false,
      });
      expect(
        savedGroupAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision([]),
        ),
      ).toBe(true);
    });
  });

  describe("permission helpers", () => {
    it("canRead delegates to canReadMultiProjectResource with the snapshot projects", () => {
      const canReadMultiProjectResource = jest.fn(() => true);
      const ctx = makeContext({
        permissions: { canReadMultiProjectResource },
      });
      const result = savedGroupAdapter.canRead(ctx, baseGroup);
      expect(result).toBe(true);
      expect(canReadMultiProjectResource).toHaveBeenCalledWith(["prj-1"]);
    });

    it("canCreate / canUpdate both delegate to canUpdateSavedGroup", () => {
      const canUpdateSavedGroup = jest.fn(() => true);
      const ctx = makeContext({ permissions: { canUpdateSavedGroup } });
      expect(savedGroupAdapter.canCreate(ctx, baseGroup)).toBe(true);
      expect(savedGroupAdapter.canUpdate(ctx, baseGroup)).toBe(true);
      expect(canUpdateSavedGroup).toHaveBeenCalledTimes(2);
      expect(canUpdateSavedGroup).toHaveBeenNthCalledWith(1, baseGroup, {});
    });

    it("canDelete with no projects checks bypass on the empty project", () => {
      const canBypassApprovalChecks = jest.fn(() => true);
      const ctx = makeContext({ permissions: { canBypassApprovalChecks } });
      const groupNoProjects: SavedGroupInterface = {
        ...baseGroup,
        projects: undefined,
      };
      expect(savedGroupAdapter.canDelete(ctx, groupNoProjects)).toBe(true);
      expect(canBypassApprovalChecks).toHaveBeenCalledWith({ project: "" });
    });

    it("canDelete with multiple projects requires bypass on every project", () => {
      const allowedProjects = new Set(["prj-1", "prj-2"]);
      const canBypassApprovalChecks = jest.fn(
        ({ project }: { project: string }) => allowedProjects.has(project),
      );
      const ctx = makeContext({ permissions: { canBypassApprovalChecks } });
      const group: SavedGroupInterface = {
        ...baseGroup,
        projects: ["prj-1", "prj-2"],
      };
      expect(savedGroupAdapter.canDelete(ctx, group)).toBe(true);

      const partialDeny = jest.fn(
        ({ project }: { project: string }) => project !== "prj-2",
      );
      const ctx2 = makeContext({
        permissions: { canBypassApprovalChecks: partialDeny },
      });
      expect(savedGroupAdapter.canDelete(ctx2, group)).toBe(false);
    });

    it("canBypassApproval mirrors canDelete logic", () => {
      const canBypassApprovalChecks = jest.fn(
        ({ project }: { project: string }) => project === "prj-1",
      );
      const ctx = makeContext({ permissions: { canBypassApprovalChecks } });
      // Single allowed project
      expect(savedGroupAdapter.canBypassApproval(ctx, baseGroup)).toBe(true);
      // Multi-project — partial deny
      const multi: SavedGroupInterface = {
        ...baseGroup,
        projects: ["prj-1", "prj-2"],
      };
      expect(savedGroupAdapter.canBypassApproval(ctx, multi)).toBe(false);
    });
  });

  describe("applyChanges", () => {
    it("filters out non-updatable fields before calling the model", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      const ctx = makeContext({
        savedGroupsModel: { getById: jest.fn(), update },
      });

      await savedGroupAdapter.applyChanges(ctx, baseGroup, {
        groupName: "New Name", // updatable, differs
        organization: "different-org", // NOT updatable — must be filtered
        type: "condition", // NOT updatable
        unknown: "x", // not in field set
      });

      expect(update).toHaveBeenCalledTimes(1);
      const [, changes] = update.mock.calls[0];
      expect(changes).toEqual({ groupName: "New Name" });
    });

    it("ignores updatable fields whose value is unchanged", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      const ctx = makeContext({
        savedGroupsModel: { getById: jest.fn(), update },
      });

      await savedGroupAdapter.applyChanges(ctx, baseGroup, {
        groupName: baseGroup.groupName, // unchanged
        owner: baseGroup.owner, // unchanged
        values: ["a", "b"], // deep-equal to baseGroup.values
      });

      expect(update).not.toHaveBeenCalled();
    });

    it("treats undefined as 'no change' and skips the field", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      const ctx = makeContext({
        savedGroupsModel: { getById: jest.fn(), update },
      });

      await savedGroupAdapter.applyChanges(ctx, baseGroup, {
        description: undefined,
        groupName: "renamed",
      });

      expect(update).toHaveBeenCalledWith(
        baseGroup,
        expect.objectContaining({ groupName: "renamed" }),
        undefined,
      );
      const [, changes] = update.mock.calls[0];
      expect(changes).not.toHaveProperty("description");
    });

    it("does not call update at all when no changes are detected", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      const ctx = makeContext({
        savedGroupsModel: { getById: jest.fn(), update },
      });

      await savedGroupAdapter.applyChanges(ctx, baseGroup, {});
      expect(update).not.toHaveBeenCalled();
    });

    it("passes only the differing updatable fields through", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      const ctx = makeContext({
        savedGroupsModel: { getById: jest.fn(), update },
      });

      await savedGroupAdapter.applyChanges(ctx, baseGroup, {
        values: ["a", "b", "c"], // changed
        attributeKey: baseGroup.attributeKey, // unchanged → skip
        archived: true, // updatable, differs (was undefined)
      });

      const [, changes] = update.mock.calls[0];
      expect(changes).toEqual({
        values: ["a", "b", "c"],
        archived: true,
      });
    });
  });
});

describe("revisions registry", () => {
  it("getAdapter returns the saved-group adapter for 'saved-group'", () => {
    expect(getAdapter("saved-group")).toBe(savedGroupAdapter);
  });

  it("getEntityModel returns the entity model from the adapter", () => {
    const fakeModel = { getById: jest.fn() };
    const ctx = makeContext({ savedGroupsModel: fakeModel });
    expect(getEntityModel(ctx, "saved-group")).toBe(fakeModel);
  });

  it("isRevisionRequired delegates to the adapter", () => {
    const ctxOn = makeContext({ approvalRequired: true });
    const ctxOff = makeContext({ approvalRequired: false });
    expect(isRevisionRequired(ctxOn, "saved-group", "sg-1")).toBe(true);
    expect(isRevisionRequired(ctxOff, "saved-group", "sg-1")).toBe(false);
  });
});
