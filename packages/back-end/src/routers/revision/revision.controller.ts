import type { Response } from "express";
import { isEqual } from "lodash";
import {
  Revision,
  RevisionTargetType,
  Conflict,
  ReviewDecision,
  checkMergeConflicts,
  JsonPatchOperation,
  normalizeProposedChanges,
} from "shared/enterprise";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import { RevisionModel } from "back-end/src/models/RevisionModel";
import { getAdapter, getEntityModel } from "back-end/src/revisions";
import { applyPatchToSnapshot } from "back-end/src/revisions/util";

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
    proposedChanges: JsonPatchOperation[];
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
  if (!getAdapter(entityType).canCreate(context, originalEntity as Record<string, unknown>)) {
    context.permissions.throwPermissionError();
  }

  const revisionModel = new RevisionModel(context);

  const revision = await revisionModel.createRequest({
    type: entityType,
    id: entityId,
    snapshot: originalEntity as Record<string, unknown>,
    proposedChanges,
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
  if (
    !getAdapter(existingRevision.target.type).canUpdate(
      context,
      existingRevision.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
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

  // Cannot review merged or discarded revisions
  if (
    existingRevision.status === "merged" ||
    existingRevision.status === "discarded"
  ) {
    return res
      .status(400)
      .json({ message: "Cannot review a discarded or merged revision" });
  }

  // Prevent self-review (author cannot approve or request changes on own revision)
  if (existingRevision.authorId === userId && decision !== "comment") {
    return res.status(403).json({
      message: "Cannot approve or request changes on your own revision",
    });
  }

  // Must have permission to edit the underlying entity
  if (
    !getAdapter(existingRevision.target.type).canUpdate(
      context,
      existingRevision.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
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
    proposedChanges: JsonPatchOperation[];
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
    existingRevision.status === "discarded"
  ) {
    return res.status(400).json({
      message:
        "Cannot update proposed changes on a discarded or merged revision",
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

  // Cannot update title of merged/discarded revisions
  if (
    existingRevision.status === "merged" ||
    existingRevision.status === "discarded"
  ) {
    return res.status(400).json({
      message: "Cannot update title of a merged or discarded revision",
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
    strategies: Record<string, "discard" | "overwrite" | "union">;
    customValues?: Record<string, unknown[]>;
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
  const { strategies, customValues } = req.body;

  const revisionModel = new RevisionModel(context);

  const revision = await revisionModel.getById(id);
  if (!revision) {
    return res.status(404).json({ message: "Revision not found" });
  }
  if (revision.status === "merged" || revision.status === "discarded") {
    return res.status(400).json({
      message: "Cannot rebase merged or discarded revisions",
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
  const existingOps = normalizeProposedChanges(revision.target.proposedChanges);
  const liveSnapshot = liveState as Record<string, unknown>;

  const mergeResult = checkMergeConflicts(
    baseSnapshot,
    liveSnapshot,
    existingOps,
  );

  const conflicts = mergeResult.conflicts || [];

  // Validate all conflicts have a strategy
  for (const conflict of conflicts) {
    const strategy = strategies[conflict.field];
    if (
      strategy !== "overwrite" &&
      strategy !== "discard" &&
      strategy !== "union"
    ) {
      return res.status(400).json({
        message: `Please resolve conflict for field: ${conflict.field}`,
      });
    }
  }

  const conflictFields = new Set(conflicts.map((c) => c.field));

  // Build resolved patch ops relative to the new live state:
  // - Non-conflicting ops: keep if they still differ from the live value
  // - Conflict "overwrite": keep the proposed op
  // - Conflict "discard": drop the op (live value wins)
  // - Conflict "union": build a merged array op
  const newOps: JsonPatchOperation[] = [];
  const seenFields = new Set<string>();

  for (const op of existingOps) {
    const field = op.path.split("/")[1];
    if (!field || seenFields.has(field)) continue;
    seenFields.add(field);

    if (!conflictFields.has(field)) {
      const proposedValue =
        op.op === "replace" || op.op === "add" ? op.value : undefined;
      if (
        proposedValue !== undefined &&
        !isEqual(proposedValue, liveSnapshot[field])
      ) {
        newOps.push(op);
      }
    } else {
      const strategy = strategies[field];
      const conflict = conflicts.find((c) => c.field === field);
      if (strategy === "overwrite" && conflict) {
        if (
          conflict.proposedValue != null &&
          !isEqual(conflict.proposedValue, liveSnapshot[field])
        ) {
          newOps.push({ op: "replace", path: `/${field}`, value: conflict.proposedValue });
        }
      } else if (strategy === "union" && conflict) {
        const custom = customValues?.[field];
        let resolvedValue: unknown;
        if (custom !== undefined) {
          resolvedValue = custom;
        } else if (
          Array.isArray(conflict.liveValue) &&
          Array.isArray(conflict.proposedValue)
        ) {
          const seen = new Set<string>();
          const result: unknown[] = [];
          for (const item of [
            ...(conflict.liveValue as unknown[]),
            ...(conflict.proposedValue as unknown[]),
          ]) {
            const key =
              typeof item === "object" ? JSON.stringify(item) : String(item);
            if (!seen.has(key)) {
              seen.add(key);
              result.push(item);
            }
          }
          resolvedValue = result;
        } else {
          resolvedValue = conflict.proposedValue;
        }
        if (resolvedValue != null && !isEqual(resolvedValue, liveSnapshot[field])) {
          newOps.push({ op: "replace", path: `/${field}`, value: resolvedValue });
        }
      }
      // "discard" → drop op
    }
  }

  // Update the revision with new snapshot (current live) and resolved patch ops
  const updatedRevision = await revisionModel.rebase(
    id,
    liveSnapshot,
    newOps,
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
  if (revision.status === "merged" || revision.status === "discarded") {
    return res.status(400).json({
      message: "Cannot merge a discarded or already-merged revision",
    });
  }

  const adapter = getAdapter(revision.target.type);
  const entityModel = adapter.getModel(context);
  if (!entityModel) {
    return res.status(400).json({ message: "Unsupported entity type" });
  }
  const entity = await entityModel.getById(revision.target.id);
  if (!entity) {
    return res.status(404).json({ message: "Entity not found" });
  }

  // Check edit permission
  if (!adapter.canUpdate(context, entity as Record<string, unknown>)) {
    context.permissions.throwPermissionError();
  }

  const approvalRequired = adapter.isApprovalRequired(context);
  const canBypass = adapter.canBypassApproval(context, entity as Record<string, unknown>);

  // If approval is required: must be approved OR user can bypass
  // If approval is not required: can always publish
  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    return res.status(400).json({
      message: "The revision must be approved before it can be published",
    });
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  // Apply patch ops to snapshot to derive the desired final state
  const desiredState = applyPatchToSnapshot(
    revision.target.snapshot as Record<string, unknown>,
    normalizeProposedChanges(revision.target.proposedChanges),
  );

  // Check for merge conflicts before applying
  const conflictResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    entity as Record<string, unknown>,
    normalizeProposedChanges(revision.target.proposedChanges),
  );
  if (!conflictResult.success) {
    return res.status(400).json({
      message:
        "Cannot merge: there are conflicts with the current state. Please rebase first.",
    });
  }

  // Check whether there are any updatable fields that actually differ.
  // The adapter defines which fields may be written; we skip metadata fields.
  const updatableFields = adapter.getUpdatableFields();
  const hasChanges = Object.keys(desiredState).some((key) => {
    if (!updatableFields.has(key)) return false;
    return !isEqual(desiredState[key], (entity as Record<string, unknown>)[key]);
  });

  if (!hasChanges) {
    return res.status(400).json({
      message: "Cannot publish: no changes detected in this revision",
    });
  }

  // Apply entity update FIRST, then mark revision as merged (defensive write ordering)
  await adapter.applyChanges(
    context,
    entity as Record<string, unknown>,
    desiredState,
  );

  const mergedRevision = await revisionModel.merge(id, userId, {
    bypass: isBypass,
  });
  return res.status(200).json({ status: 200, revision: mergedRevision });
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
    existingRevision.status === "discarded"
  ) {
    return res.status(400).json({
      message: "Cannot discard an already discarded or merged revision",
    });
  }

  if (existingRevision.authorId !== userId) {
    // Also allow entity editors to close
    if (
      !getAdapter(existingRevision.target.type).canUpdate(
        context,
        existingRevision.target.snapshot as Record<string, unknown>,
      )
    ) {
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
 * Reopen a discarded revision
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

  // Only discarded revisions can be reopened (not merged)
  if (existingRevision.status !== "discarded") {
    return res.status(400).json({
      message: "Only discarded revisions can be reopened",
    });
  }

  if (existingRevision.authorId !== userId) {
    // Also allow entity editors to reopen
    if (
      !getAdapter(existingRevision.target.type).canUpdate(
        context,
        existingRevision.target.snapshot as Record<string, unknown>,
      )
    ) {
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
    normalizeProposedChanges(revision.target.proposedChanges),
  );

  res.status(200).json({
    status: 200,
    hasConflicts: !result.success,
    conflicts: result.conflicts,
    canAutoMerge: result.canAutoMerge,
  });
};

// endregion GET /revision/:id/conflicts
