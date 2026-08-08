/**
 * Whether an Add control should be offered for the selected project scope.
 *
 * With a project selected the answer is just that project. With "All Projects"
 * selected it is org-wide authority OR authority in at least one project —
 * asking only the org-wide question disabled the control for anyone who can
 * create in a specific project, and one read-only project (the sample-data one)
 * was enough to hide it whenever it was the only project.
 */
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
