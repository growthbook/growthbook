import { useCallback, useEffect, useState } from "react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  CacheOption,
  useExploreData,
} from "@/enterprise/components/ProductAnalytics/useExploreData";
import { explorationPollDelayMs } from "@/enterprise/components/ProductAnalytics/util";

// Runs one exploration and polls it to completion. The first load only reads
// the cache ("required"); refresh(cache) runs it again with any cache policy.
export default function useExploration(config: ExplorationConfig) {
  const { fetchData, fetchExplorationById } = useExploreData();
  const [data, setData] = useState<ProductAnalyticsExploration | null>(null);
  // False until the first cache read finishes
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (cache: CacheOption) => {
      setError(null);
      if (cache !== "required") setLoading(true);
      try {
        let { data, error } = await fetchData(config, { cache });
        // Runs past the ~5s sync budget come back "running"; poll by id
        const start = Date.now();
        while (data?.status === "running") {
          const delay = explorationPollDelayMs((Date.now() - start) / 1000);
          if (!delay) {
            error = "Timed out waiting for the query to finish.";
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
          ({ data, error } = await fetchExplorationById(data.id));
        }
        if (error) setError(error);
        else if (data?.status === "success") setData(data);
      } finally {
        setLoading(false);
        setChecked(true);
      }
    },
    [config, fetchData, fetchExplorationById],
  );

  useEffect(() => {
    refresh("required");
  }, [refresh]);

  return { data, checked, loading, error, refresh };
}
