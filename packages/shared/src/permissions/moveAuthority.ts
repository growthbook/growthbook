import { RevisionAction, RevisionModel } from "./revisionPermissions";

export type ProjectScoped = { project?: string; projects?: string[] };

// Whether a proposed state relocates an entity.
//
// Absent, null and "" all mean "no project", so a body sending "" for an unset
// project is not a move to global. Scalar-scoped entities (Feature Flags,
// Configs, Constants) compare one project; multi-project entities (Saved Groups)
// compare list membership, order-insensitively.
export function projectScopeChanged(
  before: ProjectScoped,
  after: ProjectScoped,
): boolean {
  if ((before.project || "") !== (after.project || "")) return true;
  const a = before.projects;
  const b = after.projects;
  if (Array.isArray(a) || Array.isArray(b)) {
    const norm = (v?: string[]) => [...(v ?? [])].sort().join("\u0000");
    return norm(a) !== norm(b);
  }
  return false;
}

/**
 * The destination of a relocation, in the shape the permission layer reads.
 *
 * Deriving this per call site is how a "destination" check ends up silently
 * re-checking the source, so it lives here and nowhere else.
 */
export function moveDestination(
  before: ProjectScoped,
  after: ProjectScoped,
): ProjectScoped {
  if (after.projects !== undefined || before.projects !== undefined) {
    return { projects: after.projects ?? [] };
  }
  return { projects: after.project ? [after.project] : [] };
}

// Whether the actor holds the DESTINATION side of a relocation, for the verb they
// are performing and over the footprint the change carries.
//
// Source checks stay with the caller, which may accept a narrower atom for a pure
// revert or archive; the destination has no such exemption, because there is no
// revision there to judge purity against.
//
// Vacuously true when nothing moves, so it is safe to call unconditionally. Shared
// with the front end so a control and its endpoint cannot disagree.
export function holdsMoveDestination({
  permissions,
  model,
  action,
  existing,
  proposed,
  environments = [],
}: {
  permissions: {
    canRevisionAction: (
      model: RevisionModel,
      action: RevisionAction,
      obj: ProjectScoped,
      environments?: string[],
    ) => boolean;
  };
  model: RevisionModel;
  action: RevisionAction;
  existing: ProjectScoped;
  proposed: ProjectScoped;
  environments?: string[];
}): boolean {
  if (!projectScopeChanged(existing, proposed)) return true;
  return permissions.canRevisionAction(
    model,
    action,
    moveDestination(existing, proposed),
    environments,
  );
}
