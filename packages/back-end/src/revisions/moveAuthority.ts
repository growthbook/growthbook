import type {
  Permissions,
  RevisionAction,
  RevisionModel,
} from "shared/permissions";
import { ownershipChanged } from "back-end/src/revisions/util";

export type ProjectScoped = { project?: string; projects?: string[] };

/**
 * The destination of a relocation, in the shape the permission layer reads.
 *
 * Scalar-project entities (Feature Flags, Configs, Constants) answer for the one
 * project they land in; multi-project entities (Saved Groups) answer for the whole
 * proposed list. Deriving this per call site is how a "destination" check ends up
 * silently re-checking the source.
 */
export function moveDestination(
  existing: ProjectScoped,
  proposed: ProjectScoped,
): ProjectScoped {
  if (proposed.projects !== undefined || existing.projects !== undefined) {
    return { projects: proposed.projects ?? [] };
  }
  return { projects: proposed.project ? [proposed.project] : [] };
}

/**
 * Whether the caller holds the DESTINATION side of a relocation.
 *
 * Landing an entity in a project is a write to that project, so authority in the
 * source is never sufficient on its own. The destination takes the same verb the
 * caller is performing — `draft` to stage a move, `publish` to land one — and it
 * takes the environment footprint of the change being carried, because a move can
 * deliver per-environment content into the new project.
 *
 * Callers keep their own source check: that one may legitimately accept a narrower
 * atom (a pure revert, say, or a pure archive). The destination has no such
 * exemption — there is no revision there to judge purity against.
 *
 * Vacuously true when the proposed state does not relocate the entity, so it is
 * safe to call unconditionally.
 */
export function holdsMoveDestination({
  permissions,
  model,
  action,
  existing,
  proposed,
  environments = [],
}: {
  permissions: Pick<Permissions, "canRevisionAction">;
  model: RevisionModel;
  action: RevisionAction;
  existing: ProjectScoped;
  proposed: ProjectScoped;
  environments?: string[];
}): boolean {
  if (!isMove(existing, proposed)) return true;
  return permissions.canRevisionAction(
    model,
    action,
    moveDestination(existing, proposed),
    environments,
  );
}

/**
 * Whether the proposed state relocates the entity. Wraps `ownershipChanged` so
 * absent, null and "" all read as "no project" — otherwise a body that sends `""`
 * for an unset project registers as a move to global.
 */
export function isMove(
  existing: ProjectScoped,
  proposed: ProjectScoped,
): boolean {
  return ownershipChanged(
    { ...existing, project: existing.project || undefined },
    { ...proposed, project: proposed.project || undefined },
  );
}
