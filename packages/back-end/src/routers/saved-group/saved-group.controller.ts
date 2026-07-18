import type { Response } from "express";
import { isEqual } from "lodash";
import {
  formatByteSizeString,
  SAVED_GROUP_SIZE_LIMIT_BYTES,
  ID_LIST_DATATYPES,
  validateCondition,
} from "shared/util";
import {
  SavedGroupInterface,
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
} from "shared/types/saved-group";
import {
  Revision,
  SAVED_GROUP_METADATA_FIELDS,
  getApprovalFlowSettings,
  normalizeProposedChanges,
} from "shared/enterprise";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  isRevisionRequired,
  createOrUpdateRevision,
  buildPatchOps,
  applyPatchToSnapshot,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { getAdapter } from "back-end/src/revisions";
import {
  dispatchSavedGroupRevisionEvent,
  deriveChange,
} from "back-end/src/services/savedGroupRevisionEvents";
import {
  assertSavedGroupDeletable,
  loadSavedGroupReferences,
  totalSavedGroupReferences,
} from "back-end/src/services/savedGroups";

// region POST /saved-groups

type CreateSavedGroupRequest = AuthRequest<
  CreateSavedGroupProps,
  Record<string, never>,
  { skipCycleCheck?: string }
>;

type CreateSavedGroupResponse = {
  status: 200;
  savedGroup: SavedGroupInterface;
};

/**
 * POST /saved-groups
 * Create a saved-group resource
 * @param req
 * @param res
 */
export const postSavedGroup = async (
  req: CreateSavedGroupRequest,
  res: Response<CreateSavedGroupResponse>,
) => {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const {
    groupName,
    owner,
    attributeKey,
    values,
    type,
    condition,
    description,
    projects,
  } = req.body;
  const skipCycleCheck = req.query.skipCycleCheck;

  if (!context.permissions.canCreateSavedGroup({ ...req.body })) {
    context.permissions.throwPermissionError();
  }

  if (projects) {
    await context.models.projects.ensureProjectsExist(projects);
  }

  let uniqValues: string[] | undefined = undefined;
  // If this is a condition group, make sure the condition is valid and not empty
  if (type === "condition") {
    const allSavedGroups = await context.models.savedGroups.getAll();
    const groupMap = new Map(allSavedGroups.map((sg) => [sg.id, sg]));
    const conditionRes = validateCondition(
      condition,
      groupMap,
      skipCycleCheck === "1",
    );
    if (!conditionRes.success) {
      throw new Error(conditionRes.error);
    }
    if (conditionRes.empty) {
      throw new Error("Condition cannot be empty");
    }
  } else if (type === "list") {
    // If this is a list group, make sure the attributeKey is specified
    if (!attributeKey) {
      throw new Error("Must specify an attributeKey");
    }
    const attributeSchema = org.settings?.attributeSchema || [];
    const datatype = attributeSchema.find(
      (sdkAttr) => sdkAttr.property === attributeKey,
    )?.datatype;
    if (!datatype) {
      throw new Error("Unknown attributeKey");
    }
    if (!ID_LIST_DATATYPES.includes(datatype)) {
      throw new Error(
        "Cannot create an ID List for the given attribute key. Try using a Condition Group instead.",
      );
    }
    uniqValues = [...new Set(values)];
    // Check that the size is within the global limit as well as any limit imposed by the organization
    validateListSize(
      uniqValues,
      org.settings?.savedGroupSizeLimit,
      context.permissions.canBypassSavedGroupSizeLimit(projects),
    );
  }
  if (typeof description === "string" && description.length > 100) {
    throw new Error("Description must be at most 100 characters");
  }

  const savedGroup = await context.models.savedGroups.create({
    values: uniqValues,
    type,
    condition,
    groupName,
    owner: owner || userId,
    attributeKey,
    description,
    projects,
  });

  // Create an initial "live" revision to represent the created state
  await ensureLiveRevisionExists(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  return res.status(200).json({
    status: 200,
    savedGroup,
  });
};

// endregion POST /saved-groups

// region GET /saved-groups/:id

type GetSavedGroupRequest = AuthRequest<Record<string, never>, { id: string }>;

type GetSavedGroupResponse = {
  status: 200;
  savedGroup: SavedGroupInterface;
};

/**
 * GET /saved-groups/:id
 * Fetch a saved-group resource
 * @param req
 * @param res
 */
export const getSavedGroup = async (
  req: GetSavedGroupRequest,
  res: Response<GetSavedGroupResponse>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  const savedGroup = await context.models.savedGroups.getById(id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  return res.status(200).json({
    status: 200,
    savedGroup,
  });
};

// endregion GET /saved-groups/:id

// region POST /saved-groups/:id/add-items

type PostSavedGroupAddItemsRequest = AuthRequest<
  { items: string[] },
  { id: string }
>;

type PostSavedGroupAddItemsResponse =
  | { status: 200; requiresApproval?: false; revision?: Revision }
  | { status: 202; requiresApproval: boolean; revision: Revision };

/**
 * POST /saved-groups/:id/add-items
 * Update one saved-group resource by adding the specified list of items
 * @param req
 * @param res
 */
export const postSavedGroupAddItems = async (
  req: PostSavedGroupAddItemsRequest,
  res: Response<PostSavedGroupAddItemsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const { items } = req.body;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  const savedGroup = await context.models.savedGroups.getById(id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  if (!context.permissions.canUpdateSavedGroup(savedGroup, savedGroup)) {
    context.permissions.throwPermissionError();
  }

  if (savedGroup.type !== "list") {
    throw new Error("Can only add items to ID list saved groups");
  }

  if (!items) {
    throw new Error("Must specify items to add to group");
  }

  if (!Array.isArray(items)) {
    throw new Error("Must provide a list of items to add");
  }

  const attributeSchema = org.settings?.attributeSchema || [];
  const datatype = attributeSchema.find(
    (sdkAttr) => sdkAttr.property === savedGroup.attributeKey,
  )?.datatype;
  if (!datatype) {
    throw new Error("Unknown attributeKey");
  }
  if (!ID_LIST_DATATYPES.includes(datatype)) {
    throw new Error(
      "Cannot add items to this group. The attribute key's datatype is not supported.",
    );
  }

  const approvalRequired = isRevisionRequired(context, "saved-group", id);

  await ensureLiveRevisionExists(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  // When approval is required, stack the change on top of any existing open
  // draft so the user's pending changes accumulate. When approval isn't
  // required we'll merge immediately, so base the new values on the live
  // entity and force a fresh revision below — otherwise we'd merge a draft
  // that may contain unrelated pending changes (e.g. a groupName edit) and
  // mark them as merged even though `savedGroups.update` only applies the
  // values change.
  let baseValues: string[] = savedGroup.values ?? [];
  // Whether an open draft already existed (so we emit revision.updated rather
  // than revision.created when stacking onto it).
  let hadOpenDraft = false;
  if (approvalRequired) {
    const existingRevision =
      await context.models.revisions.getOpenByTargetAndAuthor(
        "saved-group",
        id,
        context.userId,
      );
    hadOpenDraft = !!existingRevision;
    if (existingRevision) {
      const currentState = applyPatchToSnapshot(
        existingRevision.target.snapshot as SavedGroupInterface,
        normalizeProposedChanges(existingRevision.target.proposedChanges),
      );
      baseValues = currentState.values ?? [];
    }
  }
  const newValues = [...new Set([...baseValues, ...items])];
  validateListSize(
    newValues,
    org.settings?.savedGroupSizeLimit,
    context.permissions.canBypassSavedGroupSizeLimit(savedGroup.projects),
  );

  let revision = await createOrUpdateRevision(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & { id: string },
    [{ op: "replace", path: "/values", value: newValues }],
    {
      // replaceChanges: false (default) — merge with any existing proposed ops
      forceCreate: !approvalRequired, // keep any pre-existing draft untouched
    },
  );

  // When approval isn't required, merge the revision immediately so the
  // caller's change takes effect instead of leaving a stranded draft. Claim the
  // (CAS-guarded) merge before the live write so a concurrent discard can't
  // orphan a half-applied change; reopen if the write then fails.
  if (!approvalRequired) {
    revision = await context.models.revisions.merge(
      revision.id,
      context.userId,
      { bypass: false },
    );
    try {
      await context.models.savedGroups.update(savedGroup, {
        values: newValues,
      });
    } catch (e) {
      try {
        await context.models.revisions.reopen(revision.id, context.userId);
      } catch {
        // ignore — surface the original update error
      }
      throw e;
    }
    await dispatchSavedGroupRevisionEvent(context, revision, {
      type: "published",
    });
    return res.status(200).json({
      status: 200,
      requiresApproval: false,
      revision,
    });
  }

  await dispatchSavedGroupRevisionEvent(
    context,
    revision,
    hadOpenDraft ? { type: "updated", change: "values" } : { type: "created" },
  );
  return res.status(202).json({
    status: 202,
    requiresApproval: approvalRequired,
    revision,
  });
};

// endregion POST /saved-groups/:id/add-items

// region POST /saved-groups/:id/remove-items

type PostSavedGroupRemoveItemsRequest = AuthRequest<
  { items: string[] },
  { id: string }
>;

type PostSavedGroupRemoveItemsResponse =
  | { status: 200; requiresApproval?: false; revision?: Revision }
  | { status: 202; requiresApproval: boolean; revision: Revision };

/**
 * POST /saved-groups/:id/remove-items
 * Update one saved-group resource by removing the specified list of items
 * @param req
 * @param res
 */
export const postSavedGroupRemoveItems = async (
  req: PostSavedGroupRemoveItemsRequest,
  res: Response<PostSavedGroupRemoveItemsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const { items } = req.body;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  const savedGroup = await context.models.savedGroups.getById(id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  if (!context.permissions.canUpdateSavedGroup(savedGroup, savedGroup)) {
    context.permissions.throwPermissionError();
  }

  if (savedGroup.type !== "list") {
    throw new Error("Can only remove items from ID list saved groups");
  }

  if (!items) {
    throw new Error("Must specify items to remove from group");
  }

  if (!Array.isArray(items)) {
    throw new Error("Must provide a list of items to remove");
  }

  const attributeSchema = org.settings?.attributeSchema || [];
  const datatype = attributeSchema.find(
    (sdkAttr) => sdkAttr.property === savedGroup.attributeKey,
  )?.datatype;
  if (!datatype) {
    throw new Error("Unknown attributeKey");
  }
  if (!ID_LIST_DATATYPES.includes(datatype)) {
    throw new Error(
      "Cannot remove items from this group. The attribute key's datatype is not supported.",
    );
  }

  const approvalRequired = isRevisionRequired(context, "saved-group", id);

  await ensureLiveRevisionExists(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  // When approval is required, stack the change on top of any existing open
  // draft so the user's pending changes accumulate. When approval isn't
  // required we'll merge immediately, so base the new values on the live
  // entity and force a fresh revision below — otherwise we'd merge a draft
  // that may contain unrelated pending changes (e.g. a groupName edit) and
  // mark them as merged even though `savedGroups.update` only applies the
  // values change.
  let baseValues: string[] = savedGroup.values ?? [];
  // Whether an open draft already existed (so we emit revision.updated rather
  // than revision.created when stacking onto it).
  let hadOpenDraft = false;
  if (approvalRequired) {
    const existingRevision =
      await context.models.revisions.getOpenByTargetAndAuthor(
        "saved-group",
        id,
        context.userId,
      );
    hadOpenDraft = !!existingRevision;
    if (existingRevision) {
      const currentState = applyPatchToSnapshot(
        existingRevision.target.snapshot as SavedGroupInterface,
        normalizeProposedChanges(existingRevision.target.proposedChanges),
      );
      baseValues = currentState.values ?? [];
    }
  }
  const toRemove = new Set(items);
  const newValues = baseValues.filter((value: string) => !toRemove.has(value));
  validateListSize(
    newValues,
    org.settings?.savedGroupSizeLimit,
    context.permissions.canBypassSavedGroupSizeLimit(savedGroup.projects),
  );

  let revision = await createOrUpdateRevision(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & { id: string },
    [{ op: "replace", path: "/values", value: newValues }],
    {
      // replaceChanges: false (default) — merge with any existing proposed ops
      forceCreate: !approvalRequired, // keep any pre-existing draft untouched
    },
  );

  // When approval isn't required, merge the revision immediately so the
  // caller's change takes effect instead of leaving a stranded draft. Claim the
  // (CAS-guarded) merge before the live write so a concurrent discard can't
  // orphan a half-applied change; reopen if the write then fails.
  if (!approvalRequired) {
    revision = await context.models.revisions.merge(
      revision.id,
      context.userId,
      { bypass: false },
    );
    try {
      await context.models.savedGroups.update(savedGroup, {
        values: newValues,
      });
    } catch (e) {
      try {
        await context.models.revisions.reopen(revision.id, context.userId);
      } catch {
        // ignore — surface the original update error
      }
      throw e;
    }
    await dispatchSavedGroupRevisionEvent(context, revision, {
      type: "published",
    });
    return res.status(200).json({
      status: 200,
      requiresApproval: false,
      revision,
    });
  }

  await dispatchSavedGroupRevisionEvent(
    context,
    revision,
    hadOpenDraft ? { type: "updated", change: "values" } : { type: "created" },
  );
  return res.status(202).json({
    status: 202,
    requiresApproval: approvalRequired,
    revision,
  });
};

// endregion POST /saved-groups/:id/remove-items

// region PUT /saved-groups/:id

type PutSavedGroupRequest = AuthRequest<
  UpdateSavedGroupProps,
  { id: string },
  {
    skipCycleCheck?: string;
    bypassApproval?: string;
    autoPublish?: string;
    revisionId?: string;
    forceCreateRevision?: string;
    title?: string;
    comment?: string;
    revertedFrom?: string;
  }
>;

type PutSavedGroupResponse =
  | {
      status: 200;
      requiresApproval?: false;
      revision?: Revision;
    }
  | {
      status: 202;
      requiresApproval: boolean;
      revision: Revision;
    };

/**
 * PUT /saved-groups/:id
 * Update one saved-group resource
 * @param req
 * @param res
 */
export const putSavedGroup = async (
  req: PutSavedGroupRequest,
  res: Response<PutSavedGroupResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const {
    groupName,
    owner,
    values,
    condition,
    description,
    projects,
    archived,
  } = req.body;
  const skipCycleCheck = req.query.skipCycleCheck;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  const savedGroup = await context.models.savedGroups.getById(id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  // Permission check always runs regardless of approval flow status
  if (!context.permissions.canUpdateSavedGroup(savedGroup, { ...req.body })) {
    context.permissions.throwPermissionError();
  }

  const approvalRequired = isRevisionRequired(context, "saved-group", id);

  // If updating a specific revision, fetch it to compare against merged state
  const revisionId = req.query.revisionId;
  let targetRevision: Revision | null = null;
  let comparisonBase: SavedGroupInterface = savedGroup;

  if (revisionId) {
    targetRevision = await context.models.revisions.getById(revisionId);
    if (targetRevision && targetRevision.target.type === "saved-group") {
      // Apply patch ops to snapshot to get current state of the revision
      const patchedSnapshot = applyPatchToSnapshot(
        targetRevision.target.snapshot as SavedGroupInterface,
        normalizeProposedChanges(targetRevision.target.proposedChanges),
      );
      comparisonBase = { ...savedGroup, ...patchedSnapshot };
    }
  }

  // Helper to check if a value actually changed
  // If newVal is null/undefined, don't treat it as a change (form sends null for untouched fields)
  const hasChanged = (newVal: unknown, oldVal: unknown): boolean => {
    // If new value is null/undefined, assume field wasn't intentionally changed
    if (newVal == null) {
      return false;
    }
    // If old value is null/undefined but new value exists, that's a change
    if (oldVal == null) {
      return true;
    }
    // Otherwise use deep equality
    return !isEqual(newVal, oldVal);
  };

  const fieldsToUpdate: UpdateSavedGroupProps = {};

  if (
    typeof groupName !== "undefined" &&
    hasChanged(groupName, comparisonBase.groupName)
  ) {
    fieldsToUpdate.groupName = groupName;
  }
  if (typeof owner !== "undefined" && hasChanged(owner, comparisonBase.owner)) {
    fieldsToUpdate.owner = owner;
  }
  if (
    savedGroup.type === "list" &&
    values &&
    hasChanged(values, comparisonBase.values)
  ) {
    fieldsToUpdate.values = values;
    // Check that the size is within the global limit as well as any limit imposed by the organization
    validateListSize(
      values,
      org.settings?.savedGroupSizeLimit,
      context.permissions.canBypassSavedGroupSizeLimit(savedGroup.projects),
    );
  }
  if (
    savedGroup.type === "condition" &&
    condition &&
    hasChanged(condition, comparisonBase.condition)
  ) {
    // Validate condition to make sure it's valid. When skipCycleCheck=1 (used by
    // importers), still validate general JSON/syntax but skip saved-group
    // cyclic/invalid reference checks so users can fix them later.
    const allSavedGroups = await context.models.savedGroups.getAll();
    const groupMap = new Map(allSavedGroups.map((sg) => [sg.id, sg]));
    // Include the updated condition in the savedGroupsObj for validation
    groupMap.set(savedGroup.id, {
      ...savedGroup,
      condition,
    });
    const conditionRes = validateCondition(
      condition,
      groupMap,
      // When skipCycleCheck=1, skip only saved-group *cycle* checks while still
      // enforcing JSON validity and other saved-group errors (unknown group,
      // invalid nested condition, max depth).
      skipCycleCheck === "1",
    );
    if (!conditionRes.success) {
      throw new Error(conditionRes.error);
    }
    if (conditionRes.empty) {
      throw new Error("Condition cannot be empty");
    }

    fieldsToUpdate.condition = condition;
  }
  if (hasChanged(description, comparisonBase.description)) {
    if (typeof description === "string" && description.length > 100) {
      throw new Error("Description must be at most 100 characters");
    }
    fieldsToUpdate.description = description;
  }
  if (hasChanged(projects, comparisonBase.projects)) {
    if (projects) {
      await context.models.projects.ensureProjectsExist(projects);
    }
    fieldsToUpdate.projects = projects;
  }
  if (hasChanged(archived, comparisonBase.archived)) {
    fieldsToUpdate.archived = archived;
  }

  // Block archive when the saved group is still referenced. Same gate as the
  // REST archive endpoint and the front-end SavedGroupArchiveModal — it keeps
  // the invariant that archived groups have no references, so they're
  // naturally excluded from the SDK payload's `filterUsedSavedGroups` without
  // needing a separate scrub step. Only the archive transition is blocked;
  // unarchiving is always allowed.
  if (fieldsToUpdate.archived === true && !comparisonBase.archived) {
    const refs = await loadSavedGroupReferences(context, id);
    if (refs && totalSavedGroupReferences(refs) > 0) {
      const parts: string[] = [];
      if (refs.features.length) {
        parts.push(`${refs.features.length} feature(s)`);
      }
      if (refs.experiments.length) {
        parts.push(`${refs.experiments.length} experiment(s)`);
      }
      if (refs.savedGroups.length) {
        parts.push(`${refs.savedGroups.length} other saved group(s)`);
      }
      throw new Error(
        `Cannot archive saved group: it is still referenced by ${parts.join(
          ", ",
        )}. Remove these references first.`,
      );
    }
  }

  const forceCreateRevision = req.query.forceCreateRevision === "1";
  const bypassApproval = req.query.bypassApproval === "1";
  const autoPublish = req.query.autoPublish === "1";
  const title = req.query.title;
  const comment = req.query.comment;
  const revertedFrom = req.query.revertedFrom;

  // All edits flow through the revision system: if no draft-intent flag was
  // provided (revisionId/forceCreateRevision) we treat the request as an
  // implicit auto-publish so the change is still tracked as a revision and
  // merged immediately when approval isn't required.
  const wantsDraft = !!revisionId || forceCreateRevision;
  const wantsMerge = bypassApproval || autoPublish || !wantsDraft;

  // If there are no changes and the caller didn't ask for a new empty draft
  // or an explicit publish action, short-circuit.
  if (
    Object.keys(fieldsToUpdate).length === 0 &&
    !forceCreateRevision &&
    !bypassApproval &&
    !autoPublish
  ) {
    return res.status(200).json({
      status: 200,
    });
  }

  await ensureLiveRevisionExists(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  const patchOps = buildPatchOps(fieldsToUpdate as Record<string, unknown>);

  // When publishing or creating a fresh draft we force a new revision; an
  // implicit save while approval is required also forces one (wantsMerge but
  // can't merge yet). Otherwise we update the targeted draft.
  const forceCreate = wantsMerge || forceCreateRevision;

  // When updating a revision, merge changes (don't replace) to preserve other fields
  let revision = await createOrUpdateRevision(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & { id: string },
    patchOps,
    {
      // replaceChanges: false (default) — merge with existing proposed changes
      forceCreate,
      title,
      comment,
      revertedFrom,
      // Only update a specific draft revision when we're staying in draft mode
      revisionId:
        wantsDraft && !bypassApproval && !autoPublish ? revisionId : undefined,
    },
  );

  if (wantsMerge) {
    // Delegate to the adapter so the multi-project bypass rule has a single
    // source of truth (also used by the generic revision controller).
    const canBypass = getAdapter("saved-group").canBypassApproval(
      context,
      savedGroup as unknown as Record<string, unknown>,
    );

    // bypassApproval is an explicit admin override — enforce the permission server-side.
    if (bypassApproval && approvalRequired && !canBypass) {
      context.permissions.throwPermissionError();
    }

    // autoPublish is the "metadata-only shortcut": it lets non-admins publish
    // changes immediately when the org has disabled metadata review. It must
    // NOT be usable to bypass full content review — otherwise any editor could
    // append `?autoPublish=1` to skip the approval flow. Enforce server-side
    // that autoPublish is only honoured when (a) the change is limited to
    // metadata fields AND metadata review is disabled, or (b) the caller has
    // the admin bypass permission.
    if (autoPublish && approvalRequired && !canBypass) {
      // Reverts restore an already-reviewed state. When the org enables
      // "reverts bypass approval", any editor may publish a revert without
      // approval (edit permission already enforced earlier in this handler).
      const isRevertBypass =
        !!revertedFrom && !!org.settings?.revertsBypassApproval;
      if (!isRevertBypass) {
        const isMetadataOnlyChange =
          Object.keys(fieldsToUpdate).length > 0 &&
          Object.keys(fieldsToUpdate).every((k) =>
            SAVED_GROUP_METADATA_FIELDS.has(k),
          );
        const metadataReviewRequired =
          getApprovalFlowSettings(org.settings?.approvalFlows, "saved-group")
            ?.requireMetadataReview ?? true;
        if (!isMetadataOnlyChange || metadataReviewRequired) {
          context.permissions.throwPermissionError();
        }
      }
    }

    const canImmediatelyMerge =
      !approvalRequired || bypassApproval || autoPublish;

    if (canImmediatelyMerge) {
      // Only record a bypass when the caller used the explicit admin override.
      // autoPublish / no-flag represent "approval wasn't required for this
      // change", which is a normal merge, not a bypass.
      const isBypass = approvalRequired && bypassApproval;

      // Claim the (CAS-guarded) merge before the live write so a concurrent
      // discard can't orphan a half-applied change; reopen if the write fails.
      revision = await context.models.revisions.merge(
        revision.id,
        context.userId,
        {
          bypass: isBypass,
        },
      );

      try {
        await context.models.savedGroups.update(savedGroup, fieldsToUpdate);
      } catch (e) {
        try {
          await context.models.revisions.reopen(revision.id, context.userId);
        } catch {
          // ignore — surface the original update error
        }
        throw e;
      }

      await dispatchSavedGroupRevisionEvent(context, revision, {
        type: revision.revertedFrom ? "reverted" : "published",
      });

      return res.status(200).json({
        status: 200,
        revision,
      });
    }
  }

  await dispatchSavedGroupRevisionEvent(
    context,
    revision,
    forceCreate
      ? { type: "created" }
      : { type: "updated", change: deriveChange(patchOps) },
  );
  return res.status(202).json({
    status: 202,
    requiresApproval: approvalRequired,
    revision,
  });
};

// endregion PUT /saved-groups/:id

// region DELETE /saved-groups/:id

type DeleteSavedGroupRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type DeleteSavedGroupResponse =
  | {
      status: 200;
    }
  | {
      status: number;
      message: string;
    };

/**
 * DELETE /saved-groups/:id
 * Delete one saved-group resource by ID
 * @param req
 * @param res
 */
export const deleteSavedGroup = async (
  req: DeleteSavedGroupRequest,
  res: Response<DeleteSavedGroupResponse>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);

  const { org } = context;

  const savedGroup = await context.models.savedGroups.getById(id);

  if (!savedGroup) {
    res.status(403).json({
      status: 404,
      message: "Saved group not found",
    });
    return;
  }

  if (savedGroup.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this saved group",
    });
    return;
  }

  if (!context.permissions.canDeleteSavedGroup(savedGroup)) {
    context.permissions.throwPermissionError();
  }

  // Require the saved group to be archived first. Archive is reversible;
  // delete isn't, so this gives users an undo step. Archive itself still
  // flows through the approval system, but delete bypasses it.
  if (!savedGroup.archived) {
    res.status(400).json({
      status: 400,
      message: "Saved group must be archived before it can be deleted",
    });
    return;
  }

  // Reference integrity (orthogonal to the archived-first UX gate above): a
  // dangling group id silently flips live targeting, so block delete while any
  // feature/experiment/other saved group still references it.
  await assertSavedGroupDeletable(context, id);

  await context.models.savedGroups.delete(savedGroup);

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /saved-groups/:id

// region GET /saved-groups/:id/references

type SavedGroupReferencesResponse =
  | {
      status: 200;
      features: { id: string; name: string; project?: string }[];
      experiments: {
        id: string;
        name: string;
        project?: string;
        projects?: string[];
      }[];
      savedGroups: { id: string; groupName: string; projects?: string[] }[];
    }
  | { message: string };

/**
 * GET /saved-groups/:id/references
 * Returns features, experiments, and saved groups that reference this saved group.
 * Checks direct references plus one level of saved-group chaining (saved groups whose
 * condition directly contains this group's ID, and features/experiments that reference those).
 */
export const getSavedGroupReferences = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<SavedGroupReferencesResponse>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);

  const refs = await loadSavedGroupReferences(context, id);
  if (!refs) {
    res.status(404).json({ message: "Saved group not found" });
    return;
  }

  return res.status(200).json({
    status: 200,
    ...refs,
  });
};

// endregion GET /saved-groups/:id/references

export function validateListSize(
  values: Array<unknown>,
  savedGroupSizeLimit: number | undefined,
  canBypassSizeLimit: boolean,
) {
  if (
    savedGroupSizeLimit &&
    values.length > savedGroupSizeLimit &&
    !canBypassSizeLimit
  ) {
    throw new Error(
      `Your organization has imposed a maximum list length of ${savedGroupSizeLimit}`,
    );
  }
  if (new Blob([JSON.stringify(values)]).size > SAVED_GROUP_SIZE_LIMIT_BYTES) {
    throw new Error(
      `The maximum size for a list is ${formatByteSizeString(
        SAVED_GROUP_SIZE_LIMIT_BYTES,
      )}.`,
    );
  }
}

// region GET /saved-groups/draft-states

export const getSavedGroupDraftStates = async (
  req: AuthRequest<null, Record<string, never>, { ids?: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const groupIds = req.query.ids
    ? req.query.ids.split(",").filter(Boolean)
    : undefined;
  const groups = await context.models.revisions.getActiveDraftStates(
    "saved-group",
    groupIds,
  );
  return res.status(200).json({ status: 200, groups });
};

// endregion GET /saved-groups/draft-states
