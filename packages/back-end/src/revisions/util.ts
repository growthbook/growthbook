import { applyPatch, deepClone } from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import {
  JsonPatchOperation,
  Revision,
  RevisionTargetType,
  normalizeProposedChanges,
} from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getAdapter } from "back-end/src/revisions/index";

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
  const existing = await context.models.revisions.getByTarget(
    entityType,
    entity.id,
  );
  if (existing.length > 0) return;

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
export function applyPatchToSnapshot<T extends object>(
  snapshot: T,
  proposedChanges: JsonPatchOperation[] | unknown,
): T {
  const ops = normalizeProposedChanges(proposedChanges);
  if (ops.length === 0) return snapshot;
  return applyPatch(deepClone(snapshot), ops as Operation[], false, false)
    .newDocument as T;
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
 * Create a new revision or update an existing open one for the current user.
 * Generic: works for any entity type by delegating snapshot-building to the adapter.
 *
 * @param replaceChanges If true, replace proposed ops entirely instead of merging
 * @param forceCreate   If true, always create a new revision (don't update existing)
 * @param title         Optional title for the revision
 * @param revertedFrom  Optional ID of the revision this is reverting
 * @param revisionId    Optional specific revision ID to update (instead of finding by author)
 */
export async function createOrUpdateRevision(
  context: ReqContext | ApiReqContext,
  entityType: RevisionTargetType,
  entity: Record<string, unknown> & { id: string },
  proposedChanges: JsonPatchOperation[],
  replaceChanges = false,
  forceCreate = false,
  title?: string,
  revertedFrom?: string,
  revisionId?: string,
): Promise<Revision> {
  if (revisionId && !forceCreate) {
    const targetRevision = await context.models.revisions.getById(revisionId);
    if (targetRevision) {
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
    revertedFrom,
  });
}

/**
 * @deprecated Use `createOrUpdateRevision` with `entityType: "saved-group"` instead.
 */
export async function createOrUpdateSavedGroupRevision(
  context: ReqContext | ApiReqContext,
  savedGroup: SavedGroupInterface,
  proposedChanges: JsonPatchOperation[],
  replaceChanges = false,
  forceCreate = false,
  title?: string,
  revertedFrom?: string,
  revisionId?: string,
): Promise<Revision> {
  return createOrUpdateRevision(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & { id: string },
    proposedChanges,
    replaceChanges,
    forceCreate,
    title,
    revertedFrom,
    revisionId,
  );
}
