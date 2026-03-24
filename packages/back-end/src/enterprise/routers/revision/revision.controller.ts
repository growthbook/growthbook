import type { Response } from "express";
import { isEqual } from "lodash";
import {
  Revision,
  RevisionTargetType,
  Conflict,
  ReviewDecision,
  checkMergeConflicts,
} from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import { UpdateProps } from "shared/types/base-model";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import { RevisionModel } from "back-end/src/enterprise/models/RevisionModel";
import { getEntityModel } from "back-end/src/enterprise/revisions";

// region GET /revision

type GetAllRevisionsRequest = AuthRequest;

type GetAllRevisionsResponse = {
  status: 200;
  revisions: Revision[];
};

/**
 * GET /revision
 * Get all revisions for the organization
 * @param req
 * @param res
 */
export const getAllRevisions = async (
  req: GetAllRevisionsRequest,
  res: Response<GetAllRevisionsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  const revisionModel = new RevisionModel(context);
  const revisions = await revisionModel.getAll();

  res.status(200).json({
    status: 200,
    revisions,
  });
};

// endregion GET /revision

// region POST /revision

type CreateRevisionRequest = AuthRequest<{
  target: {
    type: RevisionTargetType;
    id: string;
    proposedChanges: Record<string, unknown>;
  };
}>;

type CreateRevisionResponse = {
  status: 200;
  revision: Revision;
};

/**
 * POST /revision
 * Create a new revision
 * @param req
 * @param res
 */
export const postRevision = async (
  req: CreateRevisionRequest,
  res: Response<CreateRevisionResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;

  const { target } = req.body;
  const { type: entityType, id: entityId, proposedChanges } = target;

  const entityModel = getEntityModel(context, entityType);
  if (!entityModel) {
    throw new Error(`Entity model not found for entity type: ${entityType}`);
  }
  const originalEntity = await entityModel.getById(entityId);
  if (!originalEntity) {
    throw new Error(
      `Original entity not found for entity type: ${entityType} and entity id: ${entityId}`,
    );
  }

  // Verify the caller can edit the underlying entity before creating a revision
  if (entityType === "saved-group") {
    if (
      !context.permissions.canUpdateSavedGroup(
        originalEntity as SavedGroupInterface,
        {},
      )
    ) {
      context.permissions.throwPermissionError();
    }
  }

  const revisionModel = new RevisionModel(context);

  const revision = await revisionModel.create({
    target: {
      type: entityType,
      id: entityId,
      snapshot: originalEntity as SavedGroupInterface,
      proposedChanges,
    },
    status: "draft",
    authorId: userId,
    reviews: [],
    activityLog: [],
  });

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion POST /revision

// region GET /revision/entity/:entityType

type GetRevisionsByEntityTypeRequest = AuthRequest<
  never,
  { entityType: RevisionTargetType }
>;

type GetRevisionsByEntityTypeResponse = {
  status: 200;
  revisions: Revision[];
};

/**
 * GET /revision/entity/:entityType
 * Get all revisions for a specific entity type
 * @param req
 * @param res
 */
export const getRevisionsByEntityType = async (
  req: GetRevisionsByEntityTypeRequest,
  res: Response<GetRevisionsByEntityTypeResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { entityType } = req.params;

  const revisionModel = new RevisionModel(context);
  const revisions = await revisionModel.getByTargetType(entityType);

  res.status(200).json({
    status: 200,
    revisions,
  });
};
// endregion GET /revision/entity/:entityType

// region GET /revision/entity/:entityType/beacon

type GetRevisionBeaconRequest = AuthRequest<
  never,
  { entityType: RevisionTargetType }
>;

type GetRevisionBeaconResponse = {
  status: 200;
  openRevisionTargetIds: string[];
};

/**
 * GET /revision/entity/:entityType/beacon
 * Lightweight query returning just target IDs that have open revisions.
 * Used by index pages to show badges without fetching full documents.
 */
export const getRevisionBeacon = async (
  req: GetRevisionBeaconRequest,
  res: Response<GetRevisionBeaconResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { entityType } = req.params;

  const revisionModel = new RevisionModel(context);
  const openRevisionTargetIds =
    await revisionModel.getOpenRevisionTargetIds(entityType);

  res.status(200).json({
    status: 200,
    openRevisionTargetIds,
  });
};

// endregion GET /revision/entity/:entityType/beacon

// region GET /revision/entity/:entityType/:entityId

type GetRevisionsByEntityRequest = AuthRequest<
  never,
  { entityType: RevisionTargetType; entityId: string }
>;

type GetRevisionsByEntityResponse = {
  status: 200;
  revisions: Revision[];
};

/**
 * GET /revision/entity/:entityType/:entityId
 * Get all revisions for a specific entity
 * @param req
 * @param res
 */
export const getRevisionsByEntity = async (
  req: GetRevisionsByEntityRequest,
  res: Response<GetRevisionsByEntityResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { entityType, entityId } = req.params;

  const revisionModel = new RevisionModel(context);
  const revisions = await revisionModel.getByTarget(entityType, entityId);

  res.status(200).json({
    status: 200,
    revisions,
  });
};

// endregion GET /revision/entity/:entityType/:entityId

// region GET /revision/:id

type GetRevisionRequest = AuthRequest<never, { id: string }>;

type GetRevisionResponse = {
  status: 200;
  revision: Revision;
};

/**
 * GET /revision/:id
 * Get a specific revision by ID
 * @param req
 * @param res
 */
export const getRevision = async (
  req: GetRevisionRequest,
  res: Response<GetRevisionResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const revisionModel = new RevisionModel(context);
  const revision = await revisionModel.getById(id);

  if (!revision) {
    return res.status(404).json({
      message: "Revision not found",
    });
  }

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion GET /revision/:id

// region POST /revision/:id/submit

type PostSubmitRequest = AuthRequest<Record<string, never>, { id: string }>;

type PostSubmitResponse = {
  status: 200;
  revision: Revision;
};

/**
 * POST /revision/:id/submit
 * Submit a draft revision for review (changes status from "draft" to "pending-review")
 * @param req
 * @param res
 */
export const postSubmit = async (
  req: PostSubmitRequest,
  res: Response<PostSubmitResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;

  const revisionModel = new RevisionModel(context);

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Can only submit drafts
  if (existingRevision.status !== "draft") {
    return res.status(400).json({
      message: "Only draft revisions can be submitted for review",
    });
  }

  // Only the author can submit their own draft
  if (existingRevision.authorId !== userId) {
    return res.status(403).json({
      message: "Only the revision author can submit it for review",
    });
  }

  // Must have permission to edit the underlying entity
  if (existingRevision.target.type === "saved-group") {
    const savedGroup = await context.models.savedGroups.getById(
      existingRevision.target.id,
    );
    if (!savedGroup) {
      return res
        .status(404)
        .json({ message: "Underlying saved group not found" });
    }
    if (!context.permissions.canUpdateSavedGroup(savedGroup, {})) {
      context.permissions.throwPermissionError();
    }
  }

  const revision = await revisionModel.submitForReview(id, userId);

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion POST /revision/:id/submit

// region POST /revision/:id/review

type PostReviewRequest = AuthRequest<
  {
    decision: ReviewDecision;
    comment: string;
  },
  { id: string }
>;

type PostReviewResponse = {
  status: 200;
  revision: Revision;
};

/**
 * POST /revision/:id/review
 * Add a review to a revision
 * @param req
 * @param res
 */
export const postReview = async (
  req: PostReviewRequest,
  res: Response<PostReviewResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;
  const { decision, comment } = req.body;

  const revisionModel = new RevisionModel(context);

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Cannot review merged or closed revisions
  if (
    existingRevision.status === "merged" ||
    existingRevision.status === "closed"
  ) {
    return res
      .status(400)
      .json({ message: "Cannot review a closed or merged revision" });
  }

  // Prevent self-review (author cannot approve or request changes on own revision)
  if (existingRevision.authorId === userId && decision !== "comment") {
    return res.status(403).json({
      message: "Cannot approve or request changes on your own revision",
    });
  }

  // Must have permission to edit the underlying entity
  if (existingRevision.target.type === "saved-group") {
    const savedGroup = await context.models.savedGroups.getById(
      existingRevision.target.id,
    );
    if (!savedGroup) {
      return res
        .status(404)
        .json({ message: "Underlying saved group not found" });
    }
    if (!context.permissions.canUpdateSavedGroup(savedGroup, {})) {
      context.permissions.throwPermissionError();
    }
  }

  const revision = await revisionModel.addReview(id, userId, decision, comment);

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion POST /revision/:id/review

// region PUT /revision/:id/proposed-changes

type PutProposedChangesRequest = AuthRequest<
  {
    proposedChanges: Record<string, unknown>;
  },
  { id: string }
>;

type PutProposedChangesResponse = {
  status: 200;
  revision: Revision;
};

/**
 * PUT /revision/:id/proposed-changes
 * Update the proposed changes in a revision
 * @param req
 * @param res
 */
export const putProposedChanges = async (
  req: PutProposedChangesRequest,
  res: Response<PutProposedChangesResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;
  const { proposedChanges } = req.body;

  const revisionModel = new RevisionModel(context);

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }
  if (
    existingRevision.status === "merged" ||
    existingRevision.status === "closed"
  ) {
    return res.status(400).json({
      message: "Cannot update proposed changes on a closed or merged revision",
    });
  }
  if (existingRevision.authorId !== userId) {
    return res
      .status(403)
      .json({ message: "Only the author can update proposed changes" });
  }

  const revision = await revisionModel.updateProposedChanges(
    id,
    proposedChanges,
    userId,
  );

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion PUT /revision/:id/proposed-changes

// region PATCH /revision/:id/title

type PatchTitleRequest = AuthRequest<
  {
    title: string;
  },
  { id: string }
>;

type PatchTitleResponse = {
  status: 200;
  revision: Revision;
};

/**
 * PATCH /revision/:id/title
 * Update the title of a revision
 * @param req
 * @param res
 */
export const patchTitle = async (
  req: PatchTitleRequest,
  res: Response<PatchTitleResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { title } = req.body;

  const revisionModel = new RevisionModel(context);

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Only the author can update the title
  if (existingRevision.authorId !== context.userId) {
    return res.status(403).json({
      message: "Only the revision author can update the title",
    });
  }

  // Cannot update title of merged/closed revisions
  if (
    existingRevision.status === "merged" ||
    existingRevision.status === "closed"
  ) {
    return res.status(400).json({
      message: "Cannot update title of a merged or closed revision",
    });
  }

  const revision = await revisionModel.update(existingRevision, {
    title,
  });

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion PATCH /revision/:id/title

// region POST /revision/:id/rebase

type PostRebaseRequest = AuthRequest<
  {
    strategies: Record<string, "discard" | "overwrite">;
    mergeResultSerialized: string;
  },
  { id: string }
>;

type PostRebaseResponse = {
  status: 200;
  revision: Revision;
};

/**
 * POST /revision/:id/rebase
 * Rebase a revision on top of the current live state, resolving conflicts
 * @param req
 * @param res
 */
export const postRebase = async (
  req: PostRebaseRequest,
  res: Response<PostRebaseResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;
  const { strategies } = req.body;

  const revisionModel = new RevisionModel(context);

  const revision = await revisionModel.getById(id);
  if (!revision) {
    return res.status(404).json({ message: "Revision not found" });
  }
  if (revision.status === "merged" || revision.status === "closed") {
    return res.status(400).json({
      message: "Cannot rebase merged or closed revisions",
    });
  }
  if (revision.authorId !== userId) {
    return res
      .status(403)
      .json({ message: "Only the author can rebase their revision" });
  }

  // Get the current live state
  const entityModel = getEntityModel(context, revision.target.type);
  if (!entityModel) {
    return res.status(400).json({ message: "Unsupported entity type" });
  }
  const entity = await entityModel.getById(revision.target.id);
  if (!entity) {
    return res.status(404).json({ message: "Entity not found" });
  }
  const liveState = entity as Record<string, unknown>;

  // Recalculate merge result to ensure it's still valid
  const baseSnapshot = revision.target.snapshot as Record<string, unknown>;
  const proposedChanges = revision.target.proposedChanges as Record<
    string,
    unknown
  >;
  const liveSnapshot = liveState as Record<string, unknown>;

  const mergeResult = checkMergeConflicts(
    baseSnapshot,
    liveSnapshot,
    proposedChanges,
  );

  // Apply strategies to resolve conflicts
  const resolvedChanges: Record<string, unknown> = { ...liveSnapshot };
  const conflicts = mergeResult.conflicts || [];

  for (const conflict of conflicts) {
    const strategy = strategies[conflict.field];
    if (strategy === "overwrite") {
      // Only apply overwrite if the proposed value is not null/undefined
      if (conflict.proposedValue != null) {
        resolvedChanges[conflict.field] = conflict.proposedValue;
      }
    } else if (strategy === "discard") {
      // Keep the live value (do nothing)
    } else {
      return res.status(400).json({
        message: `Please resolve conflict for field: ${conflict.field}`,
      });
    }
  }

  // Include non-conflicting proposed changes (skip null/undefined values)
  Object.keys(proposedChanges).forEach((field) => {
    const value = proposedChanges[field];
    // Skip null/undefined - these represent untouched fields
    if (value != null && !conflicts.find((c) => c.field === field)) {
      resolvedChanges[field] = value;
    }
  });

  // Calculate new proposed changes relative to live state
  // Skip null/undefined values - only include actual changes
  const newProposedChanges: Record<string, unknown> = {};
  Object.keys(resolvedChanges).forEach((field) => {
    const value = resolvedChanges[field];
    // Skip null/undefined values
    if (value != null && !isEqual(value, liveSnapshot[field])) {
      newProposedChanges[field] = value;
    }
  });

  // Update the revision with new snapshot and proposed changes
  const updatedRevision = await revisionModel.rebase(
    id,
    liveSnapshot,
    newProposedChanges,
    userId,
  );

  res.status(200).json({
    status: 200,
    revision: updatedRevision,
  });
};

// endregion POST /revision/:id/rebase

// region POST /revision/:id/merge

type PostMergeRequest = AuthRequest<never, { id: string }>;

type PostMergeResponse = {
  status: 200;
  revision: Revision;
};

/**
 * POST /revision/:id/merge
 * Merge a revision (apply the changes)
 * @param req
 * @param res
 */
export const postMerge = async (
  req: PostMergeRequest,
  res: Response<PostMergeResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;

  const revisionModel = new RevisionModel(context);
  const revision = await revisionModel.getById(id);

  if (!revision) {
    return res.status(404).json({
      message: "Revision not found",
    });
  }

  // Terminal status guard — prevents re-merging already-completed revisions
  if (revision.status === "merged" || revision.status === "closed") {
    return res.status(400).json({
      message: "Cannot merge a closed or already-merged revision",
    });
  }

  if (revision.target.type === "saved-group") {
    const savedGroup = await context.models.savedGroups.getById(
      revision.target.id,
    );
    if (!savedGroup) {
      return res.status(404).json({ message: "Saved group not found" });
    }

    // Check edit permission
    if (!context.permissions.canUpdateSavedGroup(savedGroup, {})) {
      context.permissions.throwPermissionError();
    }

    const canBypass = context.permissions.canBypassApprovalChecks({
      project: savedGroup.projects?.[0] || "",
    });

    // Check if approval is required for saved groups
    const approvalRequired =
      context.org.settings?.approvalFlows?.savedGroups?.required || false;

    // If approval is required: must be approved OR user can bypass
    // If approval is not required: can always publish
    if (approvalRequired && revision.status !== "approved" && !canBypass) {
      return res.status(400).json({
        message: "The revision must be approved before it can be published",
      });
    }

    const isBypass = approvalRequired && revision.status !== "approved";

    // Clean up null values to undefined for Zod validation
    const proposedChanges = revision.target
      .proposedChanges as UpdateProps<SavedGroupInterface>;
    const cleanedChanges = Object.fromEntries(
      Object.entries(proposedChanges).map(([key, value]) => [
        key,
        value === null ? undefined : value,
      ]),
    ) as UpdateProps<SavedGroupInterface>;

    // Check if there are any actual changes
    const hasChanges = Object.keys(cleanedChanges).some((key) => {
      const newValue = cleanedChanges[key as keyof typeof cleanedChanges];
      const currentValue = savedGroup[key as keyof SavedGroupInterface];
      return JSON.stringify(newValue) !== JSON.stringify(currentValue);
    });

    if (!hasChanges) {
      return res.status(400).json({
        message: "Cannot publish: no changes detected in this revision",
      });
    }

    // Check for merge conflicts before applying
    const conflictResult = checkMergeConflicts(
      revision.target.snapshot as unknown as Record<string, unknown>,
      savedGroup as unknown as Record<string, unknown>,
      revision.target.proposedChanges as Record<string, unknown>,
    );
    if (!conflictResult.success) {
      return res.status(400).json({
        message:
          "Cannot merge: there are conflicts with the current state. Please rebase first.",
      });
    }

    // Apply entity update FIRST, then mark revision as merged (defensive write ordering)
    await context.models.savedGroups.update(savedGroup, cleanedChanges);
    const mergedRevision = await revisionModel.merge(id, userId, {
      bypass: isBypass,
    });
    return res.status(200).json({ status: 200, revision: mergedRevision });
  }

  // Exhaustive check for future entity types
  const _exhaustive: never = revision.target.type;
  throw new Error(`Unsupported entity type for merge: ${_exhaustive}`);
};

// endregion POST /revision/:id/merge

// region POST /revision/:id/close

type PostCloseRequest = AuthRequest<
  {
    reason?: string;
  },
  { id: string }
>;

type PostCloseResponse = {
  status: 200;
  revision: Revision;
};

/**
 * POST /revision/:id/close
 * Close a revision without merging
 * @param req
 * @param res
 */
export const postClose = async (
  req: PostCloseRequest,
  res: Response<PostCloseResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;
  const { reason } = req.body;

  const revisionModel = new RevisionModel(context);

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  if (
    existingRevision.status === "merged" ||
    existingRevision.status === "closed"
  ) {
    return res.status(400).json({
      message: "Cannot close an already closed or merged revision",
    });
  }

  if (existingRevision.authorId !== userId) {
    // Also allow entity editors to close
    if (existingRevision.target.type === "saved-group") {
      const savedGroup = await context.models.savedGroups.getById(
        existingRevision.target.id,
      );
      if (
        !savedGroup ||
        !context.permissions.canUpdateSavedGroup(savedGroup, {})
      ) {
        context.permissions.throwPermissionError();
      }
    } else {
      context.permissions.throwPermissionError();
    }
  }

  const revision = await revisionModel.close(id, userId, reason);

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion POST /revision/:id/close

// region POST /revision/:id/reopen

type PostReopenRequest = AuthRequest<never, { id: string }>;

type PostReopenResponse = {
  status: 200;
  revision: Revision;
};

/**
 * POST /revision/:id/reopen
 * Reopen a closed revision
 * @param req
 * @param res
 */
export const postReopen = async (
  req: PostReopenRequest,
  res: Response<PostReopenResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;

  const revisionModel = new RevisionModel(context);

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Only closed revisions can be reopened (not merged)
  if (existingRevision.status !== "closed") {
    return res.status(400).json({
      message: "Only closed revisions can be reopened",
    });
  }

  if (existingRevision.authorId !== userId) {
    // Also allow entity editors to reopen
    if (existingRevision.target.type === "saved-group") {
      const savedGroup = await context.models.savedGroups.getById(
        existingRevision.target.id,
      );
      if (
        !savedGroup ||
        !context.permissions.canUpdateSavedGroup(savedGroup, {})
      ) {
        context.permissions.throwPermissionError();
      }
    } else {
      context.permissions.throwPermissionError();
    }
  }

  const revision = await revisionModel.reopen(id, userId);

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion POST /revision/:id/reopen

// region GET /revision/entity/:entityType/:entityId/history

type GetRevisionHistoryRequest = AuthRequest<
  never,
  { entityType: RevisionTargetType; entityId: string }
>;

type GetRevisionHistoryResponse = {
  status: 200;
  revisions: Revision[];
};

/**
 * GET /revision/entity/:entityType/:entityId/history
 * Get revision history (all merged revisions) for an entity
 * @param req
 * @param res
 */
export const getRevisionHistory = async (
  req: GetRevisionHistoryRequest,
  res: Response<GetRevisionHistoryResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { entityType, entityId } = req.params;

  const revisionModel = new RevisionModel(context);
  const revisions = await revisionModel.getEntityRevisionHistory(
    entityType,
    entityId,
  );

  res.status(200).json({
    status: 200,
    revisions,
  });
};

// endregion GET /revision/entity/:entityType/:entityId/history

// region GET /revision/:id/conflicts

type GetConflictsRequest = AuthRequest<never, { id: string }>;

type GetConflictsResponse = {
  status: 200;
  hasConflicts: boolean;
  conflicts: Conflict[];
  canAutoMerge: boolean;
};

/**
 * GET /approval-flow/:id/conflicts
 * Check current merge conflict status vs live entity
 * @param req
 * @param res
 */
export const getConflicts = async (
  req: GetConflictsRequest,
  res: Response<GetConflictsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const revisionModel = new RevisionModel(context);
  const revision = await revisionModel.getById(id);
  if (!revision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  const entityModel = getEntityModel(context, revision.target.type);
  if (!entityModel) {
    return res
      .status(400)
      .json({ message: "Entity model not found for entity type" });
  }
  const liveEntity = await entityModel.getById(revision.target.id);
  if (!liveEntity) {
    return res.status(404).json({ message: "Entity not found" });
  }

  const result = checkMergeConflicts(
    revision.target.snapshot as unknown as Record<string, unknown>,
    liveEntity as Record<string, unknown>,
    revision.target.proposedChanges as Record<string, unknown>,
  );

  res.status(200).json({
    status: 200,
    hasConflicts: !result.success,
    conflicts: result.conflicts,
    canAutoMerge: result.canAutoMerge,
  });
};

// endregion GET /revision/:id/conflicts
