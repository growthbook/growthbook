// Who may widen a Feature Flag's delivery set through Targeting Projects.
//
// Governance stays with the primary project; targeting a project is a write to
// that project's SDK payloads, so it takes `targetFeatures` there. Only
// additions are gated: narrowing delivery, or leaving an existing set alone,
// takes nothing extra, so flags targeted before the gate existed keep working.

export type TargetingScoped = {
  project?: string;
  targetingAllProjects?: boolean;
  targetingProjects?: string[];
};

// Projects a proposed state newly delivers into; "all" when all-projects turns on.
export function addedTargetingProjects(
  before: TargetingScoped,
  after: TargetingScoped,
): string[] | "all" {
  if (after.targetingAllProjects) {
    return before.targetingAllProjects ? [] : "all";
  }
  if (before.targetingAllProjects) return [];
  // A primary-project move is gated by move authority, not here.
  const primary = after.project ?? before.project ?? "";
  const reached = new Set([
    before.project ?? "",
    ...(before.targetingProjects ?? []),
  ]);
  return Array.from(
    new Set(
      (after.targetingProjects ?? []).filter(
        (p) => p && p !== primary && !reached.has(p),
      ),
    ),
  );
}

// The state a sparse staged envelope (undefined = unchanged) would land.
export function withStagedTargeting(
  existing: TargetingScoped,
  staged?: Partial<TargetingScoped> | null,
): TargetingScoped {
  return {
    project: staged?.project ?? existing.project,
    targetingAllProjects:
      staged?.targetingAllProjects ?? existing.targetingAllProjects,
    targetingProjects: staged?.targetingProjects ?? existing.targetingProjects,
  };
}

// Vacuously true when nothing is added, so it is safe to call unconditionally.
// Shared with the front end so a control and its endpoint cannot disagree.
export function holdsTargetingDestination({
  permissions,
  existing,
  proposed,
}: {
  permissions: {
    canTargetFeatureProjects: (projects: string[] | "all") => boolean;
  };
  existing: TargetingScoped;
  proposed: TargetingScoped;
}): boolean {
  const added = addedTargetingProjects(existing, proposed);
  if (added !== "all" && added.length === 0) return true;
  return permissions.canTargetFeatureProjects(added);
}

// The assert form of `holdsTargetingDestination`, naming what was refused so a
// REST caller can tell a targeting refusal from any other 403.
export function assertTargetingDestination({
  permissions,
  existing,
  proposed,
}: {
  permissions: {
    canTargetFeatureProjects: (projects: string[] | "all") => boolean;
    throwPermissionError: (message?: string) => void;
  };
  existing: TargetingScoped;
  proposed: TargetingScoped;
}): void {
  const added = addedTargetingProjects(existing, proposed);
  if (added !== "all" && added.length === 0) return;
  if (permissions.canTargetFeatureProjects(added)) return;
  permissions.throwPermissionError(
    added === "all"
      ? "You do not have permission to target all projects with this Feature Flag"
      : `You do not have permission to target ${
          added.length === 1 ? "project" : "projects"
        } ${added.join(", ")} with this Feature Flag`,
  );
}
