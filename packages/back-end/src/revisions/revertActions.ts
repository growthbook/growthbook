import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { isArchiveTransition } from "shared/util";
import { Revision } from "shared/enterprise";
import { logger } from "back-end/src/util/logger";
import { Context } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions";
import { holdsMoveDestination } from "back-end/src/revisions/moveAuthority";
import {
  applyPatchToSnapshot,
  buildPatchOps,
} from "back-end/src/revisions/util";

export type RevertStrategy = "draft" | "publish";

/**
 * Restoring a historical revision is one operation with two modes, and it was
 * implemented twelve times — once per entity per surface. That is why revert
 * produced more findings than any other verb in the permission split: each
 * implementation re-derived what "restore revision N" means and re-decided the
 * authority for landing it, and the four authority classes a revert can span
 * (project move, archive flip, environment footprint, holdout) were classified
 * independently every time.
 *
 * This module owns all of it: the target state, the change set, the authority
 * decision, and the two strategies.
 */

/**
 * The state a historical revision described once published: its own snapshot with
 * its own proposed changes applied. Every revert answers to this and nothing else.
 */
export function revertTargetState(
  targetRevision: Pick<Revision, "target">,
): Record<string, unknown> {
  return applyPatchToSnapshot(
    targetRevision.target.snapshot as Record<string, unknown>,
    targetRevision.target.proposedChanges,
  ) as Record<string, unknown>;
}

/**
 * Resolve the strategy the way every surface documents it: a draft unless the org
 * enables "reverts bypass approval", which makes an immediate publish the default.
 * Callers pass the requested strategy through verbatim.
 */
export function resolveRevertStrategy(
  requested: RevertStrategy | undefined,
  revertsBypassApproval: boolean,
): RevertStrategy {
  return requested ?? (revertsBypassApproval ? "publish" : "draft");
}

/**
 * Authority for a revert, in one place.
 *
 * `landing` is the whole distinction that kept going wrong: staging a revert
 * publishes nothing, so it answers for the project; landing one writes live state,
 * so it answers for the environments the restoration reaches. Deriving both from
 * the landing footprint locked environment-limited reverters out of even
 * proposing, and deriving both from the project let them land.
 *
 * A revert also restores whatever the target revision held, so it can span
 * authority classes the revert atom does not cover on its own: relocating the
 * entity takes authority in the destination, and restoring an archived state is
 * delete-class because it takes the entity out of service.
 */
export function assertCanRevertRevision({
  context,
  entityType,
  entity,
  fields,
  landing,
  footprint,
}: {
  context: Context;
  entityType: Parameters<typeof getAdapter>[0];
  entity: Record<string, unknown>;
  fields: Record<string, unknown>;
  landing: boolean;
  footprint: string[];
}): void {
  const scope = landing ? footprint : NO_ENVIRONMENT_BINDING;
  const scoped = entity as { project?: string; projects?: string[] };

  // The revert atom and nothing else. Publish subsumes revert when PUBLISHING a
  // revision that happens to be a pure revert — that rule belongs to the publish
  // engine — but the revert action itself is its own authority, which is the whole
  // point of a revert-only incident responder and of a publisher who cannot
  // rewrite history. Accepting publish here let publisher, creatorPublisher and
  // editor revert Configs, which the persona matrix refuses.
  const holdsRevert = context.permissions.canRevisionAction(
    entityType,
    "revert",
    scoped,
    scope,
  );

  // Staging is also open to anyone who can author drafts; landing is not.
  const permitted =
    holdsRevert ||
    (!landing &&
      context.permissions.canRevisionAction(
        entityType,
        "draft",
        scoped,
        NO_ENVIRONMENT_BINDING,
      ));
  if (!permitted) context.permissions.throwPermissionError();

  // Relocating the entity is a write to the destination, whichever mode this is.
  if (
    !holdsMoveDestination({
      permissions: context.permissions,
      model: entityType,
      action: landing ? "revert" : "draft",
      existing: scoped,
      proposed: { ...scoped, ...fields },
      environments: scope,
    })
  ) {
    context.permissions.throwPermissionError();
  }

  // Restoring an archived state takes the entity out of service, so it carries
  // the delete atom wherever it lands. Only relevant once it actually lands.
  if (
    landing &&
    isArchiveTransition({
      proposed: "archived" in fields ? !!fields.archived : undefined,
      current: entity.archived as boolean | undefined,
    }) &&
    !context.permissions.canRevisionAction(entityType, "delete", scoped, scope)
  ) {
    context.permissions.throwPermissionError();
  }
}

/**
 * Land a revert on the live entity.
 *
 * Records the merged revision before applying, so a "reverted" record never
 * exists without the live change having been attempted. When the apply fails the
 * record is removed — and unlike the per-entity copies this replaced, a failure to
 * remove it is reported rather than swallowed: a merged revision whose changes
 * never landed is phantom history, and silently leaving one behind is worse than
 * the original error.
 */
export async function applyRevertDirectly({
  context,
  entityType,
  entity,
  fields,
  patchOps,
  targetRevisionId,
  title,
  bypass,
}: {
  context: Context;
  entityType: Parameters<typeof getAdapter>[0];
  entity: Record<string, unknown> & { id: string };
  fields: Record<string, unknown>;
  patchOps: ReturnType<typeof buildPatchOps>;
  targetRevisionId: string;
  title?: string;
  bypass: boolean;
}): Promise<Revision> {
  const adapter = getAdapter(entityType);
  const merged = await context.models.revisions.createMerged({
    type: entityType,
    id: entity.id,
    snapshot: entity,
    proposedChanges: patchOps,
    bypass,
    title,
    revertedFrom: targetRevisionId,
  });

  try {
    await adapter.applyChanges(context, entity, fields, { isRevert: true });
  } catch (e) {
    try {
      await context.models.revisions.deleteById(merged.id);
    } catch (rollbackErr) {
      logger.error(
        rollbackErr,
        `Revert of ${entityType} ${entity.id} failed to apply AND failed to remove its merged revision ${merged.id}; that revision is phantom history and needs removing by hand`,
      );
    }
    throw e;
  }

  return merged;
}
