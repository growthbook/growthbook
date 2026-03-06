import uniqid from "uniqid";
import {
  approvalFlowValidator,
  ApprovalFlow,
  ApprovalFlowTargetType,
  ReviewDecision,
} from "shared/enterprise";
import type { CreateProps } from "shared/types/base-model";
import type { SavedGroupInterface } from "shared/types/saved-group";
import { MakeModelClass } from "back-end/src/models/BaseModel";

export const COLLECTION_NAME = "approvalflows";

const BaseClass = MakeModelClass({
  schema: approvalFlowValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "af_",
  auditLog: {
    entity: "approvalFlow",
    createEvent: "approvalFlow.create",
    updateEvent: "approvalFlow.update",
    deleteEvent: "approvalFlow.delete",
  },
  globallyUniqueIds: true,
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
    // Enforce at most one open flow per author per target at the DB level (TOCTOU guard)
    {
      fields: {
        organization: 1,
        "target.type": 1,
        "target.id": 1,
        authorId: 1,
      },
      unique: true,
      partialFilterExpression: {
        status: { $nin: ["merged", "closed"] },
      },
    },
  ],
});

export class ApprovalFlowModel extends BaseClass {
  /**
   * Delegate read permission to the underlying target entity's read check.
   */
  protected canRead(doc: ApprovalFlow): boolean {
    if (doc.target.type === "saved-group") {
      const snapshot = doc.target.snapshot as SavedGroupInterface;
      return this.context.permissions.canReadMultiProjectResource(
        snapshot.projects,
      );
    }
    return false;
  }

  protected canCreate(_doc: ApprovalFlow): boolean {
    return this.context.hasPremiumFeature("require-approvals");
  }

  /**
   * Delegate update permission to the underlying target entity.
   * The author can always update their own flow; otherwise the user must be
   * able to edit the target entity (e.g. for reviews). Merged flows cannot
   * be updated.
   */
  protected canUpdate(existing: ApprovalFlow, _updates: ApprovalFlow): boolean {
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
  protected canDelete(doc: ApprovalFlow): boolean {
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

  protected async beforeCreate(doc: ApprovalFlow) {
    if (!doc.activityLog || doc.activityLog.length === 0) {
      doc.activityLog = [
        {
          id: uniqid("act_"),
          userId: doc.authorId,
          action: "created",
          dateCreated: doc.dateCreated,
        },
      ];
    }
  }

  // Query helpers

  async getByTargetType(entityType: ApprovalFlowTargetType) {
    return this._find({ "target.type": entityType } as Record<string, unknown>);
  }

  async getByTarget(entityType: ApprovalFlowTargetType, entityId: string) {
    return this._find({
      "target.type": entityType,
      "target.id": entityId,
    } as Record<string, unknown>);
  }

  async getOpenByTargetAndAuthor(
    entityType: ApprovalFlowTargetType,
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

  async addReview(
    id: string,
    userId: string,
    decision: ReviewDecision,
    comment: string,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Approval flow not found");

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
    } as Partial<ApprovalFlow>);
  }

  // Proposed changes

  async updateProposedChanges(
    id: string,
    proposedChanges: Record<string, unknown>,
    userId: string,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Approval flow not found");

    return this.update(existing, {
      target: {
        ...existing.target,
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
    } as Partial<ApprovalFlow>);
  }

  // Merge / close / reopen

  async merge(id: string, userId: string, options?: { bypass?: boolean }) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Approval flow not found");

    if (existing.status === "merged" || existing.status === "closed") {
      throw new Error("Cannot merge a closed or already-merged approval flow");
    }

    const description = options?.bypass
      ? "Merged approval flow (bypass)"
      : "Merged approval flow";

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
    } as Partial<ApprovalFlow>);
  }

  async close(id: string, userId: string, reason?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Approval flow not found");

    if (existing.status === "merged" || existing.status === "closed") {
      throw new Error("Cannot close an already closed or merged approval flow");
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
          description: reason || "Closed approval flow",
          dateCreated: new Date(),
        },
      ],
    } as Partial<ApprovalFlow>);
  }

  async reopen(id: string, userId: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Approval flow not found");

    return this.update(existing, {
      status: "pending-review",
      resolution: undefined,
      activityLog: [
        ...existing.activityLog,
        {
          id: uniqid("act_"),
          userId,
          action: "reopened",
          description: "Reopened approval flow",
          dateCreated: new Date(),
        },
      ],
    } as Partial<ApprovalFlow>);
  }

  // History

  async getEntityRevisionHistory(
    entityType: ApprovalFlowTargetType,
    entityId: string,
  ) {
    return this._find({
      "target.type": entityType,
      "target.id": entityId,
      status: "merged",
    } as Record<string, unknown>);
  }

  // Beacon: lightweight query returning just target IDs with open flows

  async getOpenFlowTargetIds(
    entityType: ApprovalFlowTargetType,
  ): Promise<string[]> {
    return this._dangerousGetCollection().distinct("target.id", {
      organization: this.context.org.id,
      "target.type": entityType,
      status: { $nin: ["merged", "closed"] },
    });
  }

  // Create request (from saved-group controller)

  async createRequest(target: {
    type: ApprovalFlowTargetType;
    id: string;
    snapshot: SavedGroupInterface;
    proposedChanges: Record<string, unknown>;
  }) {
    // Enforce per-author uniqueness: one open flow per resource per author
    const existing = await this.getOpenByTargetAndAuthor(
      target.type,
      target.id,
      this.context.userId,
    );
    if (existing) {
      throw new Error(
        "You already have an open approval flow for this resource",
      );
    }

    return this.create({
      target,
      status: "pending-review",
      authorId: this.context.userId,
      reviews: [],
      activityLog: [],
    } as CreateProps<ApprovalFlow>);
  }
}
