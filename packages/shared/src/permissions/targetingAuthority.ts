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

type TargetingPermissions = {
  canTargetFeatureProjects: (projects: string[] | "all") => boolean;
};
type TargetingChange = {
  permissions: TargetingPermissions;
  existing: TargetingScoped;
  proposed: TargetingScoped;
  // Projects whose `allowTargeting` is off; they refuse to be newly added, and
  // "all projects" cannot turn on while any exists.
  optedOut?: readonly string[];
};
export type TargetingRefusal =
  | { cause: "opted-out"; added: string[] | "all"; projects: string[] }
  | { cause: "permission"; added: string[] | "all" };

// Why the proposed state may not be reached, or null when nothing is added or
// the caller may add it. Shared with the front end so a control and its
// endpoint cannot disagree.
export function targetingRefusal({
  permissions,
  existing,
  proposed,
  optedOut = [],
}: TargetingChange): TargetingRefusal | null {
  const added = addedTargetingProjects(existing, proposed);
  if (added !== "all" && added.length === 0) return null;
  const refused = refusedTargetingProjects(added, optedOut);
  if (refused.length) return { cause: "opted-out", added, projects: refused };
  return permissions.canTargetFeatureProjects(added)
    ? null
    : { cause: "permission", added };
}

export function holdsTargetingDestination(change: TargetingChange): boolean {
  return targetingRefusal(change) === null;
}

// Which of the added projects refuse targeting; every opted-out project when
// the addition is "all".
function refusedTargetingProjects(
  added: string[] | "all",
  optedOut: readonly string[],
): string[] {
  if (added === "all") return [...optedOut];
  return added.filter((p) => optedOut.includes(p));
}

// Names what was refused so a REST caller can tell a targeting refusal from
// any other 403.
export function assertTargetingDestination({
  permissions,
  ...change
}: TargetingChange & {
  permissions: TargetingPermissions & {
    throwPermissionError: (message?: string) => void;
  };
}): void {
  const refusal = targetingRefusal({ permissions, ...change });
  if (!refusal) return;
  const { added } = refusal;
  if (refusal.cause === "opted-out") {
    permissions.throwPermissionError(
      added === "all"
        ? "Cannot target all projects: one or more projects do not allow targeting from other projects' Feature Flags"
        : `${refusal.projects.join(", ")} ${
            refusal.projects.length === 1 ? "does" : "do"
          } not allow targeting from other projects' Feature Flags`,
    );
  }
  permissions.throwPermissionError(
    added === "all"
      ? "You do not have permission to target all projects with this Feature Flag"
      : `You do not have permission to target ${
          added.length === 1 ? "project" : "projects"
        } ${added.join(", ")} with this Feature Flag`,
  );
}
