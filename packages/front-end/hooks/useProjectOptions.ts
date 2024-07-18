import { ProjectInterface } from "@back-end/types/project";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function useProjectOptions(
  permissionRequired: (project: string) => boolean,
  existingProjects: string[],
  filteredProjects?: ProjectInterface[]
): { label: string; value: string }[] {
  const { projects: orgProjects } = useDefinitions();

  const projects: ProjectInterface[] = filteredProjects || orgProjects;

  if (!projects) return [];
  const existing = existingProjects || [];

  const filtered = projects.filter(
    (project) => existing.includes(project.id) || permissionRequired(project.id)
  );

  return filtered.map((project) => {
    return {
      label: project.name,
      value: project.id,
    };
  });
}
