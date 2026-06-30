import { applyPatch } from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import { cloneDeep, isEqual } from "lodash";
import {
  JsonPatchOperation,
  Revision,
  RevisionTargetType,
  normalizeProposedChanges,
} from "shared/enterprise";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getAdapter } from "back-end/src/revisions/index";

/**
 * Apply a set of JSON Patch ops to a snapshot, returning a new object.
 *
 * Clones with lodash `cloneDeep` (which preserves Date instances) and lets
 * applyPatch mutate that throwaway copy in place (mutateDocument = true).
 * Passing mutateDocument = false would make fast-json-patch internally
 * JSON-clone the input, converting Date fields (e.g. dateCreated/dateUpdated on
 * a saved-group snapshot) into ISO strings and breaking downstream serializers
 * that call `.toISOString()`.
 */
export function applyPatchToSnapshot<T extends object>(
  snapshot: T,
  proposedChanges: JsonPatchOperation[] | unknown,
): T {
  const ops = normalizeProposedChanges(proposedChanges);
  if (ops.length === 0) return snapshot;
  return applyPatch(cloneDeep(snapshot), ops as Operation[], false, true)
    .newDocument as T;
}

/**
 * Ensure a "live" merged revision exists representing the entity's current state.
 * The first time an entity participates in the revision workflow, we backfill a
 * baseline revision so the history view has a starting point. No-op if any
 * revisions already exist for this target.
 *
 * Callers must already have verified that the current user can edit the
 * underlying entity — `RevisionModel.canCreate` delegates to the entity
 * adapter's `canCreate` (which mirrors the "edit entity" permission), so a
 * caller who lacks update permission will get a permission error here.
 */
export async function ensureLiveRevisionExists(
  context: ReqContext | ApiReqContext,
  entityType: RevisionTargetType,
  entity: Record<string, unknown> & {
    id: string;
    owner?: string;
    dateCreated?: Date;
  },
): Promise<void> {
  const alreadyExists = await context.models.revisions.hasAnyByTarget(
    entityType,
    entity.id,
  );
  if (alreadyExists) return;

  const authorId = entity.owner || context.userId;
  const snapshot = getAdapter(entityType).buildSnapshot(entity);

  // Wrapped in createWithVersionRetry so that two concurrent backfill calls
  // (e.g. two users editing the same untracked entity at the same time) don't
  // collide on the unique (target.type, target.id, version) index.
  await context.models.revisions.createWithVersionRetry(() =>
    context.models.revisions.create({
      authorId,
      target: {
        type: entityType,
        id: entity.id,
        snapshot,
        proposedChanges: [] as JsonPatchOperation[],
      },
      status: "merged",
      resolution: {
        action: "merged",
        userId: authorId,
        dateCreated: entity.dateCreated || new Date(),
      },
      activityLog: [],
      reviews: [],
    } as unknown as Parameters<typeof context.models.revisions.create>[0]),
  );
}

/**
 * Check whether the approval-flow revision workflow is required for the given
 * entity type in this org. Delegates to the entity adapter so entity-specific
 * settings stay in one place.
 */
export function isRevisionRequired(
  context: ReqContext | ApiReqContext,
  resourceType: RevisionTargetType,
  _resourceId: string,
): boolean {
  return getAdapter(resourceType).isRevisionRequired(context);
}

/**
 * Apply a JSON Patch (RFC 6902) operations array to a snapshot object and return
 * the patched document. The original snapshot is never mutated.
 */

/**
 * Compute the desired final state for a merge by layering the revision's
 * proposed changes on top of the LIVE entity (not the baseline snapshot).
 *
 * Why on top of live: applying ops to the baseline produces a fully
 * materialised object containing every baseline-known field at its baseline
 * value. If a field was changed out-of-band between snapshot time and merge
 * time, that drift would be quietly overwritten with the baseline value
 * during the merge, even though the revision never proposed to change it.
 * Applying ops to live preserves out-of-band changes to fields the revision
 * did not touch.
 *
 * The op list is filtered to "effective" ops first:
 *  - Drop ops whose top-level path isn't in `updatableFields` (the entity's
 *    write allowlist).
 *  - Drop `add`/`replace` ops whose value equals the baseline value (these
 *    represent no real change vs the snapshot, so applying them to live
 *    would overwrite legitimate live drift).
 *  - Drop `remove` ops on fields the baseline didn't define.
 *  - Drop `move` / `copy` / `test` ops outright (they're accepted by the
 *    validator but not modelled by the rest of the revision pipeline).
 */
export function buildMergeDesiredState<T extends Record<string, unknown>>(
  liveEntity: T,
  baseSnapshot: Record<string, unknown>,
  proposedChanges: JsonPatchOperation[] | unknown,
  updatableFields: ReadonlySet<string>,
): T {
  const ops = normalizeProposedChanges(proposedChanges);
  const effectiveOps = ops.filter((op) => {
    const field = op.path.split("/")[1];
    if (!field || !updatableFields.has(field)) return false;
    if (op.op === "replace" || op.op === "add") {
      return !isEqual(op.value, baseSnapshot[field]);
    }
    if (op.op === "remove") {
      return baseSnapshot[field] !== undefined;
    }
    return false;
  });
  return applyPatchToSnapshot(liveEntity, effectiveOps);
}

/**
 * Convert a plain partial-update object into an array of JSON Patch `replace` operations.
 * Undefined/null values are skipped since they represent "no change".
 */
export function buildPatchOps(
  changes: Record<string, unknown>,
): JsonPatchOperation[] {
  return Object.entries(changes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      op: "replace" as const,
      path: `/${key}`,
      value,
    }));
}

/**
 * Merge new patch operations into an existing array using an upsert-by-path strategy:
 * for each new op, replace any existing op with the same path; otherwise append.
 */
function upsertByPath(
  existing: JsonPatchOperation[],
  incoming: JsonPatchOperation[],
): JsonPatchOperation[] {
  const result = [...existing];
  for (const newOp of incoming) {
    const idx = result.findIndex((o) => o.path === newOp.path);
    if (idx >= 0) {
      result[idx] = newOp;
    } else {
      result.push(newOp);
    }
  }
  return result;
}

/**
 * Options for `createOrUpdateRevision`. All fields are optional; defaults match
 * the historical positional defaults the call site relied on.
 *
 * @property replaceChanges If true, replace proposed ops entirely instead of merging
 * @property forceCreate    If true, always create a new revision (don't update existing)
 * @property title          Optional title for the revision
 * @property comment        Optional free-form comment captured at draft creation
 * @property revertedFrom   Optional ID of the revision this is reverting
 * @property revisionId     Optional specific revision ID to update (instead of finding by author)
 */
export type CreateOrUpdateRevisionOptions = {
  replaceChanges?: boolean;
  forceCreate?: boolean;
  title?: string;
  comment?: string;
  revertedFrom?: string;
  revisionId?: string;
};

/**
 * Create a new revision or update an existing open one for the current user.
 * Generic: works for any entity type by delegating snapshot-building to the adapter.
 */
export async function createOrUpdateRevision(
  context: ReqContext | ApiReqContext,
  entityType: RevisionTargetType,
  entity: Record<string, unknown> & { id: string },
  proposedChanges: JsonPatchOperation[],
  options: CreateOrUpdateRevisionOptions = {},
): Promise<Revision> {
  const {
    replaceChanges = false,
    forceCreate = false,
    title,
    comment,
    revertedFrom,
    revisionId,
  } = options;

  if (revisionId && !forceCreate) {
    const targetRevision = await context.models.revisions.getById(revisionId);
    if (targetRevision) {
      // Guard against cross-entity writes: a caller could pass a revisionId
      // that belongs to a different entity (same org) and we'd otherwise
      // write entity A's proposed changes into entity B's draft. Reject
      // any mismatched revision instead of silently corrupting the target.
      if (
        targetRevision.target.type !== entityType ||
        targetRevision.target.id !== entity.id
      ) {
        throw new Error("Revision does not belong to the specified entity");
      }

      const finalChanges = replaceChanges
        ? proposedChanges
        : upsertByPath(
            normalizeProposedChanges(targetRevision.target.proposedChanges),
            proposedChanges,
          );

      return context.models.revisions.updateProposedChanges(
        targetRevision.id,
        finalChanges,
        context.userId,
      );
    }
  }

  if (!forceCreate) {
    const existingRevision =
      await context.models.revisions.getOpenByTargetAndAuthor(
        entityType,
        entity.id,
        context.userId,
      );
    if (existingRevision) {
      const finalChanges = replaceChanges
        ? proposedChanges
        : upsertByPath(
            normalizeProposedChanges(existingRevision.target.proposedChanges),
            proposedChanges,
          );

      return context.models.revisions.updateProposedChanges(
        existingRevision.id,
        finalChanges,
        context.userId,
      );
    }
  }

  const snapshot = getAdapter(entityType).buildSnapshot(entity);

  return context.models.revisions.createRequest({
    type: entityType,
    id: entity.id,
    snapshot,
    proposedChanges,
    title,
    comment,
    revertedFrom,
  });
}
