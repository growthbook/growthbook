import { ProjectInterface } from "shared/types/project";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";

// This hook returns list of projects user has permission for along with any projects already associated with a resource (e.g. metric.projects)
export default function useProjectOptions(
  permissionRequired: (project: string) => boolean,
  existingProjects: string[],
  filteredProjects?: ProjectInterface[],
): { label: string; value: string }[] {
  const { projects: orgProjects } = useDefinitions();
  const { orgId } = useAuth();

  // In some cases (e.g. SDKConnections) the projects we want to filter on need some custom filtering applied
  const projects: ProjectInterface[] = filteredProjects || orgProjects;

  if (!projects) return [];

  const demoProjectId = orgId
    ? getDemoDatasourceProjectIdForOrganization(orgId)
    : null;

  const filtered = projects.filter((project) => {
    // Sample Data is reserved for imported demo resources. Allow it in the
    // picker only when already on the resource so a mistaken tag can be removed.
    if (
      demoProjectId &&
      project.id === demoProjectId &&
      !existingProjects.includes(project.id)
    ) {
      return false;
    }

    // Return projects the user has permission to perform the action in AND any projects already on the resources
    return (
      existingProjects.includes(project.id) || permissionRequired(project.id)
    );
  });

  return filtered.map((project) => {
    return {
      label: project.name,
      value: project.id,
    };
  });
}
