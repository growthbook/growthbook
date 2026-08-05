import { isEqual } from "lodash";
import type { RevisionTargetType } from "shared/enterprise";
import { getAdapter } from "back-end/src/revisions";
import { CasConflictError, Context } from "back-end/src/models/BaseModel";
import { ConflictError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { displayEntityName } from "back-end/src/revisions/entityNames";
import { ownedRestoreValues } from "back-end/src/revisions/bulkPublish/ownedRestore";
import { applyVerifiedRestore } from "back-end/src/revisions/bulkPublish/verifiedRestore";

// The write sequencing every landing shares, extracted from the bulk pipeline so
// the single-entity paths get the same discipline: check the baseline the change
// was computed from before writing, and put the live entity back when the write
// fails partway.
//
// Without it a direct landing is read-compute-write with no guard, so two of them
// can apply in either order and leave live state contradicting the newest merged
// revision. These are optimistic (application-level) checks, matching the rest of
// the codebase — no transactions, so DocumentDB/CosmosDB stay supported.
//
// Cost: one extra indexed entity read before recording history, plus a read and a
// latest-merged lookup before the write. The pre-flight read is deliberate rather
// than folded into the second check — a doomed landing that never becomes history
// cannot leave phantom history behind if its removal then fails.

/**
 * A landing lost its race: the guarded write matched nothing, so NOTHING was
 * written. Its own class because compensation must be able to tell this apart
 * from a write that failed partway — restoring a pre-image after a rejected CAS
 * would compare live against values THIS landing never wrote, mistake the
 * concurrent winner's identical values for its own, and undo them.
 */
export class LandingConflictError extends ConflictError {
  constructor(entityType: RevisionTargetType | "feature", entityId: string) {
    super(
      `${displayEntityName(entityType)} "${entityId}" changed while this was being applied — nothing was written; retry`,
    );
    this.name = "LandingConflictError";
  }
}

function landingConflictError(
  entityType: RevisionTargetType | "feature",
  entityId: string,
): ConflictError {
  return new LandingConflictError(entityType, entityId);
}

/**
 * Run a landing's entity write, turning a lost CAS race into the same retryable
 * conflict a failed baseline check produces.
 *
 * The guarded write is what actually closes the check/write gap: `assertLandingBaseline`
 * can only prove the baseline held a moment ago, while the guard proves it still held
 * at the instant of the write. Callers wrap their write in this so the two failures
 * are indistinguishable to the client — both mean "nothing was written, retry".
 */
export async function runGuardedWrite<T>(
  entityType: RevisionTargetType | "feature",
  entityId: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (e instanceof CasConflictError) {
      throw landingConflictError(entityType, entityId);
    }
    throw e;
  }
}

/**
 * The baseline a landing computed its change from, and the identity of the merged
 * revision recording it. Re-checked immediately before the entity write.
 */
export async function assertLandingBaseline({
  context,
  entityType,
  entityId,
  baselineDateUpdated,
  requireLatestMergedId,
}: {
  context: Context;
  entityType: RevisionTargetType;
  entityId: string;
  /** `dateUpdated` of the entity the change was computed against. */
  baselineDateUpdated: Date | null;
  /**
   * When set, this revision must still be the newest merged one for the target.
   * A newer merge means another landing already recorded intent that supersedes
   * this one, so applying would overwrite it with older state.
   */
  requireLatestMergedId?: string;
}): Promise<void> {
  const fresh = await getAdapter(entityType)
    .getModel(context)
    ?.getById(entityId);
  const current = (fresh as { dateUpdated?: Date } | null)?.dateUpdated ?? null;
  if (
    (current?.getTime() ?? null) !== (baselineDateUpdated?.getTime() ?? null)
  ) {
    throw landingConflictError(entityType, entityId);
  }

  if (requireLatestMergedId) {
    const latest = await context.models.revisions.getLatestMergedByTarget(
      entityType,
      entityId,
    );
    if (latest && latest.id !== requireLatestMergedId) {
      throw landingConflictError(entityType, entityId);
    }
  }
}

/**
 * Put back the fields a failed write persisted, so a partial apply doesn't leave
 * an unrecorded live change behind.
 *
 * The same rule the bulk pipeline compensates with, and the same helpers: restore
 * a key only while live still holds the value this apply wrote, then verify every
 * restored key actually landed. Value-based, so it can't catch a concurrent writer
 * that set a key to the same value — that residual is the entity-write lost-update
 * window, closed only by CAS-guarding the apply itself.
 *
 * Throws when the restore can't be completed. Callers treat that as "live is left
 * mid-change" and keep the merged revision, since a recorded partial change can be
 * reconciled by hand and an unrecorded one cannot.
 */
export async function restoreEntityPreImage({
  context,
  entityType,
  preImage,
  persistedKeys,
  written,
}: {
  context: Context;
  entityType: RevisionTargetType;
  /** The entity as it was before the failed write. */
  preImage: Record<string, unknown> & { id: string };
  /**
   * The keys to consider putting back. Callers pass what the apply reported
   * persisting, or the intended changes when it threw before reporting — the
   * value check below makes the difference harmless, since a key the apply never
   * wrote restores to itself.
   */
  persistedKeys: Iterable<string>;
  /** The values the apply intended to write, for the "do we still own it" test. */
  written: Record<string, unknown>;
}): Promise<void> {
  const adapter = getAdapter(entityType);
  // Read-decide-write under the same guard as any landing, retried: the restore
  // decides ownership from a read, and a newer landing arriving between that
  // read and an unguarded write would be replaced by the stale pre-image. A CAS
  // loss here means someone else changed the doc — re-read, re-decide ownership
  // (their keys drop out of the restore by value), and try again.
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    const current = await adapter.getModel(context)?.getById(preImage.id);
    if (!current) {
      throw new Error(
        `landing compensation: ${entityType} "${preImage.id}" no longer exists — cannot restore its pre-image`,
      );
    }

    const restore = ownedRestoreValues({
      keys: persistedKeys,
      preImage,
      written,
      current: current as Record<string, unknown>,
    });
    try {
      await applyVerifiedRestore({
        restore,
        current: current as Record<string, unknown>,
        label: `${entityType} "${preImage.id}"`,
        // A pre-image is a state that was already live, so the restore is a
        // revert: skip the validations that exist to judge new intent.
        write: (values) =>
          adapter.applyChanges(context, current, values, {
            isRevert: true,
            guarded: true,
          }),
      });
      return;
    } catch (e) {
      if (e instanceof CasConflictError && attempt < maxAttempts) continue;
      throw e;
    }
  }
}

/**
 * Whether the live entity still holds exactly what a set of changes intended,
 * i.e. the write landed. Used to decide whether a landing that raced can report
 * success instead of asking the caller to retry.
 */
export function liveMatchesDesiredState({
  live,
  desiredState,
  updatableFields,
}: {
  live: Record<string, unknown> | null;
  desiredState: Record<string, unknown>;
  updatableFields: ReadonlySet<string>;
}): boolean {
  if (!live) return false;
  return Object.keys(desiredState).every(
    (key) => !updatableFields.has(key) || isEqual(desiredState[key], live[key]),
  );
}

/** Best-effort compensation, for paths that must report the original failure. */
export async function tryRestoreEntityPreImage(
  args: Parameters<typeof restoreEntityPreImage>[0],
): Promise<boolean> {
  try {
    await restoreEntityPreImage(args);
    return true;
  } catch (e) {
    logger.error(
      e,
      `landing compensation failed for ${args.entityType} "${args.preImage.id}" — live state is left mid-change and its merged revision is kept as the record`,
    );
    return false;
  }
}

/**
 * Detach the context's payload-refresh buffer and issue ONE deduped refresh —
 * refreshSDKPayloadCache rebuilds each affected SDK connection once per call,
 * which is what guarantees at most one rebuild per connection per request.
 */
export function flushPayloadRefreshBuffer(
  context: Context,
  event: string,
): void {
  const buffer = context.sdkPayloadRefreshBuffer;
  context.sdkPayloadRefreshBuffer = null;
  if (!buffer) return;
  // Closed: straggler producers fall through to live refreshes instead of
  // pushing into a drained array.
  buffer.closed = true;
  if (!buffer.keys.length) return;
  const seen = new Set<string>();
  const keys = buffer.keys.filter((k) => {
    const id = `${k.environment}||${k.project}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  queueSDKPayloadRefresh({
    context,
    payloadKeys: keys,
    treatEmptyProjectAsGlobal: buffer.treatEmptyProjectAsGlobal,
    auditContext: { event, model: "release" },
  });
}

/**
 * Buffer the SDK payload refreshes a landing produces and flush them ONCE when it
 * settles — the single-entity half of what bulk publish already does.
 *
 * A multi-step apply (a config root write, then its descendant cascade; a feature
 * write, then its holdout pointer) otherwise fires a refresh per step, briefly
 * broadcasting the mid-landing mix to SDKs. Deferring costs nothing: refreshes
 * rebuild from live state at flush time, so the one flush serves the landed state
 * on success and the restored state after compensation — flushed in `finally` for
 * exactly that reason.
 *
 * A scope already holding a buffer (a bulk commit, or an enclosing landing) is
 * left in charge of its own flush.
 */
export async function withBufferedPayloadRefreshes<T>(
  context: Context,
  event: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (context.sdkPayloadRefreshBuffer) return fn();
  context.sdkPayloadRefreshBuffer = {
    keys: [],
    treatEmptyProjectAsGlobal: false,
  };
  try {
    return await fn();
  } finally {
    flushPayloadRefreshBuffer(context, event);
  }
}
