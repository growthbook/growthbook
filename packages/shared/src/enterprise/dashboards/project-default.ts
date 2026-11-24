import { DashboardInterface } from "shared/enterprise";
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
