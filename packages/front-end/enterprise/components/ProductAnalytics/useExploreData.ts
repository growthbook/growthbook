import { useState, useCallback } from "react";
import type {
  ProductAnalyticsConfig,
  ProductAnalyticsResult,
} from "shared/validators";
import { useAuth } from "@/services/auth";

export function useExploreData() {
  const { apiCall } = useAuth();
  const [data, setData] = useState<ProductAnalyticsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const fetchData = useCallback(
    async (config: ProductAnalyticsConfig) => {
      setLoading(true);
      setError(null);

      try {
        // TODO: Make actual API call to backend
        // Example:
        const response = await apiCall<ProductAnalyticsResult>(
          "/product-analytics/run",
          {
            method: "POST",
            body: JSON.stringify({ config: config }),
          },
        );
        console.log("API response", response);
        setData(response);
        setLastRefreshedAt(new Date());

        // For now, use mock data generator
        // await new Promise((resolve) => setTimeout(resolve, 500));
        // const mockResponse = generateMockExploreData(config);
        // setData(mockResponse);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setData(null);
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
    lastRefreshedAt,
  };
}
