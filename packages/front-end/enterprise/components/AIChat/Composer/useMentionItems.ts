import { useMemo } from "react";
import type { AIChatMentionType } from "shared/ai-chat";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useDashboards } from "@/hooks/useDashboards";
import type { MentionItem } from "./extensions/metricMention";

const FACT_METRIC_LABELS: Record<string, string> = {
  proportion: "Proportion",
  mean: "Mean",
  ratio: "Ratio",
  retention: "Retention",
  quantile: "Quantile",
  dailyParticipation: "Daily Participation",
  funnel: "Funnel",
};

const LEGACY_METRIC_LABELS: Record<string, string> = {
  binomial: "Binomial",
  count: "Count",
  duration: "Duration",
  revenue: "Revenue",
};

export function mentionTypeLabel(
  kind: AIChatMentionType,
  rawType?: string,
): string {
  if (kind === "dashboard") return "Dashboard";
  if (kind === "metricGroup") return "Metric Group";
  if (kind === "factMetric") {
    return FACT_METRIC_LABELS[rawType ?? ""] ?? "Fact Metric";
  }
  return LEGACY_METRIC_LABELS[rawType ?? ""] ?? "Metric";
}

export function useMentionItems(datasourceId?: string): {
  items: MentionItem[];
  ready: boolean;
} {
  const { metrics, factMetrics, metricGroups, ready } = useDefinitions();
  // Analytics dashboards only. A per-experiment dashboard belongs to its
  // experiment's page and none of the dashboard skills can touch it, so
  // offering one here would only produce a dead end.
  const { dashboards, loading: dashboardsLoading } = useDashboards(false);

  const items = useMemo(() => {
    const items: MentionItem[] = [];

    for (const m of metrics) {
      if (datasourceId && m.datasource !== datasourceId) continue;
      items.push({
        id: m.id,
        label: m.name,
        metricType: "metric",
        typeLabel: mentionTypeLabel("metric", m.type),
      });
    }
    for (const m of factMetrics) {
      if (datasourceId && m.datasource !== datasourceId) continue;
      items.push({
        id: m.id,
        label: m.name,
        metricType: "factMetric",
        typeLabel: mentionTypeLabel("factMetric", m.metricType),
      });
    }
    if (!datasourceId) {
      for (const g of metricGroups) {
        items.push({
          id: g.id,
          label: g.name,
          metricType: "metricGroup",
          typeLabel: mentionTypeLabel("metricGroup"),
        });
      }
    }
    // Not filtered by datasource: a dashboard is not scoped to one, so it stays
    // offerable whichever datasource the chat is pointed at.
    for (const d of dashboards) {
      items.push({
        id: d.id,
        label: d.title,
        metricType: "dashboard",
        typeLabel: mentionTypeLabel("dashboard"),
      });
    }

    return items.sort((a, b) => a.label.localeCompare(b.label));
  }, [metrics, factMetrics, metricGroups, dashboards, datasourceId]);

  // Both sources have to land before the list is complete. Reporting ready too
  // early makes the composer mark every not-yet-loaded mention stale.
  return { items, ready: ready && !dashboardsLoading };
}
