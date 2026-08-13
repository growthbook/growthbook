import { useMemo } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import type { MentionItem } from "./extensions/metricMention";

/**
 * Metrics offered by the composer's `@` menu.
 *
 * Everything comes from `useDefinitions`, which the app already loads org-wide,
 * so no extra request is needed. Archived entries are excluded — the context's
 * `metrics` / `factMetrics` are the active sets.
 *
 * Pass a datasource id to scope the list, which the PA chat needs: it runs
 * queries against one datasource, so offering metrics from another would
 * produce a chart that can't run. Metric groups have no datasource of their own,
 * so they are dropped entirely when scoping.
 */
export function useMetricMentionItems(datasourceId?: string): MentionItem[] {
  const { metrics, factMetrics, metricGroups } = useDefinitions();

  return useMemo(() => {
    const items: MentionItem[] = [];

    for (const m of metrics) {
      if (datasourceId && m.datasource !== datasourceId) continue;
      items.push({ id: m.id, label: m.name, metricType: "metric" });
    }
    for (const m of factMetrics) {
      if (datasourceId && m.datasource !== datasourceId) continue;
      items.push({ id: m.id, label: m.name, metricType: "factMetric" });
    }
    if (!datasourceId) {
      for (const g of metricGroups) {
        items.push({ id: g.id, label: g.name, metricType: "metricGroup" });
      }
    }

    return items.sort((a, b) => a.label.localeCompare(b.label));
  }, [metrics, factMetrics, metricGroups, datasourceId]);
}
