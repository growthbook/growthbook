import { ExperimentMetricInterface } from "shared/experiments";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { expandMetricGroups } from "shared/experiments";

export interface ExperimentMetricFilters {
  tags: string[]; // Tag names to filter by
  metricGroups: string[]; // Metric group IDs to filter by
}

/**
 * Filter metrics by tags and/or metric groups using AND logic when both are present.
 * If only tags are selected, filters by tags (OR within tags).
 * If only groups are selected, filters by group membership (OR within groups).
 * If both are selected, uses AND logic (metric must match tag AND be in a selected group).
 */
export function filterMetricsByTagsAndGroups(
  metrics: ExperimentMetricInterface[],
  filters: ExperimentMetricFilters,
  metricGroups: MetricGroupInterface[],
): string[] {
  const { tags, metricGroups: selectedGroupIds } = filters;

  // If no filters, return all metric IDs
  if (tags.length === 0 && selectedGroupIds.length === 0) {
    return metrics.map((m) => m.id);
  }

  // Build a map of group ID to metric IDs
  const groupToMetricsMap = new Map<string, Set<string>>();
  metricGroups.forEach((group) => {
    const expandedMetrics = expandMetricGroups(group.metrics, metricGroups);
    groupToMetricsMap.set(group.id, new Set(expandedMetrics));
  });

  // Get all metrics that are in any selected group
  const metricsInSelectedGroups = new Set<string>();
  selectedGroupIds.forEach((groupId) => {
    const groupMetrics = groupToMetricsMap.get(groupId);
    if (groupMetrics) {
      groupMetrics.forEach((metricId) => {
        metricsInSelectedGroups.add(metricId);
      });
    }
  });

  // Filter metrics
  const filteredMetricIds: string[] = [];

  metrics.forEach((metric) => {
    if (!metric) return;

    const hasMatchingTag =
      tags.length === 0 ||
      (metric.tags && metric.tags.some((tag) => tags.includes(tag)));

    const isInSelectedGroup =
      selectedGroupIds.length === 0 ||
      metricsInSelectedGroups.has(metric.id);

    // Apply AND logic: if both filters are present, metric must match both
    // If only one filter is present, metric must match that one
    if (tags.length > 0 && selectedGroupIds.length > 0) {
      // Both filters: AND logic
      if (hasMatchingTag && isInSelectedGroup) {
        filteredMetricIds.push(metric.id);
      }
    } else if (tags.length > 0) {
      // Only tags filter: OR logic within tags
      if (hasMatchingTag) {
        filteredMetricIds.push(metric.id);
      }
    } else if (selectedGroupIds.length > 0) {
      // Only groups filter: OR logic within groups
      if (isInSelectedGroup) {
        filteredMetricIds.push(metric.id);
      }
    }
  });

  return filteredMetricIds;
}

