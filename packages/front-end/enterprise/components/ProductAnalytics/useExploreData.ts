import { useState, useCallback } from "react";
import type {
  ProductAnalyticsConfig,
  ProductAnalyticsExploration,
  ProductAnalyticsResult,
} from "shared/validators";
import { useAuth } from "@/services/auth";

export function useExploreData() {
  const { apiCall } = useAuth();
  const [data, setData] = useState<ProductAnalyticsExploration | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (
      config: ProductAnalyticsConfig,
    ): Promise<{
      data: ProductAnalyticsExploration | null;
      error: string | null;
    }> => {
      setLoading(true);
      setError(null);

      try {
        // TODO: Make actual API call to backend
        // Example:
        const response = await apiCall<{
          exploration: ProductAnalyticsExploration;
        }>("/product-analytics/run", {
          method: "POST",
          body: JSON.stringify({ config: config }),
        });
        console.log("API response", response);
        setData(response.exploration);

        if (response.exploration.error) {
          const err = new Error(response.exploration.error);
          setError(err.message);
          return { data: response.exploration, error: err.message };
        }
        return { data: response.exploration, error: null };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err.message);
        setData(null);
        return { data: null, error: err.message };
      } finally {
        setLoading(false);
      }
    },
    [apiCall],
  );

  return {
    data,
    loading,
    error,
    fetchData,
  };
}
