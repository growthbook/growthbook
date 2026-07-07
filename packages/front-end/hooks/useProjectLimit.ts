import { isDemoDatasourceProject } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";

// Pricing Phase 1: whether the org has reached its plan's project allowance.
// The demo/sample project is excluded, matching back-end enforcement
// (ProjectModel.countNonDemoProjects). maxProjects null = unlimited.
export function useProjectLimit() {
  const { planLimits, organization } = useUser();
  const { projects } = useDefinitions();

  const nonDemoProjectCount = projects.filter(
    (p) =>
      !isDemoDatasourceProject({
        projectId: p.id,
        organizationId: organization.id,
      }),
  ).length;

  const atLimit =
    planLimits.maxProjects !== null &&
    nonDemoProjectCount >= planLimits.maxProjects;

  return {
    atLimit,
    maxProjects: planLimits.maxProjects,
    nonDemoProjectCount,
  };
}
