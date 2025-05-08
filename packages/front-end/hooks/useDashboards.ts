import { useMemo } from "react";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import useApi from "./useApi";

export function useAllDashboards() {
  const { data, error, mutate } = useApi<{
    dashboards: DashboardInstanceInterface[];
  }>("/dashboards/");

  const dashboards = useMemo(() => data?.dashboards || [], [data]);

  const dashboardsMap = useMemo(
    () => new Map(dashboards.map((e) => [e.id, e])),
    [dashboards]
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
    dashboards: DashboardInstanceInterface[];
  }>(`/dashboards/by-experiment/${experimentId}`);

  const dashboards = useMemo(() => data?.dashboards || [], [data]);

  const dashboardsMap = useMemo(
    () => new Map(dashboards.map((e) => [e.id, e])),
    [dashboards]
  );

  return {
    loading: !error && !data,
    dashboards,
    dashboardsMap,
    error: error,
    mutateDashboards: mutate,
  };
}
