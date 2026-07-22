import { useMemo } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useCombinedMetrics } from "@/components/Metrics/MetricsList";
import { useUser } from "@/services/UserContext";
import { SearchFiltersItem } from "@/components/Search/SearchFilters";

/**
 * Single source of truth for the experiment-filter taxonomy (tags, metrics,
 * owners, result / status / type option lists). Consumed by both
 * ExperimentSearchFilters (wide dropdown row) and SidebarExperimentFilters
 * (compact accordion) so the two presentations can't drift.
 */
export interface ExperimentFilterCategories {
  availableTags: string[];
  metricItems: SearchFiltersItem[];
  owners: string[];
  resultItems: SearchFiltersItem[];
  statusItems: SearchFiltersItem[];
  typeItems: SearchFiltersItem[];
}

export function useExperimentFilterCategories({
  experiments,
  allowDrafts = true,
}: {
  experiments: ExperimentInterfaceStringDates[];
  allowDrafts?: boolean;
}): ExperimentFilterCategories {
  const { getOwnerDisplay } = useUser();
  const allMetrics = useCombinedMetrics({});

  const availableTags = useMemo(() => {
    const tags: string[] = [];
    experiments.forEach((item) => {
      item.tags?.forEach((tag) => {
        if (!tags.includes(tag)) tags.push(tag);
      });
    });
    return tags;
  }, [experiments]);

  const metricItems = useMemo(() => {
    const map = new Map<string, SearchFiltersItem>();
    allMetrics.forEach((m) => {
      map.set(m.id, {
        name: m.name,
        id: m.id,
        // Serialize the metric id into the search string: the backend matches
        // metric:<value> against metric IDs, and the client search matches both
        // id and name, so the id works on both paths. Display uses `name`.
        searchValue: m.id,
        disabled: true,
      });
    });
    experiments.forEach((e) => {
      const enableMetric = (metricId: string) => {
        if (metricId && map.has(metricId)) {
          map.set(metricId, { ...map.get(metricId)!, disabled: false });
        }
      };
      e.goalMetrics?.forEach(enableMetric);
      e.secondaryMetrics?.forEach(enableMetric);
      e.guardrailMetrics?.forEach(enableMetric);
    });
    return Array.from(map.values());
  }, [allMetrics, experiments]);

  const owners = useMemo(() => {
    const set = new Set<string>();
    experiments.forEach((e) => {
      if (e.owner) set.add(getOwnerDisplay(e.owner));
    });
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [experiments, getOwnerDisplay]);

  const resultItems = useMemo<SearchFiltersItem[]>(
    () => [
      { searchValue: "won", id: "isWon", name: "Won" },
      { searchValue: "lost", id: "isLost", name: "Lost" },
      {
        searchValue: "inconclusive",
        id: "isInconclusive",
        name: "Inconclusive",
      },
      { searchValue: "dnf", id: "isDNF", name: "Did not finish" },
    ],
    [],
  );

  const statusItems = useMemo<SearchFiltersItem[]>(
    () => [
      {
        searchValue: "draft",
        id: "draft",
        name: "Draft",
        disabled: !allowDrafts,
      },
      { searchValue: "running", id: "running", name: "Running" },
      { searchValue: "stopped", id: "stopped", name: "Stopped" },
    ],
    [allowDrafts],
  );

  const typeItems = useMemo<SearchFiltersItem[]>(() => {
    const available = new Set<string>();
    experiments.forEach((e) => {
      if (e.linkedFeatures) available.add("feature");
      if (e.hasURLRedirects) available.add("redirect");
      if (e.hasVisualChangesets) available.add("visualChange");
    });
    return [
      {
        name: "Feature Flag",
        id: "exp-type-flag",
        searchValue: "feature",
        disabled: !available.has("feature"),
      },
      {
        name: "Visual Change",
        id: "exp-type-visual",
        searchValue: "visualChange",
        disabled: !available.has("visualChange"),
      },
      {
        name: "URL Redirect",
        id: "exp-type-redirect",
        searchValue: "redirect",
        disabled: !available.has("redirect"),
      },
    ];
  }, [experiments]);

  return {
    availableTags,
    metricItems,
    owners,
    resultItems,
    statusItems,
    typeItems,
  };
}
