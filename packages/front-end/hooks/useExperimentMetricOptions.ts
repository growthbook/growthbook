import { useMemo } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { expandMetricGroups } from "shared/experiments";
import { MultiSelectSearchOption } from "@/ui/MultiSelectSearch";

export function useExperimentMetricOptions(
  experiment: ExperimentInterfaceStringDates,
  metricGroups: MetricGroupInterface[],
  allMetricTags: string[],
  getExperimentMetricById: (id: string) => {
    tags?: string[];
  } | null,
): MultiSelectSearchOption[] {
  return useMemo(() => {
    const options: MultiSelectSearchOption[] = [];

    // Get all metric IDs from the experiment
    const allMetricIds = [
      ...experiment.goalMetrics,
      ...experiment.secondaryMetrics,
      ...experiment.guardrailMetrics,
    ];

    // Expand metric groups to get actual metric IDs
    const expandedMetricIds = expandMetricGroups(allMetricIds, metricGroups);

    // Collect all tags from experiment metrics
    const experimentTags = new Set<string>();
    expandedMetricIds.forEach((metricId) => {
      const metric = getExperimentMetricById(metricId);
      metric?.tags?.forEach((tag) => {
        if (allMetricTags.includes(tag)) {
          experimentTags.add(tag);
        }
      });
    });

    // Add tag options
    Array.from(experimentTags)
      .sort()
      .forEach((tag) => {
        options.push({
          value: `tag:${tag}`,
          label: tag,
          group: "Tags",
          color: "blue",
        });
      });

    // Find metric groups that contain at least one metric from the experiment
    const relevantGroups = metricGroups.filter((group) => {
      // Check if any metric in the group is in the experiment
      return group.metrics.some((metricId) =>
        expandedMetricIds.includes(metricId),
      );
    });

    // Add metric group options
    relevantGroups
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((group) => {
        options.push({
          value: `group:${group.id}`,
          label: group.name,
          group: "Metric Groups",
          color: "purple",
        });
      });

    return options;
  }, [
    experiment.goalMetrics,
    experiment.secondaryMetrics,
    experiment.guardrailMetrics,
    metricGroups,
    allMetricTags,
    getExperimentMetricById,
  ]);
}

