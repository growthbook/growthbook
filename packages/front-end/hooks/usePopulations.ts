import { populationEndpoints } from "shared/api-endpoints";
import { useMemo } from "react";
import { isProjectListValidForProject } from "shared/util";
import { useRestApi } from "@/services/restApi";

export function usePopulations(project?: string) {
  const { data, error, mutate } = useRestApi(
    populationEndpoints.listPopulations,
    {},
  );

  const populations = useMemo(
    () =>
      (data?.populations ?? []).filter((p) =>
        isProjectListValidForProject(p.projects, project),
      ),
    [data, project],
  );

  return {
    loading: !error && !data,
    populations,
    error,
    mutate,
  };
}

export function usePopulation(id: string | undefined) {
  const { data, error, mutate } = useRestApi(
    populationEndpoints.getPopulation,
    id ? { params: { id } } : null,
  );

  return {
    loading: !!id && !error && !data,
    population: data?.population,
    error,
    mutate,
  };
}
