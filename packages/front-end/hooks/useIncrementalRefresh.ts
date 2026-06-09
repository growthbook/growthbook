import {
  IncrementalRefreshInterface,
  SnapshotRunnerInfo,
} from "shared/validators";
import useApi from "./useApi";

export function useIncrementalRefresh(experimentId: string) {
  const { data, error, mutate } = useApi<{
    incrementalRefresh: IncrementalRefreshInterface | null;
    nextUpdatePlan: SnapshotRunnerInfo | null;
  }>(`/experiment/${experimentId}/incremental-refresh`, {
    shouldRun: () => !!experimentId,
  });

  return {
    loading: !error && !data,
    incrementalRefresh: data?.incrementalRefresh ?? null,
    nextUpdatePlan: data?.nextUpdatePlan ?? null,
    error: error,
    mutate,
  };
}
