import { populationEndpoints } from "shared/api-endpoints";
import { useMemo } from "react";
import { ApiPopulation } from "shared/validators";
import { isProjectListValidForProject } from "shared/util";
import useSWR from "swr";
import { useAuth } from "@/services/auth";
import { useRestApi, useRestApiCall } from "@/services/restApi";

// The list endpoint defaults to 10 and rejects a limit above 100. Ask for the
// maximum page and follow nextOffset so this hook still returns every
// population the caller can read.
const POPULATION_PAGE_LIMIT = 100;

export function usePopulations(
  project?: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { orgId } = useAuth();
  const restApiCall = useRestApiCall();
  const { data, error, mutate } = useSWR<ApiPopulation[], Error>(
    enabled && orgId ? `${orgId}::/api/v1/populations` : null,
    async () => {
      const populations: ApiPopulation[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = await restApiCall(populationEndpoints.listPopulations, {
          query: { limit: POPULATION_PAGE_LIMIT, offset },
        });
        populations.push(...page.populations);
        const nextOffset = page.nextOffset ?? null;
        offset =
          page.hasMore && nextOffset !== null && nextOffset > offset
            ? nextOffset
            : null;
      }
      return populations;
    },
  );

  const populations = useMemo(
    () =>
      (data ?? []).filter((p) =>
        isProjectListValidForProject(p.projects, project),
      ),
    [data, project],
  );

  return {
    loading: enabled && !error && !data,
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
