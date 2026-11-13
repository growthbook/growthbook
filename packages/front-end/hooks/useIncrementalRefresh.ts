import { IncrementalRefreshInterface } from "shared/validators";
import useApi from "./useApi";

export function useIncrementalRefresh(experimentId: string) {
  const { data, error, mutate } = useApi<{
    incrementalRefresh: IncrementalRefreshInterface | null;
    // Reasons a Full Refresh is needed that only the server can see.
    fullRefreshReasons?: string[];
  }>(`/experiment/${experimentId}/incremental-refresh`, {
    shouldRun: () => !!experimentId,
  });

  return {
    loading: !error && !data,
    incrementalRefresh: data?.incrementalRefresh || null,
    serverFullRefreshReasons: data?.fullRefreshReasons,
    error: error,
    mutate,
  };
}
