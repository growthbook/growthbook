import { ProjectInterface } from "shared/types/project";
import { useDefinitions } from "@/services/DefinitionsContext";

// This hook returns list of projects user has permission for along with any projects already associated with a resource (e.g. metric.projects)
export default function useProjectOptions(
  permissionRequired: (project: string) => boolean,
  existingProjects: string[],
  filteredProjects?: ProjectInterface[],
): { label: string; value: string }[] {
  const { projects: orgProjects } = useDefinitions();

  // In some cases (e.g. SDKConnections) the projects we want to filter on need some custom filtering applied
  const projects: ProjectInterface[] = filteredProjects || orgProjects;

  if (!projects) return [];

  const filtered = projects.filter(
    // Return projects the user has permission to perform the action in AND any projects already on the resources
    (project) =>
      existingProjects.includes(project.id) || permissionRequired(project.id),
  );

  return filtered.map((project) => {
    return {
      label: project.name,
      value: project.id,
    };
  });
}
