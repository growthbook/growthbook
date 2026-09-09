import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { DetectedFactTableColumn } from "shared/types/fact-table";
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

/**
 * Column mapping happens after the SQL step, but the candidates are already
 * known from the detected types, so a query that can never map is caught while
 * the SQL is still on screen. An undetected type ("") is unknown, not wrong,
 * so it stays a candidate for both.
 */
export const isTimestampCandidate = (c: DetectedFactTableColumn) =>
  ["date", "other", ""].includes(c.datatype);

export const isIdentifierCandidate = (c: DetectedFactTableColumn) =>
  ["string", "number", "other", ""].includes(c.datatype);

export function getColumnMappingError(
  columns: DetectedFactTableColumn[],
): string | null {
  if (!columns.some(isTimestampCandidate)) {
    return "Your query must return a date column to use as the timestamp.";
  }
  if (!columns.some(isIdentifierCandidate)) {
    return "Your query must return a string or number column to use as an identifier.";
  }
  // A single column can satisfy both checks when its type is unknown, but the
  // timestamp and the identifier have to be different columns.
  if (columns.length < 2) {
    return "Your query must return separate timestamp and identifier columns.";
  }
  return null;
}
