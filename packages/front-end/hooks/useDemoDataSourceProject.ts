import { ProjectInterface } from "back-end/types/project";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

type UseDemoDataSourceProject = {
  ready: boolean;
  exists: boolean;
  projectId: string | null;
  demoProject: ProjectInterface | null;
  currentProjectIsDemo: boolean;
};

export const useDemoDataSourceProject = (): UseDemoDataSourceProject => {
  const { orgId } = useAuth();
  const { getProjectById, project: currentProjectId, ready } = useDefinitions();

  // the demo project ID, if we have an orgId
  const demoProjectId: string | null = orgId
    ? getDemoDatasourceProjectIdForOrganization(orgId)
    : null;

  // the demo project, if it exists
  const project = demoProjectId ? getProjectById(demoProjectId) : null;

  const exists = !!project;

  const currentProjectIsDemo = currentProjectId === demoProjectId;

  return {
    ready,
    exists,
    projectId: demoProjectId,
    demoProject: project,
    currentProjectIsDemo,
  };
};
