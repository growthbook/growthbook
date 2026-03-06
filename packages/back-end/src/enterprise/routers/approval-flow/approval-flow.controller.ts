import type { Response } from "express";
import {
  ApprovalFlow,
  ApprovalFlowTargetType,
  Conflict,
  ReviewDecision,
  checkMergeConflicts,
} from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import { UpdateProps } from "shared/types/base-model";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import { ApprovalFlowModel } from "back-end/src/enterprise/models/ApprovalFlowModel";
import { getEntityModel } from "back-end/src/enterprise/approval-flows";
import { ensureNoOpenFlowForAuthor } from "back-end/src/enterprise/approval-flows/util";

// region GET /approval-flow

type GetAllApprovalFlowsRequest = AuthRequest;

type GetAllApprovalFlowsResponse = {
  status: 200;
  approvalFlows: ApprovalFlow[];
};

/**
 * GET /approval-flow
 * Get all approval flows for the organization
 * @param req
 * @param res
 */
export const getAllApprovalFlows = async (
  req: GetAllApprovalFlowsRequest,
  res: Response<GetAllApprovalFlowsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlows = await approvalFlowModel.getAll();

  res.status(200).json({
    status: 200,
    approvalFlows,
  });
};

// endregion GET /approval-flow

// region POST /approval-flow

type CreateApprovalFlowRequest = AuthRequest<{
  target: {
    type: ApprovalFlowTargetType;
    id: string;
    proposedChanges: Record<string, unknown>;
  };
}>;

type CreateApprovalFlowResponse = {
  status: 200;
  approvalFlow: ApprovalFlow;
};

/**
 * POST /approval-flow
 * Create a new approval flow
 * @param req
 * @param res
 */
export const postApprovalFlow = async (
  req: CreateApprovalFlowRequest,
  res: Response<CreateApprovalFlowResponse | ApiErrorResponse>,
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

  // Verify the caller can edit the underlying entity before creating a flow
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

  const approvalFlowModel = new ApprovalFlowModel(context);

  // Enforce per-author uniqueness: one open flow per resource per author
  await ensureNoOpenFlowForAuthor(
    approvalFlowModel,
    entityType,
    entityId,
    userId,
  );

  const approvalFlow = await approvalFlowModel.create({
    target: {
      type: entityType,
      id: entityId,
      snapshot: originalEntity as SavedGroupInterface,
      proposedChanges,
    },
    status: "pending-review",
    authorId: userId,
    reviews: [],
    activityLog: [],
  });

  res.status(200).json({
    status: 200,
    approvalFlow,
  });
};

// endregion POST /approval-flow

// region GET /approval-flow/entity/:entityType

type GetApprovalFlowsByEntityTypeRequest = AuthRequest<
  never,
  { entityType: ApprovalFlowTargetType }
>;

type GetApprovalFlowsByEntityTypeResponse = {
  status: 200;
  approvalFlows: ApprovalFlow[];
};

/**
 * GET /approval-flow/entity/:entityType
 * Get all approval flows for a specific entity type
 * @param req
 * @param res
 */
export const getApprovalFlowsByEntityType = async (
  req: GetApprovalFlowsByEntityTypeRequest,
  res: Response<GetApprovalFlowsByEntityTypeResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { entityType } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlows = await approvalFlowModel.getByTargetType(entityType);

  res.status(200).json({
    status: 200,
    approvalFlows,
  });
};
// endregion GET /approval-flow/entity/:entityType

// region GET /approval-flow/entity/:entityType/beacon

type GetApprovalFlowBeaconRequest = AuthRequest<
  never,
  { entityType: ApprovalFlowTargetType }
>;

type GetApprovalFlowBeaconResponse = {
  status: 200;
  openFlowTargetIds: string[];
};

/**
 * GET /approval-flow/entity/:entityType/beacon
 * Lightweight query returning just target IDs that have open approval flows.
 * Used by index pages to show badges without fetching full documents.
 */
export const getApprovalFlowBeacon = async (
  req: GetApprovalFlowBeaconRequest,
  res: Response<GetApprovalFlowBeaconResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { entityType } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const openFlowTargetIds =
    await approvalFlowModel.getOpenFlowTargetIds(entityType);

  res.status(200).json({
    status: 200,
    openFlowTargetIds,
  });
};

// endregion GET /approval-flow/entity/:entityType/beacon

// region GET /approval-flow/entity/:entityType/:entityId

type GetApprovalFlowsByEntityRequest = AuthRequest<
  never,
  { entityType: ApprovalFlowTargetType; entityId: string }
>;

type GetApprovalFlowsByEntityResponse = {
  status: 200;
  approvalFlows: ApprovalFlow[];
};

/**
 * GET /approval-flow/entity/:entityType/:entityId
 * Get all approval flows for a specific entity
 * @param req
 * @param res
 */
export const getApprovalFlowsByEntity = async (
  req: GetApprovalFlowsByEntityRequest,
  res: Response<GetApprovalFlowsByEntityResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { entityType, entityId } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlows = await approvalFlowModel.getByTarget(
    entityType,
    entityId,
  );

  res.status(200).json({
    status: 200,
    approvalFlows,
  });
};

// endregion GET /approval-flow/entity/:entityType/:entityId

// region GET /approval-flow/:id

type GetApprovalFlowRequest = AuthRequest<never, { id: string }>;

type GetApprovalFlowResponse = {
  status: 200;
  approvalFlow: ApprovalFlow;
};

/**
 * GET /approval-flow/:id
 * Get a specific approval flow by ID
 * @param req
 * @param res
 */
export const getApprovalFlow = async (
  req: GetApprovalFlowRequest,
  res: Response<GetApprovalFlowResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlow = await approvalFlowModel.getById(id);

  if (!approvalFlow) {
    return res.status(404).json({
      message: "Approval flow not found",
    });
  }

  res.status(200).json({
    status: 200,
    approvalFlow,
  });
};

// endregion GET /approval-flow/:id

// region POST /approval-flow/:id/review

type PostReviewRequest = AuthRequest<
  {
    decision: ReviewDecision;
    comment: string;
  },
  { id: string }
>;

type PostReviewResponse = {
  status: 200;
  approvalFlow: ApprovalFlow;
};

/**
 * POST /approval-flow/:id/review
 * Add a review to an approval flow
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

  const approvalFlowModel = new ApprovalFlowModel(context);

  const existingFlow = await approvalFlowModel.getById(id);
  if (!existingFlow) {
    return res.status(404).json({ message: "Approval flow not found" });
  }

  // Cannot review merged or closed flows
  if (existingFlow.status === "merged" || existingFlow.status === "closed") {
    return res
      .status(400)
      .json({ message: "Cannot review a closed or merged approval flow" });
  }

  // Prevent self-review (author cannot approve or request changes on own flow)
  if (existingFlow.authorId === userId && decision !== "comment") {
    return res.status(403).json({
      message: "Cannot approve or request changes on your own approval flow",
    });
  }

  // Must have permission to edit the underlying entity
  if (existingFlow.target.type === "saved-group") {
    const savedGroup = await context.models.savedGroups.getById(
      existingFlow.target.id,
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

  const approvalFlow = await approvalFlowModel.addReview(
    id,
    userId,
    decision,
    comment,
  );

  res.status(200).json({
    status: 200,
    approvalFlow,
  });
};

// endregion POST /approval-flow/:id/review

// region PUT /approval-flow/:id/proposed-changes

type PutProposedChangesRequest = AuthRequest<
  {
    proposedChanges: Record<string, unknown>;
  },
  { id: string }
>;

type PutProposedChangesResponse = {
  status: 200;
  approvalFlow: ApprovalFlow;
};

/**
 * PUT /approval-flow/:id/proposed-changes
 * Update the proposed changes in an approval flow
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

  const approvalFlowModel = new ApprovalFlowModel(context);

  const existingFlow = await approvalFlowModel.getById(id);
  if (!existingFlow) {
    return res.status(404).json({ message: "Approval flow not found" });
  }
  if (existingFlow.status === "merged" || existingFlow.status === "closed") {
    return res.status(400).json({
      message:
        "Cannot update proposed changes on a closed or merged approval flow",
    });
  }
  if (existingFlow.authorId !== userId) {
    return res
      .status(403)
      .json({ message: "Only the author can update proposed changes" });
  }

  const approvalFlow = await approvalFlowModel.updateProposedChanges(
    id,
    proposedChanges,
    userId,
  );

  res.status(200).json({
    status: 200,
    approvalFlow,
  });
};

// endregion PUT /approval-flow/:id/proposed-changes

// region POST /approval-flow/:id/merge

type PostMergeRequest = AuthRequest<never, { id: string }>;

type PostMergeResponse = {
  status: 200;
  approvalFlow: ApprovalFlow;
};

/**
 * POST /approval-flow/:id/merge
 * Merge an approval flow (apply the changes)
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

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlow = await approvalFlowModel.getById(id);

  if (!approvalFlow) {
    return res.status(404).json({
      message: "Approval flow not found",
    });
  }

  // Terminal status guard — prevents re-merging already-completed flows
  if (approvalFlow.status === "merged" || approvalFlow.status === "closed") {
    return res.status(400).json({
      message: "Cannot merge a closed or already-merged approval flow",
    });
  }

  if (approvalFlow.target.type === "saved-group") {
    const savedGroup = await context.models.savedGroups.getById(
      approvalFlow.target.id,
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

    // Must be approved OR user can bypass
    if (approvalFlow.status !== "approved" && !canBypass) {
      return res.status(400).json({
        message:
          "The approval flow must be approved before it can be published",
      });
    }

    const isBypass = approvalFlow.status !== "approved";

    // Check for merge conflicts before applying
    const conflictResult = checkMergeConflicts(
      approvalFlow.target.snapshot as unknown as Record<string, unknown>,
      savedGroup as unknown as Record<string, unknown>,
      approvalFlow.target.proposedChanges as Record<string, unknown>,
    );
    if (!conflictResult.success) {
      return res.status(400).json({
        message:
          "Cannot merge: there are conflicts with the current state. Please rebase first.",
      });
    }

    // Apply entity update FIRST, then mark flow as merged (defensive write ordering)
    await context.models.savedGroups.update(
      savedGroup,
      approvalFlow.target.proposedChanges as UpdateProps<SavedGroupInterface>,
    );
    const mergedApprovalFlow = await approvalFlowModel.merge(id, userId, {
      bypass: isBypass,
    });
    return res
      .status(200)
      .json({ status: 200, approvalFlow: mergedApprovalFlow });
  }

  // Exhaustive check for future entity types
  const _exhaustive: never = approvalFlow.target.type;
  throw new Error(`Unsupported entity type for merge: ${_exhaustive}`);
};

// endregion POST /approval-flow/:id/merge

// region POST /approval-flow/:id/close

type PostCloseRequest = AuthRequest<
  {
    reason?: string;
  },
  { id: string }
>;

type PostCloseResponse = {
  status: 200;
  approvalFlow: ApprovalFlow;
};

/**
 * POST /approval-flow/:id/close
 * Close an approval flow without merging
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

  const approvalFlowModel = new ApprovalFlowModel(context);

  const existingFlow = await approvalFlowModel.getById(id);
  if (!existingFlow) {
    return res.status(404).json({ message: "Approval flow not found" });
  }

  if (existingFlow.status === "merged" || existingFlow.status === "closed") {
    return res.status(400).json({
      message: "Cannot close an already closed or merged approval flow",
    });
  }

  if (existingFlow.authorId !== userId) {
    // Also allow entity editors to close
    if (existingFlow.target.type === "saved-group") {
      const savedGroup = await context.models.savedGroups.getById(
        existingFlow.target.id,
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

  const approvalFlow = await approvalFlowModel.close(id, userId, reason);

  res.status(200).json({
    status: 200,
    approvalFlow,
  });
};

// endregion POST /approval-flow/:id/close

// region POST /approval-flow/:id/reopen

type PostReopenRequest = AuthRequest<never, { id: string }>;

type PostReopenResponse = {
  status: 200;
  approvalFlow: ApprovalFlow;
};

/**
 * POST /approval-flow/:id/reopen
 * Reopen a closed approval flow
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

  const approvalFlowModel = new ApprovalFlowModel(context);

  const existingFlow = await approvalFlowModel.getById(id);
  if (!existingFlow) {
    return res.status(404).json({ message: "Approval flow not found" });
  }

  // Only closed flows can be reopened (not merged)
  if (existingFlow.status !== "closed") {
    return res.status(400).json({
      message: "Only closed approval flows can be reopened",
    });
  }

  if (existingFlow.authorId !== userId) {
    // Also allow entity editors to reopen
    if (existingFlow.target.type === "saved-group") {
      const savedGroup = await context.models.savedGroups.getById(
        existingFlow.target.id,
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

  // Enforce per-author uniqueness: cannot reopen if author already has an open flow on this resource
  await ensureNoOpenFlowForAuthor(
    approvalFlowModel,
    existingFlow.target.type,
    existingFlow.target.id,
    existingFlow.authorId,
  );

  const approvalFlow = await approvalFlowModel.reopen(id, userId);

  res.status(200).json({
    status: 200,
    approvalFlow,
  });
};

// endregion POST /approval-flow/:id/reopen

// region GET /approval-flow/entity/:entityType/:entityId/history

type GetRevisionHistoryRequest = AuthRequest<
  never,
  { entityType: ApprovalFlowTargetType; entityId: string }
>;

type GetRevisionHistoryResponse = {
  status: 200;
  approvalFlows: ApprovalFlow[];
};

/**
 * GET /approval-flow/entity/:entityType/:entityId/history
 * Get revision history (all merged approval flows) for an entity
 * @param req
 * @param res
 */
export const getRevisionHistory = async (
  req: GetRevisionHistoryRequest,
  res: Response<GetRevisionHistoryResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { entityType, entityId } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlows = await approvalFlowModel.getEntityRevisionHistory(
    entityType,
    entityId,
  );

  res.status(200).json({
    status: 200,
    approvalFlows,
  });
};

// endregion GET /approval-flow/entity/:entityType/:entityId/history

// region GET /approval-flow/:id/conflicts

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

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlow = await approvalFlowModel.getById(id);
  if (!approvalFlow) {
    return res.status(404).json({ message: "Approval flow not found" });
  }

  const entityModel = getEntityModel(context, approvalFlow.target.type);
  if (!entityModel) {
    return res
      .status(400)
      .json({ message: "Entity model not found for entity type" });
  }
  const liveEntity = await entityModel.getById(approvalFlow.target.id);
  if (!liveEntity) {
    return res.status(404).json({ message: "Entity not found" });
  }

  const result = checkMergeConflicts(
    approvalFlow.target.snapshot as unknown as Record<string, unknown>,
    liveEntity as Record<string, unknown>,
    approvalFlow.target.proposedChanges as Record<string, unknown>,
  );

  res.status(200).json({
    status: 200,
    hasConflicts: !result.success,
    conflicts: result.conflicts,
    canAutoMerge: result.canAutoMerge,
  });
};

// endregion GET /approval-flow/:id/conflicts
