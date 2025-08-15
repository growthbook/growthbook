import { useMemo } from "react";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import useApi from "./useApi";

export function useAllDashboards() {
  const { data, error, mutate } = useApi<{
    dashboards: DashboardInterface[];
  }>("/dashboards");

  const dashboards = useMemo(() => data?.dashboards || [], [data]);

  const dashboardsMap = useMemo(
    () => new Map(dashboards.map((e) => [e.id, e])),
    [dashboards],
  );

  return {
    loading: !error && !data,
    dashboards,
    dashboardsMap,
    error: error,
    mutateDashboards: mutate,
  };
}

export function useDashboards(experimentId: string) {
  const { data, error, mutate } = useApi<{
    dashboards: DashboardInterface[];
  }>(`/dashboards/by-experiment/${experimentId}`);

  const dashboards = useMemo(() => data?.dashboards || [], [data]);

  const dashboardsMap = useMemo(
    () => new Map(dashboards.map((e) => [e.id, e])),
    [dashboards],
  );

  return {
    loading: !error && !data,
    dashboards,
    dashboardsMap,
    error: error,
    mutateDashboards: mutate,
  };
}
