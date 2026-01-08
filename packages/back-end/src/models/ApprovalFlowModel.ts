import uniqid from "uniqid";
import { isEqual } from "lodash";
import { MakeModelClass, UpdateProps } from "./BaseModel";
import {
  approvalFlowValidator,
  ApprovalFlowInterface,
  ApprovalFlowStatus,
  ReviewDecision,
  Review,
  ActivityLogEntry,
  adminCanBypassApprovalFlow,
  ApprovalEntityType,
  getEntityModel,
userCanReviewEntity,
} from "back-end/src/validators/approval-flows";
import { checkMergeConflicts, MergeResult } from "shared/util";

export const COLLECTION_NAME = "approvalflow";

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
});

export class ApprovalFlowModel extends BaseClass {
  // TODO: fix permissions - these should check user permissions for the entity type
  protected canRead() {
    return true;
  }
  protected canCreate() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
  }

  /**
   * Ensure approval flow has activity log on creation
   */
  protected async beforeCreate(doc: ApprovalFlowInterface) {
    // set the current entity state as the original entity
      const entityModel = getEntityModel(this.context, doc.entityType);
      const originalEntity = await entityModel?.getById(doc.entityId);
      if (!originalEntity) {
        throw new Error(`Original entity not found for ${doc.entityType} ${doc.entityId}`);
      }
      doc.originalEntity = originalEntity;
    // Ensure activity log has creation entry
    if (!doc.activityLog || doc.activityLog.length === 0) {
      const creationEntry: ActivityLogEntry = {
        id: uniqid("activity_"),
        userId: doc.author,
        action: "created",
        details: `Created approval flow: ${doc.title}`,
        createdAt: doc.dateCreated,
      };
      doc.activityLog = [creationEntry];
    }
  }
  
  /**
   * Get all approval flows for the organization
   */
  public async getAll(): Promise<ApprovalFlowInterface[]> {
    return await this._find({});
  }

  /**
   * Get all approval flows for a specific entity type
   */
  public async getByEntityType(
    entityType: ApprovalEntityType
  ): Promise<ApprovalFlowInterface[]> {
    return await this._find({ entityType });
  }

  /**
   * Get all approval flows for a specific entity
   */
  public async getByEntity(
    entityType: ApprovalEntityType,
    entityId: string
  ): Promise<ApprovalFlowInterface[]> {
    return await this._find({ entityType, entityId });
  }

  /**
   * Get open approval flows for a specific entity
   */
  public async getOpenByEntity(
    entityType: ApprovalEntityType,
    entityId: string
  ): Promise<ApprovalFlowInterface[]> {
    return await this._find({
      entityType,
      entityId,
      status: { $in: ["draft", "pending-review", "changes-requested"] },
    });
  }

  /**
   * Get open approval flow for a specific entity by author
   * Returns the user's existing open/pending approval flow if one exists
   */
  public async getOpenByEntityAndAuthor(
    entityType: ApprovalEntityType,
    entityId: string,
    author: string
  ): Promise<ApprovalFlowInterface | null> {
    const flows = await this._find({
      entityType,
      entityId,
      author,
      status: { $in: ["draft", "pending-review", "changes-requested"] },
    });

    // Return the most recent open flow by this author
    if (flows.length === 0) return null;

    return flows.sort(
      (a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()
    )[0];
  }

  /**
   * Get approval flows by status
   */
  public async getByStatus(
    status: ApprovalFlowStatus
  ): Promise<ApprovalFlowInterface[]> {
    return await this._find({ status });
  }

  /**
   * Get approval flows created by a user
   */
  public async getByAuthor(userId: string): Promise<ApprovalFlowInterface[]> {
    return await this._find({ author: userId });
  }

  /**
   * Get all open approval flows needing review
   */
  public async getAllPendingReview(): Promise<ApprovalFlowInterface[]> {
    return await this._find({
      status: { $in: ["pending-review", "changes-requested"] },
    });
  }

  /**
   * Add a review (approve, request changes, or comment)
   */
  public async addReview(
    approvalFlowId: string,
    userId: string,
    decision: ReviewDecision,
    comment: string
  ): Promise<ApprovalFlowInterface> {
    const approvalFlow = await this.getById(approvalFlowId);
    if (!approvalFlow) {
      throw new Error("Approval flow not found");
    }

    // Validate state
    if (approvalFlow.status === "merged" || approvalFlow.status === "closed") {
      throw new Error(
        `Cannot add review to ${approvalFlow.status} approval flow`
      );
    }

    // Check if user is trying to approve their own changes
    if (decision === "approve" && userId === approvalFlow.author) {
      // Only admins or super admins can approve their own changes
      const isAdmin = this.context.superAdmin || 
                     this.context?.role === "admin";
      
      if (!isAdmin) {
        throw new Error(
          "You cannot approve your own approval flow. Only admins or other users can approve."
        );
      }
    }
    if (!this.canUserReview(approvalFlow, userId)) {
      throw new Error("You are not authorized to review this approval flow");
    }

    const now = new Date();
    const review: Review = {
      id: uniqid("review_"),
      userId,
      decision,
      comment,
      createdAt: now,
    };

    // Add to activity log
    const activityEntry: ActivityLogEntry = {
      id: uniqid("activity_"),
      userId,
      action:
        decision === "approve"
          ? "approved"
          : decision === "request-changes"
          ? "requested-changes"
          : "commented",
      details: comment,
      createdAt: now,
    };

    const updatedReviews = [...approvalFlow.reviews, review];

    // Determine new status
    let newStatus = approvalFlow.status;
    if (decision === "request-changes") {
      newStatus = "changes-requested";
    } else if (decision === "approve") {
      // Check if requirements are met (at least one non-author approval)
      const requirementsMet = this.checkApprovalRequirements({
        ...approvalFlow,
        reviews: updatedReviews,
      });
      if (requirementsMet) {
        newStatus = "approved";
      }
    }

    return await this.updateById(approvalFlowId, {
      reviews: updatedReviews,
      activityLog: [...approvalFlow.activityLog, activityEntry],
      status: newStatus,
    });
  }

  /**
   * Check if approval requirements are met
   * Uses the latest review as the source of truth (old reviews become redundant)
   * Comments don't affect approval status - only "approve" and "request-changes" matter
   */
  private checkApprovalRequirements(
    approvalFlow: ApprovalFlowInterface
  ): boolean {
    const { reviews, author } = approvalFlow;

    if (reviews.length === 0) {
      return false;
    }

    const sortedReviews = [...reviews].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const latestMeaningfulReview = sortedReviews.find(
      (r) => r.decision === "approve" || r.decision === "request-changes"
    );

    if (!latestMeaningfulReview) {
      return false;
    }

    if (latestMeaningfulReview.decision === "request-changes") {
      return false;
    }
    if (latestMeaningfulReview.decision === "approve") {
      return true;
    }
    return false;
  }

  /**
   * Update the proposed changes in an approval flow
   */
  public async updateProposedChanges(
    approvalFlowId: string,
    proposedChanges: Record<string, unknown>,
    userId: string
  ): Promise<ApprovalFlowInterface> {
    const approvalFlow = await this.getById(approvalFlowId);
    if (!approvalFlow) {
      throw new Error("Approval flow not found");
    }

    if (approvalFlow.status === "merged" || approvalFlow.status === "closed") {
      throw new Error(
        `Cannot update ${approvalFlow.status} approval flow`
      );
    }

    const now = new Date();
    const activityEntry: ActivityLogEntry = {
      id: uniqid("activity_"),
      userId,
      action: "updated",
      details: "Updated proposed changes",
      createdAt: now,
    };

    return await this.updateById(approvalFlowId, {
      proposedChanges,
      activityLog: [...approvalFlow.activityLog, activityEntry],
      status: "pending-review",
    });
  }

  /**
   * Merge an approval flow (apply the changes)
   */
  public async merge(
    approvalFlowId: string,
    mergedBy: string
  ): Promise<ApprovalFlowInterface> {
    const approvalFlow = await this.getById(approvalFlowId);
    if (!approvalFlow) {
      throw new Error("Approval flow not found");
    }
    const adminCanBypass = adminCanBypassApprovalFlow(this.context, approvalFlow);

    // Check if approved
    if (approvalFlow.status !== "approved" && !adminCanBypass) {
      throw new Error(
        "Cannot merge approval flow that is not approved"
      );
    }

    const now = new Date();
    const activityEntry: ActivityLogEntry = {
      id: uniqid("activity_"),
      userId: mergedBy,
      action: "merged",
      details: "Merged approval flow",
      createdAt: now,
    };

    return await this.updateById(approvalFlowId, {
      status: "merged",
      mergedAt: now,
      mergedBy,
      activityLog: [...approvalFlow.activityLog, activityEntry],
    });
  }


  /**
   * Close an approval flow without merging
   */
  public async close(
    approvalFlowId: string,
    closedBy: string,
    reason?: string
  ): Promise<ApprovalFlowInterface> {
    const approvalFlow = await this.getById(approvalFlowId);
    if (!approvalFlow) {
      throw new Error("Approval flow not found");
    }

    if (approvalFlow.status === "merged" || approvalFlow.status === "closed") {
      throw new Error(
        `Approval flow is already ${approvalFlow.status}`
      );
    }

    const now = new Date();
    const activityEntry: ActivityLogEntry = {
      id: uniqid("activity_"),
      userId: closedBy,
      action: "closed",
      details: reason || "Closed approval flow",
      createdAt: now,
    };

    return await this.updateById(approvalFlowId, {
      status: "closed",
      closedAt: now,
      closedBy,
      activityLog: [...approvalFlow.activityLog, activityEntry],
    });
  }

  /**
   * Reopen a closed approval flow
   */
  public async reopen(
    approvalFlowId: string,
    reopenedBy: string
  ): Promise<ApprovalFlowInterface> {
    const approvalFlow = await this.getById(approvalFlowId);
    if (!approvalFlow) {
      throw new Error("Approval flow not found");
    }

    if (approvalFlow.status !== "closed") {
      throw new Error("Only closed approval flows can be reopened");
    }

    const now = new Date();
    const activityEntry: ActivityLogEntry = {
      id: uniqid("activity_"),
      userId: reopenedBy,
      action: "reopened",
      details: "Reopened approval flow",
      createdAt: now,
    };

    return await this.updateById(approvalFlowId, {
      status: "pending-review",
      closedAt: undefined,
      closedBy: undefined,
      activityLog: [...approvalFlow.activityLog, activityEntry],
    });
  }

  /**
   * Check if a user can review an approval flow
   * Anyone with edit permissions for the entity can review except the author (cannot approve own changes)
   */
  private canUserReview(
    approvalFlow: ApprovalFlowInterface,
    userId: string
  ): boolean {
    // Can't review merged or closed flows
    if (approvalFlow.status === "merged" || approvalFlow.status === "closed") {
      return false;
    }
   
    return userCanReviewEntity(approvalFlow.entityType, this.context, approvalFlow.originalEntity);
  }
 
  /**
   * Get approval flow status summary
   */
  public getApprovalStatus(approvalFlow: ApprovalFlowInterface): {
    isApproved: boolean;
    requirementsMet: boolean;
    nonAuthorApprovalsCount: number;
    changesRequested: boolean;
    hasReviews: boolean;
  } {
    const { reviews, author } = approvalFlow;

    // Get non-author approvals
    const nonAuthorApprovals = reviews.filter(
      (r) => r.decision === "approve" && r.userId !== author
    );

    // Get latest review per user to check for change requests
    const latestReviewsByUser = new Map<string, Review>();
    for (const review of reviews) {
      const existing = latestReviewsByUser.get(review.userId);
      if (!existing || review.createdAt > existing.createdAt) {
        latestReviewsByUser.set(review.userId, review);
      }
    }

    const changesRequested = Array.from(latestReviewsByUser.values()).some(
      (r) => r.decision === "request-changes"
    );

    const requirementsMet = this.checkApprovalRequirements(approvalFlow);

    return {
      isApproved: approvalFlow.status === "approved",
      requirementsMet,
      nonAuthorApprovalsCount: nonAuthorApprovals.length,
      changesRequested,
      hasReviews: reviews.length > 0,
    };
  }

  /**
   * Get revision history for an entity
   * Returns all merged approval flows (revisions) for an entity, sorted by merge date
   */
  public async getEntityRevisionHistory(
    entityType: ApprovalEntityType,
    entityId: string
  ): Promise<ApprovalFlowInterface[]> {
    const mergedFlows = await this._find({
      entityType,
      entityId,
      status: "merged",
    });

    // Sort by merged date, most recent first
    return mergedFlows.sort((a, b) => {
      if (!a.mergedAt || !b.mergedAt) return 0;
      return b.mergedAt.getTime() - a.mergedAt.getTime();
    });
  }

  /**
   * Get a specific revision (merged approval flow) for an entity
   */
  public async getEntityRevision(
    approvalFlowId: string
  ): Promise<ApprovalFlowInterface | null> {
    const approvalFlow = await this.getById(approvalFlowId);
    if (!approvalFlow) {
      return null;
    }

    // Only return if it's merged (i.e., a committed revision)
    if (approvalFlow.status !== "merged") {
      throw new Error("Approval flow must be merged to be a revision");
    }

    return approvalFlow;
  }

  /**
   * Revert an entity to a previous revision
   * Creates a new approval flow with the changes from a previous merged approval flow
   */
  public async createRevertApprovalFlow(
    targetRevisionId: string,
    userId: string,
    title?: string,
    description?: string
  ): Promise<ApprovalFlowInterface> {
    const targetRevision = await this.getById(targetRevisionId);
    if (!targetRevision) {
      throw new Error("Target revision not found");
    }

    if (targetRevision.status !== "merged") {
      throw new Error("Can only revert to merged approval flows");
    }

    // Create a new approval flow with the old changes
    const now = new Date();
    const revertTitle =
      title || `Revert to: ${targetRevision.title}`;
    const revertDescription =
      description ||
      `Reverting to changes from approval flow ${targetRevisionId}`;

    const activityEntry: ActivityLogEntry = {
      id: uniqid("activity_"),
      userId,
      action: "created",
      details: `Created revert approval flow from ${targetRevisionId}`,
      createdAt: now,
    };

    return await this.create({
      entityType: targetRevision.entityType,
      entityId: targetRevision.entityId,
      title: revertTitle,
      description: revertDescription,
      status: "draft",
      author: userId,
      reviews: [],
      proposedChanges: targetRevision.proposedChanges,
      originalEntity: {}, // Will be populated by beforeCreate hook
      activityLog: [activityEntry],
    });
  }

  /**
   * Check for merge conflicts on-the-fly
   * Compares: base (when approval flow was created) vs live (current state) vs proposed
   * 
   * @param baseState - Entity state at baseVersion (when approval flow was created)
   * @param liveState - Current entity state
   * @param proposedChanges - Changes proposed in the approval flow
   * @returns MergeResult with conflict information and merged changes if possible
   */
  public checkMergeConflicts(
    baseState: Record<string, unknown>,
    liveState: Record<string, unknown>,
    proposedChanges: Record<string, unknown>
  ): MergeResult {
    return checkMergeConflicts(baseState, liveState, proposedChanges);
  }

  /**
   * Rebase an approval flow onto the current entity version
   * Updates the proposed changes after resolving conflicts
   */
  public async rebase(
    approvalFlowId: string,
    resolvedChanges: Record<string, unknown>,
    userId: string
  ): Promise<ApprovalFlowInterface> {
    const approvalFlow = await this.getById(approvalFlowId);
    if (!approvalFlow) {
      throw new Error("Approval flow not found");
    }

    // Only author can rebase
    if (approvalFlow.author !== userId) {
      throw new Error("Only the author can rebase");
    }

    // Can't rebase merged or closed flows
    if (approvalFlow.status === "merged" || approvalFlow.status === "closed") {
      throw new Error(
        `Cannot rebase ${approvalFlow.status} approval flow`
      );
    }

    const now = new Date();
    const activityEntry: ActivityLogEntry = {
      id: uniqid("activity_"),
      userId,
      action: "updated",
      details: "Resolved merge conflicts",
      createdAt: now,
    };

    return await this.updateById(approvalFlowId, {
      proposedChanges: resolvedChanges,
      activityLog: [...approvalFlow.activityLog, activityEntry],
    });
  }

  /**
   * Get a diff showing what would change if this approval flow is merged
   * @param baseState - Entity state at baseVersion
   * @param liveState - Current entity state  
   * @param proposedChanges - Changes proposed in the approval flow
   */
  public getDiff(
    baseState: Record<string, unknown>,
    liveState: Record<string, unknown>,
    proposedChanges: Record<string, unknown>
  ): {
    added: Array<{ field: string; value: unknown }>;
    modified: Array<{ field: string; from: unknown; to: unknown }>;
    removed: Array<{ field: string; value: unknown }>;
    conflicted: Array<{
      field: string;
      base: unknown;
      live: unknown;
      proposed: unknown;
    }>;
  } {
    const added: Array<{ field: string; value: unknown }> = [];
    const modified: Array<{ field: string; from: unknown; to: unknown }> = [];
    const removed: Array<{ field: string; value: unknown }> = [];
    const conflicted: Array<{
      field: string;
      base: unknown;
      live: unknown;
      proposed: unknown;
    }> = [];

    for (const field of Object.keys(proposedChanges)) {
      const baseValue = baseState[field];
      const liveValue = liveState[field];
      const proposedValue = proposedChanges[field];

      const liveChanged = !isEqual(baseValue, liveValue);
      const proposedChanged = !isEqual(baseValue, proposedValue);

      // Check for conflicts first
      if (
        liveChanged &&
        proposedChanged &&
        !isEqual(liveValue, proposedValue)
      ) {
        conflicted.push({
          field,
          base: baseValue,
          live: liveValue,
          proposed: proposedValue,
        });
        continue;
      }

      // Categorize the change
      if (proposedValue === undefined || proposedValue === null) {
        if (field in liveState) {
          removed.push({ field, value: liveValue });
        }
      } else if (!(field in liveState)) {
        added.push({ field, value: proposedValue });
      } else if (!isEqual(liveValue, proposedValue)) {
        modified.push({ field, from: liveValue, to: proposedValue });
      }
    }

    return {
      added,
      modified,
      removed,
      conflicted,
    };
  }
}