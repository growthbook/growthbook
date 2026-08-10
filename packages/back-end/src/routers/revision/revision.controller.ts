import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { proposedProjectScope } from "shared/util";
import type { Response } from "express";
import {
  Revision,
  RevisionTargetType,
  Conflict,
  ReviewDecision,
  checkMergeConflicts,
  JsonPatchOperation,
  normalizeProposedChanges,
  isUserBlockedFromApproving,
  REVIEW_CYCLE_STATUSES,
} from "shared/enterprise";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { holdsMoveDestination } from "back-end/src/revisions/moveAuthority";
import { buildRevisionStatusFilter } from "back-end/src/api/revisionValidations";
import {
  isArmedWithAuthorizedPublisher,
  planApproveAndPublish,
} from "back-end/src/revisions/approveAndPublish";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { ApiErrorResponse } from "back-end/types/api";
import { ConflictError, MergeConflictError } from "back-end/src/util/errors";
import { getContextFromReq } from "back-end/src/services/organizations";
import { ArmAcknowledgments } from "back-end/src/services/armGuards";
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
  assertCanPublishRevision,
  canCommentOnRevision,
  canDoRevisionAction,
  canRevisionOwnedAction,
  canDisarmAutoPublishOnApproval,
  canEnableAutoPublishOnApproval,
  canPublishRevisionChange,
  maybeAutoPublishRevision,
  publishRevision as publishRevisionAction,
  rebaseRevision,
} from "back-end/src/revisions/revisionActions";
import {
  advanceAuthorityOnRow,
  discardAuthorityOnRow,
  draftAuthorityOnRow,
  canAdvanceRevision,
  canDiscardRevision,
  canRebaseRevision,
  isRevisionAuthor,
  mayBeRevisionAuthor,
  reviewAuthorityOnRow,
} from "back-end/src/revisions/revisionAuthority";
import { scheduleRevisionPublish } from "back-end/src/revisions/revisionLifecycle";

// Arming publishes into the entity as it stands when the fire happens, so
// authorization uses the LIVE entity rather than the revision's snapshot: after
// a project move the snapshot names a project the publish will never land in.
async function loadLiveEntityForRevision(
  context: ReqContext,
  revision: Pick<Revision, "target">,
): Promise<Record<string, unknown> | null> {
  const model = getAdapter(revision.target.type).getModel(context);
  return (
    ((await model?.getById(revision.target.id)) as Record<
      string,
      unknown
    > | null) ?? null
  );
}

// Arm-time acknowledgment for a deferred publish, via the entity's adapter hook
// (config uses it for the experiment guard; others have none). Throws when the
// armer must acknowledge a condition first; returns keys to snapshot on the arm.
async function captureArmAcknowledgment(
  context: ReqContext,
  revision: Pick<Revision, "target">,
  // Reuse an already-loaded entity when the caller has one.
  prefetchedEntity?: Record<string, unknown> | null,
): Promise<ArmAcknowledgments | undefined> {
  const adapter = getAdapter(revision.target.type);
  if (!adapter.captureArmAcknowledgment) return undefined;
  const entity =
    prefetchedEntity ??
    (await adapter.getModel(context)?.getById(revision.target.id));
  if (!entity) return undefined;
  return adapter.captureArmAcknowledgment(
    context,
    entity,
    revision.target.proposedChanges,
  );
}

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

// Delegates to the REST layer's parser so both surfaces answer the same
// question — `open` is an alias, not a stored status, so passing it through
// verbatim silently matches nothing.
function parseStatusParam(status?: string): string | string[] | undefined {
  return buildRevisionStatusFilter(status);
}

function resolvePagination(query: RevisionListQuery) {
  const limit = Math.min(
    query.limit ?? DEFAULT_REVISION_PAGE_SIZE,
    MAX_REVISION_PAGE_SIZE,
  );
  const offset = query.offset ?? 0;
  return { limit, offset };
}

// GET /revision
// Get a paginated list of revisions for the organization. Pass `?status=open`
// to restrict to non-merged/non-discarded revisions, or a comma-separated list
// of explicit statuses.
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

// GET /revision/count
// Lightweight count of open revisions across the org. Used by the top-nav
// badge so it doesn't have to fetch full revision documents.
//
// When `entityType` is not specified, the count is restricted to entity types
// whose approval flow is currently enabled in the org settings — otherwise
// stale drafts for a disabled type would inflate the badge.
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

  // Creating a draft requires draft-authoring permission (not entity-create),
  // checked on the LIVE entity — there is no revision snapshot yet.
  if (
    !canDoRevisionAction(
      entityType,
      "draft",
      context,
      originalEntity as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }
  // A draft that relocates the entity is also authored in the DESTINATION.
  // Draft authority, not publish: staging publishes nothing — the landing gate
  // asks for publish when it lands.
  if (
    !holdsMoveDestination({
      permissions: context.permissions,
      model: entityType,
      action: "draft",
      existing: originalEntity as Record<string, unknown>,
      proposed: {
        ...(originalEntity as Record<string, unknown>),
        ...proposedProjectScope(proposedChanges),
      },
      environments: NO_ENVIRONMENT_BINDING,
    })
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
  const revisions = await revisionModel.getByTargetReadable(
    entityType,
    entityId,
  );

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
  const revision = await revisionModel.getByIdReadable(id);

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
  {
    autoPublishOnApproval?: boolean;
    // A dated schedule armed with the same request — the schedule endpoint
    // refuses review-required drafts until review is requested, so the control
    // stages it here. Mirrors the feature twin's request-review.
    scheduledPublishAt?: string | null;
    scheduledPublishLockEdits?: boolean;
    scheduledPublishLockOthers?: boolean;
  },
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
  const {
    autoPublishOnApproval,
    scheduledPublishAt,
    scheduledPublishLockEdits,
    scheduledPublishLockOthers,
  } = req.body;

  const revisionModel = context.models.revisions;

  const existingRevision = await revisionModel.getByIdReadable(id);
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

  if (!(await canAdvanceRevision(context, existingRevision))) {
    context.permissions.throwPermissionError();
  }

  const liveEntity = await loadLiveEntityForRevision(context, existingRevision);
  const enableAutoPublish =
    !!autoPublishOnApproval &&
    !!liveEntity &&
    (await canEnableAutoPublishOnApproval(
      context,
      existingRevision,
      liveEntity,
    ));

  // A date additionally needs the scheduled-publish capability (same check as
  // the dedicated schedule endpoint); the no-date arm is governed above.
  let parsedSchedule: Date | null = null;
  if ((scheduledPublishAt ?? null) !== null) {
    const adapter = getAdapter(existingRevision.target.type);
    const snapshot = (liveEntity ?? {}) as Record<string, unknown>;
    const canSchedule = adapter.canSchedulePublish
      ? adapter.canSchedulePublish(context, snapshot)
      : context.hasPremiumFeature("scheduled-revisions") &&
        (adapter.canPublishRevision
          ? adapter.canPublishRevision(context, snapshot)
          : adapter.canUpdate(context, snapshot));
    if (!liveEntity || !canSchedule) {
      context.permissions.throwPermissionError();
    }
    parsedSchedule = new Date(scheduledPublishAt as string);
    if (isNaN(parsedSchedule.getTime())) {
      return res
        .status(400)
        .json({ message: "Invalid scheduledPublishAt date" });
    }
    if (parsedSchedule.getTime() <= Date.now()) {
      return res
        .status(400)
        .json({ message: "scheduledPublishAt must be in the future" });
    }
    // Same authority the fire-time publish will take. The adapter check above is
    // coarse and cannot see the change set.
    await assertCanPublishRevision(context, existingRevision, snapshot);
    // Same arming precondition as the dedicated schedule endpoints — without it
    // this door armed schedules on a locked Config that could only park.
    await adapter.assertSchedulable?.(context, snapshot);
  }

  // Any arm — dated or not — needs the guard fingerprints.
  const armAcknowledgments =
    enableAutoPublish || parsedSchedule !== null
      ? await captureArmAcknowledgment(context, existingRevision, liveEntity)
      : undefined;

  const revision = await revisionModel.submitForReview(
    id,
    userId,
    advanceAuthorityOnRow(context),
    {
      autoPublishOnApproval: enableAutoPublish,
      armAcknowledgments,
      scheduledPublishAt: parsedSchedule,
      lockEdits: scheduledPublishLockEdits,
      lockOthers: scheduledPublishLockOthers,
    },
  );

  const webhooks = getRevisionWebhookAdapter(revision.target.type);
  await webhooks?.dispatch(context, revision, { type: "reviewRequested" });
  // Submitting can arm a deferred publish OR, submitted unarmed, clear a prior
  // one. Either transition is a schedule change; subscribers watch
  // `publishScheduleChanged`, not `reviewRequested`, so dispatch whenever the
  // schedule state changes — not only when arming.
  const wasScheduled =
    !!existingRevision.autoPublishOnApproval ||
    (existingRevision.scheduledPublishAt ?? null) !== null;
  if (enableAutoPublish || parsedSchedule !== null || wasScheduled) {
    await webhooks?.dispatch(context, revision, {
      type: "publishScheduleChanged",
    });
  }

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

  const existingRevision = await revisionModel.getByIdReadable(id);
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

  // ...nor one that is not in review at all. Early refusal only — the model's
  // CAS re-check is what actually closes the recall race.
  if (
    decision !== "comment" &&
    !(REVIEW_CYCLE_STATUSES as readonly string[]).includes(
      existingRevision.status,
    )
  ) {
    return res.status(400).json({
      message: `Can only submit a review when review has been requested (status is "${existingRevision.status}")`,
    });
  }

  // Prevent self-review (author cannot approve or request changes on own revision)
  if (
    mayBeRevisionAuthor(existingRevision.authorId, userId) &&
    decision !== "comment"
  ) {
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

  // A verdict needs review authority; a plain comment is participation.
  const snapshot = existingRevision.target.snapshot as Record<string, unknown>;
  const type = existingRevision.target.type;
  const allowed =
    decision === "comment"
      ? canCommentOnRevision(type, context, snapshot)
      : canRevisionOwnedAction(context, existingRevision, "review");
  if (!allowed) {
    context.permissions.throwPermissionError();
  }

  const revision = await revisionModel.addReview(
    id,
    userId,
    decision,
    comment,
    reviewAuthorityOnRow(context),
    // The cycle THIS caller read — see addReview.
    existingRevision.reviewCycle ?? 0,
  );

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

  const existingRevision = await revisionModel.getByIdReadable(id);
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
  if (!isRevisionAuthor(existingRevision.authorId, userId)) {
    return res
      .status(403)
      .json({ message: "Only the author can update proposed changes" });
  }
  // Authorship narrows this to your OWN draft; it is not the permission — an
  // author who has since lost draft-edit rights must not rewrite the contents.
  if (!canRevisionOwnedAction(context, existingRevision, "draft")) {
    context.permissions.throwPermissionError();
  }
  // Rewriting the draft can ADD a relocation, so the destination is re-judged
  // against the incoming ops — measured from the LIVE entity, like the publish
  // path: judged from the snapshot, a move back to the snapshot's project would
  // read as "no move". Draft authority above stays snapshot-based (whose draft
  // this is, not where it lands).
  const liveForDestination =
    ((await getAdapter(existingRevision.target.type)
      .getModel(context)
      ?.getById(existingRevision.target.id)) as Record<string, unknown>) ??
    (existingRevision.target.snapshot as Record<string, unknown>);
  if (
    !holdsMoveDestination({
      permissions: context.permissions,
      model: existingRevision.target.type,
      action: "draft",
      existing: liveForDestination,
      proposed: {
        ...liveForDestination,
        ...proposedProjectScope(proposedChanges),
      },
      environments: NO_ENVIRONMENT_BINDING,
    })
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await revisionModel.updateProposedChanges(
    id,
    proposedChanges,
    userId,
    advanceAuthorityOnRow(context),
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

  const existingRevision = await revisionModel.getByIdReadable(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  if (!canRevisionOwnedAction(context, existingRevision, "draft")) {
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

  const existingRevision = await revisionModel.getByIdReadable(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  if (!canRevisionOwnedAction(context, existingRevision, "draft")) {
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
  const { id } = req.params;
  const { strategies, customValues, mergeResultSerialized } = req.body;

  const revisionModel = context.models.revisions;

  const revision = await revisionModel.getByIdReadable(id);
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

  const baseSnapshot = revision.target.snapshot as Record<string, unknown>;
  const existingOps = normalizeProposedChanges(revision.target.proposedChanges);
  const liveSnapshot = entity as Record<string, unknown>;
  const updatableFields = getAdapter(revision.target.type).getUpdatableFields();

  if (
    !(await canRebaseRevision({
      context,
      revision,
      baseSnapshot,
      liveSnapshot,
      updatableFields,
    }))
  ) {
    context.permissions.throwPermissionError();
  }

  // Recalculate merge result against the current live state to ensure the
  // resolution the client is submitting is still valid.
  const mergeResult = checkMergeConflicts(
    baseSnapshot,
    liveSnapshot,
    existingOps,
    updatableFields,
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

  // Resolution, persistence and the webhook come from the shared rebase
  // pipeline; the conflict-set optimistic lock above is the only
  // route-specific part.
  const updatedRevision = await rebaseRevision({
    context,
    entityType: revision.target.type,
    entity: liveSnapshot,
    revision,
    strategies,
    customValues,
  });

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

// POST /revision/:id/merge
// Merge a revision (apply the changes). A revision with no net change vs the
// live entity is closed out as merged (200), not an error, to self-heal
// partial-failure retries.
export const postMerge = async (
  req: PostMergeRequest,
  res: Response<PostMergeResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const revisionModel = context.models.revisions;
  const revision = await revisionModel.getByIdReadable(id);

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
  const revision = await revisionModel.getByIdReadable(id);
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
  // Approving needs review authority; the publish needs publish authority
  // unless the revision is already armed — see planApproveAndPublish.
  const plan = planApproveAndPublish({
    armed: await isArmedWithAuthorizedPublisher(
      context,
      revision,
      (publisherContext) =>
        canPublishRevisionChange(
          publisherContext,
          revision,
          entity as Record<string, unknown>,
        ),
    ),
    // Judged on the revision's SNAPSHOT like every other review check: a review
    // belongs to the revision, so a later live-entity move must not reject a
    // reviewer scoped to the project it was opened in. Publish authority below
    // stays on LIVE, where the publish lands.
    canReview: (adapter.canReview ?? adapter.canUpdate)(
      context,
      revision.target.snapshot as Record<string, unknown>,
    ),
    // Footprint-aware, not the adapter check alone — that cannot see the change
    // set, so a dev-limited approver could approve a production override and
    // strand the approval at publish.
    canPublish: await canPublishRevisionChange(
      context,
      revision,
      entity as Record<string, unknown>,
    ),
  });
  // Read before the throw: throwPermissionError isn't typed as `never`, so the
  // discriminated union doesn't narrow past it.
  const publishInline = plan.allowed && plan.publishInline;
  if (!plan.allowed) {
    context.permissions.throwPermissionError();
  }
  const conflictResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    entity as Record<string, unknown>,
    normalizeProposedChanges(revision.target.proposedChanges),
    adapter.getUpdatableFields(),
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

  // An armed approver without publish authority doesn't publish as themselves —
  // approving arms the fire, which runs under whoever enabled auto-publish.
  const merged = publishInline
    ? await publishRevisionAction(
        context,
        approved,
        entity as Record<string, unknown>,
        { bypass: false },
      )
    : await maybeAutoPublishRevision(
        context,
        approved,
        entity as Record<string, unknown>,
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
  const existing = await revisionModel.getByIdReadable(id);
  if (!existing) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Arming and disarming both require publish authority.
  const liveEntity = await loadLiveEntityForRevision(context, existing);
  const mayToggle =
    !!liveEntity &&
    (enabled
      ? await canEnableAutoPublishOnApproval(context, existing, liveEntity)
      : await canDisarmAutoPublishOnApproval(context, existing, liveEntity));
  if (!mayToggle) {
    context.permissions.throwPermissionError();
  }

  const armAcknowledgments = enabled
    ? await captureArmAcknowledgment(context, existing, liveEntity)
    : undefined;

  const revision = await revisionModel.setAutoPublishOnApproval(
    id,
    userId,
    !!enabled,
    { armAcknowledgments },
  );

  // Schedule subscribers watch this, not the arm's response — same event the
  // feature twin and the submit route dispatch for the same state change.
  if (!!existing.autoPublishOnApproval !== !!enabled) {
    await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
      context,
      revision,
      { type: "publishScheduleChanged" },
    );
  }

  // Arming an already-approved revision must publish now — otherwise it waits
  // for an approval event that never comes.
  if (enabled && revision.status === "approved") {
    // Re-read rather than publishing the doc the arming CAS returned: the arm
    // deliberately guards only `status` (a rebase must not conflict with it),
    // so `revision.target` may already be superseded. Arming tolerates a stale
    // target; publishing never can.
    const fresh = await revisionModel.getById(id);
    if (
      fresh &&
      fresh.status === "approved" &&
      fresh.autoPublishOnApproval &&
      fresh.version === revision.version
    ) {
      const entityModel = getEntityModel(context, fresh.target.type);
      const entity = entityModel
        ? await entityModel.getById(fresh.target.id)
        : null;
      if (entity) {
        const afterAutoPublish = await maybeAutoPublishRevision(
          context,
          fresh,
          entity as Record<string, unknown>,
        );
        return res
          .status(200)
          .json({ status: 200, revision: afterAutoPublish });
      }
    }
    // A concurrent writer moved it out from under the arm. The arm itself
    // stands; report the row as it now is rather than publishing.
    if (fresh) return res.status(200).json({ status: 200, revision: fresh });
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

  const existingRevision = await revisionModel.getByIdReadable(id);
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

  // Draft authority or authorship, not the narrow atoms — discarding destroys
  // work, possibly someone else's mid-review. See `canDiscardRevision`.
  if (!(await canDiscardRevision(context, existingRevision))) {
    context.permissions.throwPermissionError();
  }

  const revision = await revisionModel.close(
    id,
    userId,
    discardAuthorityOnRow(context),
    reason,
  );

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

  const existingRevision = await revisionModel.getByIdReadable(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Only discarded revisions can be reopened (not merged)
  if (existingRevision.status !== "discarded") {
    return res.status(400).json({
      message: "Only discarded revisions can be reopened",
    });
  }

  if (!isRevisionAuthor(existingRevision.authorId, userId)) {
    // Not the author: reopening someone else's revision takes draft authority.
    if (!canRevisionOwnedAction(context, existingRevision, "draft")) {
      context.permissions.throwPermissionError();
    }
  }

  const revision = await revisionModel.reopen(
    id,
    userId,
    draftAuthorityOnRow(context),
  );

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

  const existingRevision = await revisionModel.getByIdReadable(id);
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

  // Author can always recall; otherwise require draft-authoring permission.
  if (!isRevisionAuthor(existingRevision.authorId, userId)) {
    if (!canRevisionOwnedAction(context, existingRevision, "draft")) {
      context.permissions.throwPermissionError();
    }
  }

  // Re-asked inside the CAS on the row each attempt reads — a retry after a
  // concurrent rebase would otherwise proceed against a snapshot the caller
  // was never authorized for.
  const revision = await revisionModel.recallReview(
    id,
    userId,
    draftAuthorityOnRow(context),
  );

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    { type: "recalled" },
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

  const existingRevision = await revisionModel.getByIdReadable(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Must have review permission to touch verdicts; the model enforces that
  // only the caller's own active verdict is retracted.
  if (!canRevisionOwnedAction(context, existingRevision, "review")) {
    context.permissions.throwPermissionError();
  }

  // Re-asked inside the CAS against the row the write is conditioned on — a
  // rebase between the two would otherwise carry this retraction into a
  // project the caller holds nothing in.
  const revision = await revisionModel.undoReview(
    id,
    userId,
    reviewAuthorityOnRow(context),
    // The cycle this caller was looking at when they asked to retract.
    existingRevision.reviewCycle ?? 0,
  );

  await getRevisionWebhookAdapter(revision.target.type)?.dispatch(
    context,
    revision,
    { type: "reviewRetracted" },
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

  const existingRevision = await revisionModel.getByIdReadable(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  if (
    !canCommentOnRevision(
      existingRevision.target.type,
      context,
      existingRevision.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  // The model re-checks comment ownership on the row itself; participation is not
  // entity authority, so there is no project-scoped question to re-ask.
  const revision = await revisionModel.editComment(
    id,
    reviewId,
    userId,
    comment,
    {
      authorizedByFlow:
        "assertCanWriteCommentOn re-checks the row inside the CAS",
    },
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

  const existingRevision = await revisionModel.getByIdReadable(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  if (
    !canCommentOnRevision(
      existingRevision.target.type,
      context,
      existingRevision.target.snapshot as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await revisionModel.deleteComment(id, reviewId, userId, {
    authorizedByFlow:
      "assertCanWriteCommentOn re-checks the row inside the CAS",
  });

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
  const { id } = req.params;

  const existingRevision = await context.models.revisions.getByIdReadable(id);
  if (!existingRevision) {
    return res.status(404).json({ message: "Revision not found" });
  }

  // Kept here rather than delegated: the shared verb only refuses an ARM on a
  // resolved revision, while this endpoint has always refused a cancel too.
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
  // Authorize against the LIVE entity, not the revision's snapshot. A schedule
  // publishes into the entity as it stands when the poller fires, so after a
  // project move the snapshot names a project the change will never land in.
  // Cancellation is included: it is a write to the same pending publish.
  const liveEntity =
    (await adapter.getModel(context)?.getById(existingRevision.target.id)) ??
    null;
  if (!liveEntity) {
    return res.status(404).json({ message: "Entity not found" });
  }

  // Date validation, authority, bypass intent, the actor, approval
  // preconditions, acknowledgment capture and the lifecycle event all live in
  // `scheduleRevisionPublish`, shared with the Config/Constant/Saved Group
  // REST handlers.
  const revision = await scheduleRevisionPublish({
    context,
    type: existingRevision.target.type,
    entity: liveEntity as Record<string, unknown>,
    revision: existingRevision,
    body: req.body,
    // Entity-specific arming precondition: a locked Config refuses NEW
    // schedules but still allows cancelling a pending one.
    assertArmable: adapter.assertSchedulable
      ? () => {
          void adapter.assertSchedulable?.(
            context,
            liveEntity as Record<string, unknown>,
          );
        }
      : undefined,
  });

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
  const revision = await revisionModel.getByIdReadable(id);
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

  // The response echoes conflicting draft and live field values, so require read
  // access to the entity. Checked against the LIVE entity, whose project is
  // authoritative (a snapshot may carry a stale project).
  if (
    !getAdapter(revision.target.type).canRead(
      context,
      liveEntity as Record<string, unknown>,
    )
  ) {
    context.permissions.throwPermissionError();
  }

  // The Zod-typed snapshot widens to a generic object so checkMergeConflicts
  // can compare arbitrary entity shapes; the adapter owns the concrete type.
  const result = checkMergeConflicts(
    revision.target.snapshot as unknown as Record<string, unknown>,
    liveEntity as Record<string, unknown>,
    normalizeProposedChanges(revision.target.proposedChanges),
    getAdapter(revision.target.type).getUpdatableFields(),
  );

  res.status(200).json({
    status: 200,
    hasConflicts: !result.success,
    conflicts: result.conflicts,
    canAutoMerge: result.canAutoMerge,
  });
};

// endregion GET /revision/:id/conflicts
