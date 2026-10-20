import { useMemo } from "react";
import type { AIChatMentionType } from "shared/ai-chat";
import { useDefinitions } from "@/services/DefinitionsContext";
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

export function metricTypeLabel(
  kind: AIChatMentionType,
  rawType?: string,
): string {
  if (kind === "metricGroup") return "Metric Group";
  if (kind === "factMetric") {
    return FACT_METRIC_LABELS[rawType ?? ""] ?? "Fact Metric";
  }
  return LEGACY_METRIC_LABELS[rawType ?? ""] ?? "Metric";
}

export function useMetricMentionItems(datasourceId?: string): {
  items: MentionItem[];
  ready: boolean;
} {
  const { metrics, factMetrics, metricGroups, ready } = useDefinitions();

  const items = useMemo(() => {
    const items: MentionItem[] = [];

    for (const m of metrics) {
      if (datasourceId && m.datasource !== datasourceId) continue;
      items.push({
        id: m.id,
        label: m.name,
        metricType: "metric",
        typeLabel: metricTypeLabel("metric", m.type),
      });
    }
    for (const m of factMetrics) {
      if (datasourceId && m.datasource !== datasourceId) continue;
      items.push({
        id: m.id,
        label: m.name,
        metricType: "factMetric",
        typeLabel: metricTypeLabel("factMetric", m.metricType),
      });
    }
    if (!datasourceId) {
      for (const g of metricGroups) {
        items.push({
          id: g.id,
          label: g.name,
          metricType: "metricGroup",
          typeLabel: metricTypeLabel("metricGroup"),
        });
      }
    }

    return items.sort((a, b) => a.label.localeCompare(b.label));
  }, [metrics, factMetrics, metricGroups, datasourceId]);

  return { items, ready };
}
