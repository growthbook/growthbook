import { ProjectInterface } from "shared/types/project";
import {
  DEMO_DATASOURCE_HOST,
  getDemoDataSourceFeatureId,
  getDemoDatasourceProjectIdForOrganization,
} from "shared/demo-datasource";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useMemo } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";

type UseDemoDataSourceProject = {
  ready: boolean;
  exists: boolean;
  projectId: string | null;
  demoFeatureId: string | null;
  demoDataSourceId: string | null;
  demoExperimentId: string | null;
  demoProject: ProjectInterface | null;
  currentProjectIsDemo: boolean;
};

export const useDemoDataSourceProject = (): UseDemoDataSourceProject => {
  const { orgId } = useAuth();
  const {
    getProjectById,
    datasources,
    project: currentProjectId,
    ready,
  } = useDefinitions();

  // the demo project ID, if we have an orgId
  const demoProjectId: string | null = orgId
    ? getDemoDatasourceProjectIdForOrganization(orgId)
    : null;

  const { experiments } = useExperiments(demoProjectId || undefined);

  // the demo project, if it exists
  const project = demoProjectId ? getProjectById(demoProjectId) : null;

  const exists = !!project;

  const currentProjectIsDemo = currentProjectId === demoProjectId;

  const demoFeatureId = getDemoDataSourceFeatureId();

  // Prefer the known sample-data host so a user resource mistakenly tagged
  // with only the Sample Data project is not treated as the demo datasource.
  const demoDataSource: DataSourceInterfaceWithParams | null = useMemo(() => {
    if (!demoProjectId) return null;

    return (
      datasources.find(
        (d) =>
          d.type === "postgres" &&
          d.params &&
          "host" in d.params &&
          d.params.host === DEMO_DATASOURCE_HOST,
      ) ||
      datasources.find(
        (d) => d.projects?.length === 1 && d.projects[0] === demoProjectId,
      ) ||
      null
    );
  }, [datasources, demoProjectId]);
  const demoDataSourceId = demoDataSource?.id || null;

  // We assume the demo experiment is the one under the demo project
  const demoExperiment: ExperimentInterfaceStringDates | null = useMemo(() => {
    if (!demoProjectId) return null;

    return experiments.find((d) => d.project === demoProjectId) || null;
  }, [experiments, demoProjectId]);
  const demoExperimentId = demoExperiment?.id || null;

  return {
    ready,
    exists,
    projectId: demoProjectId,
    demoProject: project,
    currentProjectIsDemo,
    demoFeatureId,
    demoDataSourceId,
    demoExperimentId,
  };
};
