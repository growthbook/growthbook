import { useState, useCallback } from "react";
import type {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
  ProductAnalyticsRunComparisonPayload,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { useAuth } from "@/services/auth";

export type CacheOption = "preferred" | "required" | "never";

export type ProductAnalyticsRunComparisonResponse =
  ProductAnalyticsRunComparisonPayload & {
    query: QueryInterface | null;
  };

export function useExploreData() {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(
    async (
      config: ExplorationConfig,
      options?: {
        cache?: CacheOption;
        previousTimeFrame?: ExplorationDateRange | null;
      },
    ): Promise<{
      data: ProductAnalyticsExploration | null;
      query: QueryInterface | null;
      comparison: ProductAnalyticsRunComparisonResponse | null;
      error: string | null;
    }> => {
      const cache = options?.cache ?? "preferred";
      const silent = cache === "required";

      if (!silent) {
        setLoading(true);
      }

      const body: {
        config: ExplorationConfig;
        previousTimeFrame?: ExplorationDateRange;
      } = { config };
      if (options?.previousTimeFrame) {
        body.previousTimeFrame = options.previousTimeFrame;
      }

      try {
        const response = await apiCall<{
          exploration: ProductAnalyticsExploration | null;
          query: QueryInterface | null;
          comparison?: ProductAnalyticsRunComparisonResponse;
        }>(`/product-analytics/run?cache=${cache}`, {
          method: "POST",
          body: JSON.stringify(body),
        });

        if (response.exploration?.error) {
          const err = new Error(response.exploration.error);
          return {
            data: response.exploration,
            query: response.query || null,
            comparison: response.comparison ?? null,
            error: err.message,
          };
        }
        return {
          data: response.exploration,
          query: response.query || null,
          comparison: response.comparison ?? null,
          error: null,
        };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        return {
          data: null,
          query: null,
          comparison: null,
          error: err.message,
        };
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [apiCall],
  );

  // Fetch a single exploration by id. Used to poll for completion after a run
  // returns a still-running exploration (the backend returns an in-progress
  // model once a query exceeds the ~5s sync budget). Unlike `fetchData` this
  // reads the specific exploration by id, so it observes every terminal
  // state — success AND error — whereas the cache lookup only surfaces
  // successful explorations.
  const fetchExplorationById = useCallback(
    async (
      id: string,
    ): Promise<{
      data: ProductAnalyticsExploration | null;
      query: QueryInterface | null;
      error: string | null;
    }> => {
      try {
        const response = await apiCall<{
          exploration: ProductAnalyticsExploration | null;
          query: QueryInterface | null;
        }>(`/product-analytics/exploration/${id}`, { method: "GET" });
        return {
          data: response.exploration ?? null,
          query: response.query ?? null,
          error: response.exploration?.error ?? null,
        };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { data: null, query: null, error: err.message };
      }
    },
    [apiCall],
  );

  return {
    loading,
    fetchData,
    fetchExplorationById,
  };
}
