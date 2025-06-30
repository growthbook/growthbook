import { useMemo } from "react";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";

export const useProjectDefinitions = (
  project?: string,
  projects?: string[]
) => {
  const {
    _factTablesIncludingArchived: allFactTables,
    datasources,
    metrics,
    factTables,
    factMetrics,
  } = useDefinitions();
  const projectFactTablesIncludingArchived = useMemo(
    () =>
      project
        ? allFactTables.filter((t) =>
            isProjectListValidForProject(t.projects, project)
          )
        : allFactTables,
    [allFactTables, project]
  );
  const projectFactTables = useMemo(
    () =>
      project
        ? factTables.filter((t) =>
            isProjectListValidForProject(t.projects, project)
          )
        : factTables,
    [factTables, project]
  );
  const projectDataSources = useMemo(
    () =>
      project
        ? datasources.filter((d) =>
            isProjectListValidForProject(d.projects, project)
          )
        : datasources,
    [datasources, project]
  );
  const projectMetrics = useMemo(() => {
    if (projects && !project) {
      if (!projects.length) return metrics;
      return metrics.filter((m) =>
        projects.some((p) => isProjectListValidForProject(m.projects, p))
      );
    }
    return metrics.filter((m) =>
      isProjectListValidForProject(m.projects, project)
    );
  }, [metrics, project, projects]);

  const projectFactMetrics = useMemo(
    () =>
      factMetrics.filter((f) =>
        isProjectListValidForProject(f.projects, project)
      ),
    [project, factMetrics]
  );
  const hasDatasource = datasources.some((d) =>
    isProjectListValidForProject(d.projects, project)
  );

  const hasFactTables = factTables.some((f) =>
    isProjectListValidForProject(f.projects, project)
  );

  const hasMetrics =
    metrics.some((m) => isProjectListValidForProject(m.projects, project)) ||
    factMetrics.some((m) => isProjectListValidForProject(m.projects, project));

  return {
    projectFactTables,
    projectFactTablesIncludingArchived,
    projectDataSources,
    projectMetrics,
    hasDatasource,
    hasFactTables,
    hasMetrics,
    projectFactMetrics,
  };
};
