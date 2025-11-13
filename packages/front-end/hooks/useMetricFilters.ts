import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";

export interface MetricFilterState {
  tags: string[];
  metricGroups: string[];
}

export function useMetricFilters(experimentId: string) {
  const router = useRouter();
  const [filters, setFiltersState] = useState<MetricFilterState>({
    tags: [],
    metricGroups: [],
  });

  // Parse URL params on mount and when router query changes
  useEffect(() => {
    const tagsParam = router.query.metricTags;
    const groupsParam = router.query.metricGroups;

    const tags = tagsParam
      ? typeof tagsParam === "string"
        ? tagsParam.split(",").filter(Boolean)
        : Array.isArray(tagsParam)
          ? tagsParam.flatMap((p) =>
              typeof p === "string" ? p.split(",").filter(Boolean) : [],
            )
          : []
      : [];

    const metricGroups = groupsParam
      ? typeof groupsParam === "string"
        ? groupsParam.split(",").filter(Boolean)
        : Array.isArray(groupsParam)
          ? groupsParam.flatMap((p) =>
              typeof p === "string" ? p.split(",").filter(Boolean) : [],
            )
          : []
      : [];

    setFiltersState({
      tags: tags || [],
      metricGroups: metricGroups || [],
    });
  }, [router.query.metricTags, router.query.metricGroups]);

  // Update URL params when filters change
  const setFilters = useCallback(
    (newFilters: MetricFilterState) => {
      setFiltersState(newFilters);

      const query: Record<string, string | undefined> = {
        ...router.query,
      };

      if (newFilters.tags.length > 0) {
        query.metricTags = newFilters.tags.join(",");
      } else {
        delete query.metricTags;
      }

      if (newFilters.metricGroups.length > 0) {
        query.metricGroups = newFilters.metricGroups.join(",");
      } else {
        delete query.metricGroups;
      }

      router.replace(
        {
          pathname: router.pathname,
          query,
        },
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  const clearFilters = useCallback(() => {
    setFilters({ tags: [], metricGroups: [] });
  }, [setFilters]);

  return {
    filters,
    setFilters,
    clearFilters,
  };
}

