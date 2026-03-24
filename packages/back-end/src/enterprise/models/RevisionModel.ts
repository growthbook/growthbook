import uniqid from "uniqid";
import {
  revisionValidator,
  Revision,
  RevisionTargetType,
  ReviewDecision,
} from "shared/enterprise";
import type { CreateProps } from "shared/types/base-model";
import type { SavedGroupInterface } from "shared/types/saved-group";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { buildSavedGroupSnapshot } from "back-end/src/enterprise/revisions/util";

export const COLLECTION_NAME = "revisions";

const BaseClass = MakeModelClass({
  schema: revisionValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "rev_",
  auditLog: {
    entity: "revision",
    createEvent: "revision.create",
    updateEvent: "revision.update",
    deleteEvent: "revision.delete",
  },
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        "target.type": 1,
        "target.id": 1,
        status: 1,
      },
    },
    {
      fields: { organization: 1, authorId: 1 },
    },
    {
      fields: { organization: 1, status: 1 },
    },
    // Index for efficient querying of open revisions by author and target
    {
      fields: {
        organization: 1,
        "target.type": 1,
        "target.id": 1,
        authorId: 1,
        status: 1,
      },
    },
  ],
});

export class RevisionModel extends BaseClass {
  /**
   * Delegate read permission to the underlying target entity's read check.
   */
  protected canRead(doc: Revision): boolean {
    if (doc.target.type === "saved-group") {
      const snapshot = doc.target.snapshot as SavedGroupInterface;
      return this.context.permissions.canReadMultiProjectResource(
        snapshot.projects,
      );
    }
    return false;
  }

  protected canCreate(_doc: Revision): boolean {
    return this.context.hasPremiumFeature("require-approvals");
  }

  /**
   * Delegate update permission to the underlying target entity.
   * The author can always update their own revision; otherwise the user must be
   * able to edit the target entity (e.g. for reviews). Merged revisions cannot
   * be updated.
   */
  protected canUpdate(existing: Revision, _updates: Revision): boolean {
    if (existing.status === "merged") return false;

    if (existing.authorId === this.context.userId) return true;

    if (existing.target.type === "saved-group") {
      const snapshot = existing.target.snapshot as SavedGroupInterface;
      return this.context.permissions.canUpdateSavedGroup(snapshot, {});
    }
    return false;
  }

  /**
   * Author can delete their own flow. Otherwise, the user must be able to
   * bypass approval checks for ALL of the target entity's projects.
   */
  protected canDelete(doc: Revision): boolean {
    if (doc.authorId === this.context.userId) return true;

    const projects =
      (doc.target.snapshot as SavedGroupInterface).projects ?? [];
    if (projects.length === 0) {
      return this.context.permissions.canBypassApprovalChecks({ project: "" });
    }
    return projects.every((p) =>
      this.context.permissions.canBypassApprovalChecks({ project: p }),
    );
  }

  protected async beforeCreate(doc: Revision) {
    // Calculate and set the version number
    const allRevisions = await this._find({
      "target.type": doc.target.type,
      "target.id": doc.target.id,
    } as Record<string, unknown>);

    // Sort by creation date to determine the next version
    const sortedRevisions = allRevisions.sort(
      (a, b) =>
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
    );

    // Set version to the next sequential number
    doc.version = sortedRevisions.length + 1;

    // Set default title if not provided
    if (!doc.title) {
      doc.title = `Revision ${doc.version}`;
    }

    if (!doc.activityLog || doc.activityLog.length === 0) {
      const activityLog: Array<{
        id: string;
        userId: string;
        action:
          | "created"
          | "updated"
          | "reviewed"
          | "approved"
          | "requested-changes"
          | "commented"
          | "merged"
          | "closed"
          | "reopened";
        description?: string;
        dateCreated: Date;
      }> = [
        {
          id: uniqid("act_"),
          userId: doc.authorId,
          action: "created" as const,
          dateCreated: doc.dateCreated,
        },
      ];

      // If this is a revert, add a note in the activity log with revision number
      if (doc.revertedFrom) {
        const revisionNumber =
          sortedRevisions.findIndex((r) => r.id === doc.revertedFrom) + 1;

        activityLog.push({
          id: uniqid("act_"),
          userId: doc.authorId,
          action: "created" as const,
          description: `This revision reverts changes from Revision ${revisionNumber}`,
          dateCreated: doc.dateCreated,
        });
      }

      doc.activityLog = activityLog;
    }
  }

  protected async beforeUpdate(
    existing: Revision,
    updates: Partial<Revision>,
    newDoc: Revision,
  ) {
    // Clean null values from snapshot before validation
    if (newDoc.target.type === "saved-group") {
      newDoc.target.snapshot = buildSavedGroupSnapshot(
        newDoc.target.snapshot as SavedGroupInterface,
      );
    }
  }

  // Query helpers

  async getByTargetType(entityType: RevisionTargetType) {
    return this._find({ "target.type": entityType } as Record<string, unknown>);
  }

  async getByTarget(entityType: RevisionTargetType, entityId: string) {
    return this._find({
      "target.type": entityType,
      "target.id": entityId,
    } as Record<string, unknown>);
  }

  async getOpenByTargetAndAuthor(
    entityType: RevisionTargetType,
    entityId: string,
    authorId: string,
  ) {
    return this._findOne({
      "target.type": entityType,
      "target.id": entityId,
      authorId,
      status: { $nin: ["merged", "closed"] },
    } as Record<string, unknown>);
  }

  // Review

  async submitForReview(id: string, userId: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    if (existing.status !== "draft") {
      throw new Error("Only draft revisions can be submitted for review");
    }

    return this.update(existing, {
      status: "pending-review",
      activityLog: [
        ...existing.activityLog,
        {
          id: uniqid("act_"),
          userId,
          action: "created",
          description: "Submitted for review",
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  async addReview(
    id: string,
    userId: string,
    decision: ReviewDecision,
    comment: string,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    const review = {
      id: uniqid("rev_"),
      userId,
      decision,
      ...(comment ? { comment } : {}),
      dateCreated: new Date(),
    };

    const actionMap: Record<
      ReviewDecision,
      "approved" | "requested-changes" | "commented"
    > = {
      approve: "approved",
      "request-changes": "requested-changes",
      comment: "commented",
    };

    const newStatus =
      decision === "approve"
        ? "approved"
        : decision === "request-changes"
          ? "changes-requested"
          : existing.status;

    return this.update(existing, {
      reviews: [...existing.reviews, review],
      status: newStatus,
      activityLog: [
        ...existing.activityLog,
        {
          id: uniqid("act_"),
          userId,
          action: actionMap[decision],
          ...(comment ? { description: comment } : {}),
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  // Proposed changes

  async updateProposedChanges(
    id: string,
    proposedChanges: Record<string, unknown>,
    userId: string,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    // Clean snapshot to avoid validation errors with null values
    const cleanedSnapshot =
      existing.target.type === "saved-group"
        ? buildSavedGroupSnapshot(
            existing.target.snapshot as SavedGroupInterface,
          )
        : existing.target.snapshot;

    return this.update(existing, {
      target: {
        ...existing.target,
        snapshot: cleanedSnapshot,
        proposedChanges,
      },
      activityLog: [
        ...existing.activityLog,
        {
          id: uniqid("act_"),
          userId,
          action: "updated",
          description: "Updated proposed changes",
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  async rebase(
    id: string,
    newSnapshot: Record<string, unknown>,
    newProposedChanges: Record<string, unknown>,
    userId: string,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    // Clean snapshot to avoid validation errors with null values
    const cleanedSnapshot =
      existing.target.type === "saved-group"
        ? buildSavedGroupSnapshot(newSnapshot as SavedGroupInterface)
        : newSnapshot;

    return this.update(existing, {
      target: {
        ...existing.target,
        snapshot: cleanedSnapshot,
        proposedChanges: newProposedChanges,
      },
      activityLog: [
        ...existing.activityLog,
        {
          id: uniqid("act_"),
          userId,
          action: "updated" as const,
          description: "Rebased revision on current live state",
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  // Merge / close / reopen

  async merge(id: string, userId: string, options?: { bypass?: boolean }) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    if (existing.status === "merged" || existing.status === "closed") {
      throw new Error("Cannot merge a closed or already-merged revision");
    }

    const description = options?.bypass
      ? "Merged revision (bypass)"
      : "Merged revision";

    return this.update(existing, {
      status: "merged",
      resolution: {
        action: "merged",
        userId,
        dateCreated: new Date(),
      },
      activityLog: [
        ...existing.activityLog,
        {
          id: uniqid("act_"),
          userId,
          action: "merged",
          description,
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  async close(id: string, userId: string, reason?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    if (existing.status === "merged" || existing.status === "closed") {
      throw new Error("Cannot close an already closed or merged revision");
    }

    return this.update(existing, {
      status: "closed",
      resolution: {
        action: "closed",
        userId,
        dateCreated: new Date(),
      },
      activityLog: [
        ...existing.activityLog,
        {
          id: uniqid("act_"),
          userId,
          action: "closed",
          description: reason || "Closed revision",
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  async reopen(id: string, userId: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    return this.update(existing, {
      status: "pending-review",
      resolution: undefined,
      activityLog: [
        ...existing.activityLog,
        {
          id: uniqid("act_"),
          userId,
          action: "reopened",
          description: "Reopened revision",
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  // History

  async getEntityRevisionHistory(
    entityType: RevisionTargetType,
    entityId: string,
  ) {
    return this._find({
      "target.type": entityType,
      "target.id": entityId,
      status: "merged",
    } as Record<string, unknown>);
  }

  // Beacon: lightweight query returning just target IDs with open revisions

  async getOpenRevisionTargetIds(
    entityType: RevisionTargetType,
  ): Promise<string[]> {
    return this._dangerousGetCollection().distinct("target.id", {
      organization: this.context.org.id,
      "target.type": entityType,
      status: { $nin: ["merged", "closed"] },
    });
  }

  // Create request (from saved-group controller)

  async createRequest(target: {
    type: RevisionTargetType;
    id: string;
    snapshot: SavedGroupInterface;
    proposedChanges: Record<string, unknown>;
    title?: string;
    revertedFrom?: string;
  }) {
    return this.create({
      target,
      title: target.title,
      revertedFrom: target.revertedFrom,
      status: "draft",
      authorId: this.context.userId,
      reviews: [],
      activityLog: [],
    } as CreateProps<Revision>);
  }
}
