import { DashboardInterface } from "shared/enterprise";
import { ProjectInterface } from "shared/types/project";
import { isProjectListValidForProject } from "../../util";

// Whether a dashboard can be a Project's default. Other members can't
// read a private dashboard, so it can't be their default.
export function isDashboardEligibleAsProjectDefault(
  dashboard: Pick<
    DashboardInterface,
    "experimentId" | "shareLevel" | "projects"
  >,
  projectId: string,
): boolean {
  return (
    !dashboard.experimentId &&
    dashboard.shareLevel !== "private" &&
    isProjectListValidForProject(dashboard.projects, projectId)
  );
}

// Whether a Project's stored default is this dashboard and still counts. A
// default that later became ineligible is kept but doesn't count.
export function isProjectDefaultDashboard(
  project: Pick<ProjectInterface, "id" | "defaultDashboardId">,
  dashboard: Pick<
    DashboardInterface,
    "id" | "experimentId" | "shareLevel" | "projects"
  >,
): boolean {
  return (
    project.defaultDashboardId === dashboard.id &&
    isDashboardEligibleAsProjectDefault(dashboard, project.id)
  );
}
