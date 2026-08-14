import { useMemo } from "react";
import type { AIChatMentionType } from "shared/ai-chat";
import { useDefinitions } from "@/services/DefinitionsContext";
import type { MentionItem } from "./extensions/metricMention";

// The statistical type, which is what the Metrics page shows and what actually
// tells the metrics apart — "Fact Metric" only says how it is defined.
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

/**
 * Display label for a mention's type.
 *
 * `rawType` is the metric's own type field — `metricType` on a fact metric,
 * `type` on a legacy one. Metric groups have neither, and an unrecognised value
 * falls back to naming the kind rather than showing a raw enum.
 */
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
}
