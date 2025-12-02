import { IncrementalRefreshInterface } from "back-end/src/validators/incremental-refresh";
import useApi from "./useApi";

export function useIncrementalRefresh(experimentId: string) {
  const { data, error, mutate } = useApi<{
    incrementalRefresh: IncrementalRefreshInterface | null;
  }>(`/experiment/${experimentId}/incremental-refresh`, {
    shouldRun: () => !!experimentId,
  });

  return {
    loading: !error && !data,
    incrementalRefresh: data?.incrementalRefresh || null,
    error: error,
    mutate,
  };
}
