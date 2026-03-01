import { useState, useCallback } from "react";
import type {
  ProductAnalyticsConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { useAuth } from "@/services/auth";

export type CacheOption = "preferred" | "required" | "never";

export function useExploreData() {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(
    async (
      config: ProductAnalyticsConfig,
      options?: { cache?: CacheOption },
    ): Promise<{
      data: ProductAnalyticsExploration | null;
      query: QueryInterface | null;
      error: string | null;
    }> => {
      const cache = options?.cache ?? "preferred";
      const silent = cache === "required";

      if (!silent) {
        setLoading(true);
      }

      try {
        const response = await apiCall<{
          exploration: ProductAnalyticsExploration | null;
          query: QueryInterface | null;
        }>(`/product-analytics/run?cache=${cache}`, {
          method: "POST",
          body: JSON.stringify({ config }),
        });

        if (response.exploration?.error) {
          const err = new Error(response.exploration.error);
          return {
            data: response.exploration,
            query: response.query || null,
            error: err.message,
          };
        }
        // cache=required can return null when no cached result exists
        return {
          data: response.exploration,
          query: response.query || null,
          error: null,
        };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { data: null, query: null, error: err.message };
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [apiCall],
  );

  return {
    loading,
    fetchData,
  };
}
