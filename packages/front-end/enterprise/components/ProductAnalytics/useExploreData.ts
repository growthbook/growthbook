// Custom hook to fetch explore data from the backend
// TODO: Implement real backend API call

import { useState, useCallback } from "react";
import { ExploreState, ExploreSeries, ExploreQueryResponse } from "shared/enterprise";
import { useAuth } from "@/services/auth";
import { generateMockExploreData } from "@/services/mockData";

/**
 * Checks if a series is fully configured (not partial)
 */
function isSeriesComplete(series: ExploreSeries): boolean {
  if (series.type === "metric") {
    const config = series.config;
    if ("factMetricId" in config) {
      return !!config.factMetricId;
    }
  } else if (series.type === "factTable") {
    const config = series.config;
    if ("factTableId" in config) {
      return !!config.factTableId;
    }
  } else if (series.type === "sql") {
    const config = series.config;
    if ("datasourceId" in config && "sql" in config) {
      return !!config.datasourceId && !!config.sql;
    }
  }
  return false;
}

/**
 * Filters out partial series from explore state
 */
function filterPartialSeries(state: ExploreState): ExploreState {
  return {
    ...state,
    series: state.series.filter(isSeriesComplete),
  };
}

/**
 * Hook to fetch explore data from the backend
 * 
 * Usage:
 * ```tsx
 * const { data, loading, error, fetchData } = useExploreData();
 * 
 * const handleUpdate = async () => {
 *   await fetchData(exploreState);
 * };
 * ```
 */
export function useExploreData() {
  const { apiCall } = useAuth();
  const [data, setData] = useState<ExploreQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async (exploreState: ExploreState) => {
    // Filter out partial series
    const filteredState = filterPartialSeries(exploreState);

    setLoading(true);
    setError(null);

    try {
      // TODO: Make actual API call to backend
      // Example:
      // const response = await apiCall<ExploreQueryResponse>("/product-analytics/explore", {
      //   method: "POST",
      //   body: JSON.stringify(filteredState),
      // });
      // setData(response);

      // For now, use mock data generator
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      const mockResponse = generateMockExploreData(filteredState);
      setData(mockResponse);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  return {
    data,
    loading,
    error,
    fetchData,
  };
}
