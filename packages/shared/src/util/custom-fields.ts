/**
 * Get warning for project scope restrictions
 */
export function getCustomFieldProjectChangeWarning(
  fromProjects: string[] | undefined,
  toProjects: string[] | undefined,
): string | null {
  const fromEmpty = !fromProjects || fromProjects.length === 0;
  const toEmpty = !toProjects || toProjects.length === 0;

  // Restricting from all projects to specific projects
  if (fromEmpty && !toEmpty) {
    return "Restricting to specific projects may make existing values in other projects inaccessible.";
  }

  // Removing projects from the list
  if (!fromEmpty && !toEmpty) {
    const removedProjects = fromProjects.filter((p) => !toProjects.includes(p));
    if (removedProjects.length > 0) {
      return "Removing projects may make existing values inaccessible.";
    }
  }

  return null;
}
