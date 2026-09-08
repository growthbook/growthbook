import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { Permissions } from "shared/permissions";

/**
 * Projects a new Fact Table should be created in. Inherits the Data Source's
 * projects, minus any the user can't create Fact Tables in. A Data Source in
 * "all projects" stays global for users with global create permission, and
 * otherwise falls back to the project the user is currently viewing.
 */
export function getNewFactTableProjects({
  datasource,
  project,
  permissionsUtil,
}: {
  datasource: DataSourceInterfaceWithParams;
  project: string;
  permissionsUtil: Permissions;
}): string[] {
  const projects = datasource.projects || [];

  if (projects.length) {
    return projects.filter((p) =>
      permissionsUtil.canCreateFactTable({ projects: [p] }),
    );
  }

  return permissionsUtil.canCreateFactTable({ projects: [] })
    ? []
    : [project].filter(Boolean);
}
