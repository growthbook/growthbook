// “All Projects” includes create access in any individual project.
export function canCreateInSelectedScope({
  project,
  projectIds,
  canCreateIn,
}: {
  /** The selected project, or falsy for "All Projects". */
  project: string | undefined;
  projectIds: string[];
  canCreateIn: (project: string | undefined) => boolean;
}): boolean {
  if (project) return canCreateIn(project);
  if (canCreateIn(undefined)) return true;
  return projectIds.some((id) => canCreateIn(id));
}
