import type { ApprovalFlowConfigurations } from "../../../types/organization";
import {
  getRevisionKey,
  canUserReviewEntity,
  checkMergeConflicts,
} from "../../../src/revisions/helpers";
import type {
  RevisionTargetType,
  Revision,
} from "../../../src/enterprise/validators/revisions";

// Helper to create a mock revision
const createRevision = (overrides: Partial<Revision> = {}): Revision =>
  ({
    id: "rev-1",
    target: {
      type: "saved-group" as const,
      id: "sg-1",
      snapshot: {} as Record<string, unknown>,
      proposedChanges: {},
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
          approvalFlowSettings: { savedGroups: { required: true } },
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
          approvalFlowSettings: { savedGroups: { required: true } },
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
          approvalFlowSettings: { savedGroups: { required: true } },
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
          approvalFlowSettings: { savedGroups: { required: true } },
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
          approvalFlowSettings: { savedGroups: { required: true } },
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
      const proposed = { name: "new" };
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);
      expect(result.canAutoMerge).toBe(true);
      expect(result.mergedChanges).toEqual({ name: "new", value: 1 });
    });

    it("detects conflicts when base, live, and proposed all differ", () => {
      const base = { name: "old" };
      const live = { name: "live-change" };
      const proposed = { name: "proposed-change" };
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].field).toBe("name");
      expect(result.canAutoMerge).toBe(false);
    });

    it("no conflict when live and proposed changed to the same value", () => {
      const base = { name: "old" };
      const live = { name: "same-new" };
      const proposed = { name: "same-new" };
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it("merges non-overlapping changes", () => {
      const base = { name: "old", color: "red" };
      const live = { name: "old", color: "blue" };
      const proposed = { name: "new" };
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.mergedChanges).toEqual({ name: "new", color: "blue" });
    });

    it("handles array values", () => {
      const base = { values: ["a", "b"] };
      const live = { values: ["a", "b", "c"] };
      const proposed = { values: ["a", "d"] };
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(false);
      expect(result.conflicts[0].field).toBe("values");
    });

    it("returns no conflict when proposed matches base (no real change)", () => {
      const base = { name: "same" };
      const live = { name: "same" };
      const proposed = { name: "same" };
      const result = checkMergeConflicts(base, live, proposed);
      expect(result.success).toBe(true);
      expect(result.fieldsChanged).toHaveLength(0);
    });
  });
});
