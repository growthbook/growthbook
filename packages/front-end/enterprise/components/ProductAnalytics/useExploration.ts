import { useCallback, useEffect, useState } from "react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  CacheOption,
  useExploreData,
} from "@/enterprise/components/ProductAnalytics/useExploreData";
import useExplorationRunner from "@/enterprise/components/ProductAnalytics/useExplorationRunner";

// One exploration's result for a widget. The first load only reads the cache
// ("required"); refresh(cache) runs it again. Polling and supersession are
// the shared runner's.
export default function useExploration(config: ExplorationConfig) {
  const { fetchData } = useExploreData();
  const { begin } = useExplorationRunner();
  const [data, setData] = useState<ProductAnalyticsExploration | null>(null);
  // False until the first cache read finishes
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (cache: CacheOption) => {
      const run = begin();
      setError(null);
      if (cache !== "required") setLoading(true);
      const startTime = Date.now();
      let result = await fetchData(config, { cache });
      if (!run.isCurrent()) return;
      if (result.data?.status === "running") {
        const outcome = await run.pollUntilDone([result], startTime);
        if (!outcome) return;
        result = { ...result, ...outcome.results[0] };
        if (outcome.timedOut) {
          result.error = "Timed out waiting for the query to finish.";
        }
      }
      if (result.error) setError(result.error);
      else if (result.data?.status === "success") setData(result.data);
      setLoading(false);
      setChecked(true);
    },
    [config, fetchData, begin],
  );

  useEffect(() => {
    refresh("required");
  }, [refresh]);

  return { data, checked, loading, error, refresh };
}
