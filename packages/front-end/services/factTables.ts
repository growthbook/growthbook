import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { FactTableColumnType } from "shared/types/fact-table";
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

export const DATATYPE_OPTIONS: { value: FactTableColumnType; label: string }[] =
  [
    { value: "number", label: "Number" },
    { value: "string", label: "String" },
    { value: "date", label: "Date/Time" },
    { value: "boolean", label: "Boolean" },
    { value: "json", label: "JSON" },
    { value: "binary", label: "Binary" },
    { value: "other", label: "Other" },
  ];

export function datatypeLabel(datatype: FactTableColumnType): string {
  return DATATYPE_OPTIONS.find((o) => o.value === datatype)?.label || "Unknown";
}
