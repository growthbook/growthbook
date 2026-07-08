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
  isUserBlockedFromApproving,
} from "shared/enterprise";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { ConflictError, MergeConflictError } from "back-end/src/util/errors";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getAdapter,
  getApprovalEnabledEntityTypes,
  getEntityModel,
} from "back-end/src/revisions";
import { isRevisionDiverged } from "back-end/src/revisions/util";
// Generic, entity-agnostic revision webhook dispatch. The adapter is looked up
// by revision.target.type, so adding a new approval type needs no changes here.
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import {
  approveRevision,
  publishRevision as publishRevisionAction,
  maybeAutoPublishRevision,
  canEnableAutoPublishOnApproval,
} from "back-end/src/revisions/revisionActions";

// region GET /revision

type RevisionListQuery = {
  status?: string;
  limit?: number;
  offset?: number;
};

type GetAllRevisionsRequest = AuthRequest<
  never,
  Record<string, never>,
  RevisionListQuery
>;

type GetAllRevisionsResponse = {
  status: 200;
  revisions: Revision[];
  total: number;
  limit: number;
  offset: number;
};

const DEFAULT_REVISION_PAGE_SIZE = 100;
const MAX_REVISION_PAGE_SIZE = 500;

function parseStatusParam(status?: string): string[] | undefined {
  if (!status) return undefined;
  return status
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolvePagination(query: RevisionListQuery) {
  const limit = Math.min(
    query.limit ?? DEFAULT_REVISION_PAGE_SIZE,
    MAX_REVISION_PAGE_SIZE,
  );
  const offset = query.offset ?? 0;
  return { limit, offset };
}

/**
 * GET /revision
 * Get a paginated list of revisions for the organization. Pass `?status=open`
 * to restrict to non-merged/non-discarded revisions, or a comma-separated list
 * of explicit statuses.
 */
export const getAllRevisions = async (
  req: GetAllRevisionsRequest,
  res: Response<GetAllRevisionsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { limit, offset } = resolvePagination(req.query);
  const status = parseStatusParam(req.query.status);

  const { revisions, total } = await context.models.revisions.getAllPaginated({
    status,
    limit,
    skip: offset,
  });

  res.status(200).json({
    status: 200,
    revisions,
    total,
    limit,
    offset,
  });
};

// endregion GET /revision

// region GET /revision/count

type GetOpenRevisionCountRequest = AuthRequest<
  never,
  Record<string, never>,
  { entityType?: RevisionTargetType }
>;

type GetOpenRevisionCountResponse = {
  status: 200;
  count: number;
};

/**
 * GET /revision/count
 * Lightweight count of open revisions across the org. Used by the top-nav
 * badge so it doesn't have to fetch full revision documents.
 *
 * When `entityType` is not specified, the count is restricted to entity types
 * whose approval flow is currently enabled in the org settings — otherwise
 * stale drafts for a disabled type would inflate the badge.
 */
export const getOpenRevisionCount = async (
  req: GetOpenRevisionCountRequest,
  res: Response<GetOpenRevisionCountResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { entityType } = req.query;

  if (entityType) {
    const count =
      await context.models.revisions.getOpenRevisionCount(entityType);
    return res.status(200).json({ status: 200, count });
  }

  const enabledTypes = getApprovalEnabledEntityTypes(context);
  if (enabledTypes.length === 0) {
    return res.status(200).json({ status: 200, count: 0 });
  }

  const count =
    await context.models.revisions.getOpenRevisionCountByTypes(enabledTypes);
  res.status(200).json({ status: 200, count });
};

// endregion GET /revision/count

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
  if (
    !getAdapter(entityType).canCreate(
      context,
      originalEntity as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const revisionModel = context.models.revisions;

  const revision = await revisionModel.createRequest({
    type: entityType,
    id: entityId,
    snapshot: originalEntity as Record<string, unknown>,
    proposedChanges,
  });

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    { type: "created" },
  );

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion POST /revision

// region GET /revision/entity/:entityType

type GetRevisionsByEntityTypeRequest = AuthRequest<
  never,
  { entityType: RevisionTargetType },
  RevisionListQuery
>;

type GetRevisionsByEntityTypeResponse = {
  status: 200;
  revisions: Revision[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * GET /revision/entity/:entityType
 * Get a paginated list of revisions for a specific entity type. Same query
 * params as GET /revision (`status`, `limit`, `offset`).
 */
export const getRevisionsByEntityType = async (
  req: GetRevisionsByEntityTypeRequest,
  res: Response<GetRevisionsByEntityTypeResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { entityType } = req.params;
  const { limit, offset } = resolvePagination(req.query);
  const status = parseStatusParam(req.query.status);

  const { revisions, total } =
    await context.models.revisions.getByTargetTypePaginated(entityType, {
      status,
      limit,
      skip: offset,
    });

  res.status(200).json({
    status: 200,
    revisions,
    total,
    limit,
    offset,
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

  const revisionModel = context.models.revisions;
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

  const revisionModel = context.models.revisions;
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

  const revisionModel = context.models.revisions;
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

type PostSubmitRequest = AuthRequest<
  { autoPublishOnApproval?: boolean },
  { id: string }
>;

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
  const { autoPublishOnApproval } = req.body;

  const revisionModel = context.models.revisions;

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Can submit drafts, and re-submit revisions after changes were requested
  // (changes-requested → pending-review).
  if (
    existingRevision.status !== "draft" &&
    existingRevision.status !== "changes-requested"
  ) {
    return res.status(400).json({
      message:
        "Only draft or changes-requested revisions can be submitted for review",
    });
  }

  // Anyone with permission to update the underlying entity can move a draft
  // into review (not just the original author), so co-authors and teammates
  // can flag someone else's draft as ready for review.
  if (
    !getAdapter(existingRevision.target.type).canUpdate(
      context,
      existingRevision.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const enableAutoPublish =
    autoPublishOnApproval &&
    canEnableAutoPublishOnApproval(
      context,
      existingRevision.target.type,
      existingRevision.target.snapshot as Record<string, unknown>,
    );

  const revision = await revisionModel.submitForReview(id, userId, {
    autoPublishOnApproval: enableAutoPublish,
  });

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    {
      type: "reviewRequested",
    },
  );

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
    skipAutoPublish?: boolean;
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
  const { decision, comment, skipAutoPublish } = req.body;

  const revisionModel = context.models.revisions;

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

  // When `blockSelfApproval` is enabled for this entity type, anyone in the
  // contributors[] list (in addition to the author) is barred from approving.
  // Only `approve` is gated; `request-changes` and `comment` remain open.
  // Legacy revisions with no `contributors` field fall back to `[authorId]`,
  // which means the existing author check above is the only effective guard.
  if (
    decision === "approve" &&
    context.hasPremiumFeature("require-approvals") &&
    isUserBlockedFromApproving({
      settings: context.org.settings,
      entityType: existingRevision.target.type,
      revision: existingRevision,
      userId,
    })
  ) {
    return res.status(403).json({
      message:
        "You contributed to this revision and cannot approve it. A separate reviewer is required.",
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

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    {
      type: "reviewed",
      decision,
      userId,
      ...(comment ? { comment } : {}),
    },
  );

  if (decision === "approve" && !skipAutoPublish) {
    const entityModel = getEntityModel(context, existingRevision.target.type);
    const entity = entityModel
      ? await entityModel.getById(existingRevision.target.id)
      : null;
    if (entity) {
      const afterAutoPublish = await maybeAutoPublishRevision(
        context,
        revision,
        entity as Record<string, unknown>,
      );
      return res.status(200).json({ status: 200, revision: afterAutoPublish });
    }
  }

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

  const revisionModel = context.models.revisions;

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

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    { type: "updated" },
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

  const revisionModel = context.models.revisions;

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Anyone who can update the underlying entity may edit a draft's title — not
  // just the author. Matches the other revision-edit endpoints and the UI, which
  // gate the title/description pencil on entity update permission, not authorship.
  if (
    !getAdapter(existingRevision.target.type).canUpdate(
      context,
      existingRevision.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
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

// region PATCH /revision/:id/description

type PatchDescriptionRequest = AuthRequest<
  {
    description: string;
  },
  { id: string }
>;

type PatchDescriptionResponse = {
  status: 200;
  revision: Revision;
};

/**
 * PATCH /revision/:id/description
 * Update the description (comment) of a revision
 * @param req
 * @param res
 */
export const patchDescription = async (
  req: PatchDescriptionRequest,
  res: Response<PatchDescriptionResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { description } = req.body;

  const revisionModel = context.models.revisions;

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Anyone who can update the underlying entity may edit a draft's description —
  // not just the author. Matches the other revision-edit endpoints and the UI,
  // which gate the title/description pencil on entity update permission.
  if (
    !getAdapter(existingRevision.target.type).canUpdate(
      context,
      existingRevision.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  // Cannot update description of merged/discarded revisions
  if (
    existingRevision.status === "merged" ||
    existingRevision.status === "discarded"
  ) {
    return res.status(400).json({
      message: "Cannot update description of a merged or discarded revision",
    });
  }

  const revision = await revisionModel.update(existingRevision, {
    comment: description,
  });

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion PATCH /revision/:id/description

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
  const { strategies, customValues, mergeResultSerialized } = req.body;

  const revisionModel = context.models.revisions;

  const revision = await revisionModel.getById(id);
  if (!revision) {
    return res.status(404).json({ message: "Revision not found" });
  }
  if (revision.status === "merged" || revision.status === "discarded") {
    return res.status(400).json({
      message: "Cannot rebase merged or discarded revisions",
    });
  }
  const entityModel = getEntityModel(context, revision.target.type);
  if (!entityModel) {
    return res.status(400).json({ message: "Unsupported entity type" });
  }
  const entity = await entityModel.getById(revision.target.id);
  if (!entity) {
    return res.status(404).json({ message: "Entity not found" });
  }

  // Anyone with permission to update the underlying entity can rebase a
  // draft onto the latest live state (not just the original author), so
  // teammates can unblock each other's stuck drafts. Matches the
  // submit-for-review permission model.
  if (
    !getAdapter(revision.target.type).canUpdate(
      context,
      entity as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  // Recalculate merge result against the current live state to ensure the
  // resolution the client is submitting is still valid.
  const baseSnapshot = revision.target.snapshot as Record<string, unknown>;
  const existingOps = normalizeProposedChanges(revision.target.proposedChanges);
  const liveSnapshot = entity as Record<string, unknown>;

  const mergeResult = checkMergeConflicts(
    baseSnapshot,
    liveSnapshot,
    existingOps,
  );

  // Optimistic-lock: verify the client's view of the conflict set still
  // matches the server's. We intentionally compare only the sorted set of
  // conflicting field names (not the full JSON merge result) so the check
  // is robust to benign serialization drift between the client's cached
  // live state and the server's fresh copy — e.g. Date vs ISO string,
  // missing-vs-undefined keys, or Mongoose-only fields. The thing that
  // actually matters for correctness is that every conflict the user
  // resolved is still a conflict, and no new conflicts have appeared.
  const serverConflictFields = (mergeResult.conflicts || [])
    .map((c) => c.field)
    .sort();
  let clientConflictFields: string[] = [];
  try {
    const parsed = JSON.parse(mergeResultSerialized) as {
      conflicts?: { field?: string }[];
    };
    clientConflictFields = (parsed?.conflicts ?? [])
      .map((c) => c?.field ?? "")
      .filter(Boolean)
      .sort();
  } catch {
    // Fall through to the mismatch branch below.
  }
  const conflictSetsMatch =
    serverConflictFields.length === clientConflictFields.length &&
    serverConflictFields.every((f, i) => f === clientConflictFields[i]);
  if (!conflictSetsMatch) {
    return res.status(409).json({
      message:
        "Something changed while you were resolving conflicts. Please reload and try again.",
    });
  }

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
          newOps.push({
            op: "replace",
            path: `/${field}`,
            value: conflict.proposedValue,
          });
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
        if (
          resolvedValue != null &&
          !isEqual(resolvedValue, liveSnapshot[field])
        ) {
          newOps.push({
            op: "replace",
            path: `/${field}`,
            value: resolvedValue,
          });
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

  await getRevisionWebhookAdapter(updatedRevision.target.type)?.dispatch(
    context,
    updatedRevision,
    { type: "rebased" },
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
 * Merge a revision (apply the changes). A revision with no net change vs the
 * live entity is closed out as merged (200), not an error, to self-heal
 * partial-failure retries.
 */
export const postMerge = async (
  req: PostMergeRequest,
  res: Response<PostMergeResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const revisionModel = context.models.revisions;
  const revision = await revisionModel.getById(id);

  if (!revision) {
    return res.status(404).json({
      message: "Revision not found",
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

  const mergedRevision = await publishRevisionAction(
    context,
    revision,
    entity as Record<string, unknown>,
  );

  return res.status(200).json({ status: 200, revision: mergedRevision });
};

// endregion POST /revision/:id/merge

// region POST /revision/:id/approve-and-publish

type PostApproveAndPublishRequest = AuthRequest<
  { comment?: string },
  { id: string }
>;

type PostApproveAndPublishResponse = {
  status: 200;
  revision: Revision;
};

export const postApproveAndPublish = async (
  req: PostApproveAndPublishRequest,
  res: Response<PostApproveAndPublishResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { comment } = req.body;

  const revisionModel = context.models.revisions;
  const revision = await revisionModel.getById(id);
  if (!revision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  const entityModel = getEntityModel(context, revision.target.type);
  if (!entityModel) {
    return res.status(400).json({ message: "Unsupported entity type" });
  }
  const entity = await entityModel.getById(revision.target.id);
  if (!entity) {
    return res.status(404).json({ message: "Entity not found" });
  }

  // Pre-flight publish feasibility BEFORE writing the approval. Otherwise a
  // conflict (or missing publish permission) surfaces only inside
  // publishRevisionAction, leaving the revision stuck in "approved" with no
  // corresponding entity update. Mirrors postFeatureApproveAndPublish.
  const adapter = getAdapter(revision.target.type);
  if (!adapter.canUpdate(context, entity as Record<string, unknown>)) {
    context.permissions.throwPermissionError();
  }
  const conflictResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    entity as Record<string, unknown>,
    normalizeProposedChanges(revision.target.proposedChanges),
  );
  if (!conflictResult.success) {
    throw new MergeConflictError(
      "Merge conflicts exist — rebase before publishing",
      conflictResult.conflicts,
    );
  }

  // requireRebaseBeforePublish pre-flight: reject a diverged revision before
  // writing the approval, so it can't get stuck "approved" but unpublished.
  if (context.org.settings?.requireRebaseBeforePublish) {
    const canBypass = adapter.canBypassApproval(
      context,
      entity as Record<string, unknown>,
    );
    if (!canBypass) {
      const diverged = isRevisionDiverged(
        adapter,
        revision.target.snapshot as Record<string, unknown>,
        entity as Record<string, unknown>,
      );
      if (diverged) {
        throw new ConflictError(
          "This revision was created against an older version of the entity. " +
            "Rebase the revision first.",
        );
      }
    }
  }

  const approved = await approveRevision(
    context,
    revision,
    entity as Record<string, unknown>,
    comment ?? "",
  );

  const merged = await publishRevisionAction(
    context,
    approved,
    entity as Record<string, unknown>,
    { bypass: false },
  );

  return res.status(200).json({ status: 200, revision: merged });
};

// endregion POST /revision/:id/approve-and-publish

// region POST /revision/:id/toggle-auto-publish

type PostToggleAutoPublishRequest = AuthRequest<
  { enabled: boolean },
  { id: string }
>;

type PostToggleAutoPublishResponse = {
  status: 200;
  revision: Revision;
};

export const postToggleAutoPublish = async (
  req: PostToggleAutoPublishRequest,
  res: Response<PostToggleAutoPublishResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;
  const { enabled } = req.body;

  const revisionModel = context.models.revisions;
  const existing = await revisionModel.getById(id);
  if (!existing) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Same gate as submit-for-review: anyone who can edit the underlying entity
  // can arm/disarm auto-publish (which for saved groups also implies publish).
  if (
    !getAdapter(existing.target.type).canUpdate(
      context,
      existing.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  if (
    enabled &&
    !canEnableAutoPublishOnApproval(
      context,
      existing.target.type,
      existing.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await revisionModel.setAutoPublishOnApproval(
    id,
    userId,
    !!enabled,
  );

  // Arming an already-approved revision must publish now — otherwise it waits
  // for an approval event that never comes.
  if (enabled && revision.status === "approved") {
    const entityModel = getEntityModel(context, revision.target.type);
    const entity = entityModel
      ? await entityModel.getById(revision.target.id)
      : null;
    if (entity) {
      const afterAutoPublish = await maybeAutoPublishRevision(
        context,
        revision,
        entity as Record<string, unknown>,
      );
      return res.status(200).json({ status: 200, revision: afterAutoPublish });
    }
  }

  res.status(200).json({ status: 200, revision });
};

// endregion POST /revision/:id/toggle-auto-publish

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

  const revisionModel = context.models.revisions;

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

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    {
      type: "discarded",
    },
  );

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

  const revisionModel = context.models.revisions;

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

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    {
      type: "reopened",
    },
  );

  res.status(200).json({
    status: 200,
    revision,
  });
};

// endregion POST /revision/:id/reopen

// region POST /revision/:id/recall-review

type PostRecallReviewRequest = AuthRequest<never, { id: string }>;

type PostRecallReviewResponse = {
  status: 200;
  revision: Revision;
};

/**
 * POST /revision/:id/recall-review
 * Pull a review request back to draft (clears reviews, disarms auto-publish)
 */
export const postRecallReview = async (
  req: PostRecallReviewRequest,
  res: Response<PostRecallReviewResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;

  const revisionModel = context.models.revisions;

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  if (
    !["pending-review", "changes-requested", "approved"].includes(
      existingRevision.status,
    )
  ) {
    return res.status(400).json({
      message: "Only a revision in review can be returned to draft",
    });
  }

  // Author can always recall; otherwise require permission to edit the entity.
  if (existingRevision.authorId !== userId) {
    if (
      !getAdapter(existingRevision.target.type).canUpdate(
        context,
        existingRevision.target.snapshot as Record<string, unknown>,
      )
    ) {
      context.permissions.throwPermissionError();
    }
  }

  const revision = await revisionModel.recallReview(id, userId);

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    { type: "reopened" },
  );

  res.status(200).json({ status: 200, revision });
};

// endregion POST /revision/:id/recall-review

// region POST /revision/:id/undo-review

type PostUndoReviewRequest = AuthRequest<never, { id: string }>;

type PostUndoReviewResponse = {
  status: 200;
  revision: Revision;
};

/**
 * POST /revision/:id/undo-review
 * Retract the calling user's own active review verdict
 */
export const postUndoReview = async (
  req: PostUndoReviewRequest,
  res: Response<PostUndoReviewResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;

  const revisionModel = context.models.revisions;

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Must be able to edit the entity to touch verdicts; the model enforces that
  // only the caller's own active verdict is retracted.
  if (
    !getAdapter(existingRevision.target.type).canUpdate(
      context,
      existingRevision.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await revisionModel.undoReview(id, userId);

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    { type: "updated" },
  );

  // Retracting a request-changes can flip the revision back to approved; if it's
  // armed, auto-publish like the review path.
  if (revision.status === "approved" && revision.autoPublishOnApproval) {
    const entityModel = getEntityModel(context, revision.target.type);
    const entity = entityModel
      ? await entityModel.getById(revision.target.id)
      : null;
    if (entity) {
      const afterAutoPublish = await maybeAutoPublishRevision(
        context,
        revision,
        entity as Record<string, unknown>,
      );
      return res.status(200).json({ status: 200, revision: afterAutoPublish });
    }
  }

  res.status(200).json({ status: 200, revision });
};

// endregion POST /revision/:id/undo-review

// region PUT /revision/:id/comment/:reviewId

type PutCommentRequest = AuthRequest<
  { comment: string },
  { id: string; reviewId: string }
>;

type PutCommentResponse = {
  status: 200;
  revision: Revision;
};

/**
 * PUT /revision/:id/comment/:reviewId
 * Edit a comment the calling user authored
 */
export const putComment = async (
  req: PutCommentRequest,
  res: Response<PutCommentResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id, reviewId } = req.params;
  const { comment } = req.body;

  const revisionModel = context.models.revisions;

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Require entity edit permission (the model also enforces author-only),
  // matching the other review-lifecycle endpoints.
  if (
    !getAdapter(existingRevision.target.type).canUpdate(
      context,
      existingRevision.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await revisionModel.editComment(
    id,
    reviewId,
    userId,
    comment,
  );

  res.status(200).json({ status: 200, revision });
};

// endregion PUT /revision/:id/comment/:reviewId

// region DELETE /revision/:id/comment/:reviewId

type DeleteCommentRequest = AuthRequest<
  never,
  { id: string; reviewId: string }
>;

type DeleteCommentResponse = {
  status: 200;
  revision: Revision;
};

/**
 * DELETE /revision/:id/comment/:reviewId
 * Delete a comment the calling user authored
 */
export const deleteComment = async (
  req: DeleteCommentRequest,
  res: Response<DeleteCommentResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id, reviewId } = req.params;

  const revisionModel = context.models.revisions;

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Require entity edit permission (the model also enforces author-only),
  // matching the other review-lifecycle endpoints.
  if (
    !getAdapter(existingRevision.target.type).canUpdate(
      context,
      existingRevision.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await revisionModel.deleteComment(id, reviewId, userId);

  res.status(200).json({ status: 200, revision });
};

// endregion DELETE /revision/:id/comment/:reviewId

// region POST /revision/:id/schedule-publish

type PostSchedulePublishRequest = AuthRequest<
  {
    scheduledPublishAt: string | null;
    lockEdits?: boolean;
    lockOthers?: boolean;
    bypassApproval?: boolean;
  },
  { id: string }
>;

type PostSchedulePublishResponse = {
  status: 200;
  revision: Revision;
};

/**
 * POST /revision/:id/schedule-publish
 * Arm (date set) or cancel (date null) a deferred publish.
 */
export const postSchedulePublish = async (
  req: PostSchedulePublishRequest,
  res: Response<PostSchedulePublishResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;
  const { scheduledPublishAt, lockEdits, lockOthers, bypassApproval } =
    req.body;

  const revisionModel = context.models.revisions;

  const existingRevision = await revisionModel.getById(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  if (
    !(ACTIVE_DRAFT_STATUSES as readonly string[]).includes(
      existingRevision.status,
    )
  ) {
    return res.status(400).json({
      message: "This revision can no longer be scheduled",
    });
  }

  const adapter = getAdapter(existingRevision.target.type);
  const snapshot = existingRevision.target.snapshot as Record<string, unknown>;
  const isCancel = scheduledPublishAt === null;

  // Parse + validate the target date (arming only).
  let parsedDate: Date | null = null;
  if (!isCancel) {
    parsedDate = new Date(scheduledPublishAt);
    if (isNaN(parsedDate.getTime())) {
      return res
        .status(400)
        .json({ message: "Invalid scheduledPublishAt date" });
    }
    if (parsedDate.getTime() <= Date.now()) {
      return res
        .status(400)
        .json({ message: "scheduledPublishAt must be in the future" });
    }
  }

  // Canceling needs publish authority; arming additionally needs the
  // scheduled-publish capability. Both come from generic defaults so every
  // revisioned entity — current and future — works without per-adapter wiring:
  // publish authority defaults to canUpdate, and the schedule capability
  // defaults to the scheduled-revisions premium feature plus that publish
  // authority (you can only schedule a publish you'd be allowed to perform). An
  // adapter may override either to narrow it (e.g. an environment-scoped gate).
  const canPublish = adapter.canPublishRevision
    ? adapter.canPublishRevision(context, snapshot)
    : adapter.canUpdate(context, snapshot);
  const canSchedule = adapter.canSchedulePublish
    ? adapter.canSchedulePublish(context, snapshot)
    : context.hasPremiumFeature("scheduled-revisions") && canPublish;
  if (isCancel ? !canPublish : !canSchedule) {
    context.permissions.throwPermissionError();
  }

  // Bypass-approval intent is only honored for callers who can bypass.
  const wantsBypass =
    !!bypassApproval && adapter.canBypassApproval(context, snapshot);

  // The schedule fires with this user's authority; require a resolvable actor.
  const enabledBy =
    userId ||
    existingRevision.autoPublishEnabledBy ||
    existingRevision.authorId ||
    null;
  if (!isCancel && !enabledBy) {
    return res.status(400).json({
      message: "A scheduled publish needs a user to run as",
    });
  }

  // No-approval-path guard: arming a draft that still requires approval (without
  // bypass) isn't allowed — request review first.
  if (!isCancel && existingRevision.status === "draft" && !wantsBypass) {
    const approvalRequired = adapter.isApprovalRequiredForRevision
      ? adapter.isApprovalRequiredForRevision(context, existingRevision)
      : adapter.isApprovalRequired(context);
    if (approvalRequired) {
      return res.status(400).json({
        message: "Request review before scheduling this draft's publish.",
      });
    }
  }

  const revision = await revisionModel.setScheduledPublish(id, enabledBy, {
    scheduledPublishAt: parsedDate,
    lockEdits,
    lockOthers,
    bypassApproval: wantsBypass,
  });

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    { type: "updated" },
  );

  res.status(200).json({ status: 200, revision });
};

// endregion POST /revision/:id/schedule-publish

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

  const revisionModel = context.models.revisions;
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

  const revisionModel = context.models.revisions;
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

  // The Zod-typed snapshot widens to a generic object so checkMergeConflicts
  // can compare arbitrary entity shapes; the adapter owns the concrete type.
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
