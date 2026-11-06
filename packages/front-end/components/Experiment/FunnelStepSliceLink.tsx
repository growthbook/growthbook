import {
  ExperimentMetricDefinition,
  getSliceDataForMetric,
  isFactFunnelMetric,
} from "shared/experiments";
import { CustomMetricSlice } from "shared/types/experiment";
import { FactTableDefinition } from "shared/types/fact-table";
import Link from "@/ui/Link";
import { ExperimentTableRow } from "@/services/experiments";
import {
  DrilldownDimensionInfo,
  useMetricDrilldownContext,
} from "@/components/MetricDrilldown/useMetricDrilldownContext";

/**
 * A funnel's slices are per step and only shown in the metric drilldown, so a
 * step row links into that tab instead of expanding slice rows in place.
 * Renders nothing outside a drilldown provider (public results, exports).
 */
export default function FunnelStepSliceLink({
  row,
  dimensionInfo,
}: {
  row: ExperimentTableRow;
  dimensionInfo?: DrilldownDimensionInfo;
}) {
  const drilldownContext = useMetricDrilldownContext();
  if (!drilldownContext) return null;

  return (
    <Link
      size="sm"
      style={{ marginRight: 8, flexShrink: 0, whiteSpace: "nowrap" }}
      onClick={(e) => {
        e.stopPropagation();
        drilldownContext.openDrilldown(row, {
          initialTab: "slices",
          dimensionInfo,
        });
      }}
    >
      View by slice
    </Link>
  );
}

/**
 * Whether a funnel has slices worth linking to. Built from the same call the
 * drilldown's Slices tab uses, so the link never opens an empty tab.
 */
export function funnelMetricHasSlices({
  metric,
  customMetricSlices,
  getFactTableById,
}: {
  metric: ExperimentMetricDefinition;
  customMetricSlices?: CustomMetricSlice[];
  getFactTableById: (id: string) => FactTableDefinition | null;
}): boolean {
  if (!isFactFunnelMetric(metric)) return false;

  return (
    getSliceDataForMetric({
      metric,
      metricName: metric.name,
      customMetricSlices,
      getFactTable: getFactTableById,
    }).length > 0
  );
}
