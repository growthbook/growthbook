import { useMemo, useState } from "react";
import { FactMetricInterface } from "shared/types/fact-table";
import {
  DefinitionsContext,
  useDefinitions,
} from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PermissionBlocker from "@/ui/PermissionBlocker";
import Text from "@/ui/Text";
import {
  getMetricPreviewConfig,
  getMetricPreviewUnits,
} from "@/components/FactTables/MetricEditor/metricPreview";
import { usePreviewDateRange } from "@/components/QueryPreview/previewUtils";
import PreviewUnitSelect from "@/components/QueryPreview/PreviewUnitSelect";
import MetricPreviewChart from "./MainSection/MetricPreviewChart";
import PreviewExplorer, { DisabledPreview } from "./PreviewExplorer";

export default function MetricPerformance({
  metric,
  datasourceId,
  draft = false,
}: {
  metric: FactMetricInterface | null;
  datasourceId: string;
  draft?: boolean;
}) {
  const definitions = useDefinitions();
  const { getFactTableById, getDatasourceById } = definitions;
  const previewDefinitions = useMemo(
    () => ({
      ...definitions,
      getFactMetricById: (id: string) =>
        draft && metric && id === metric.id
          ? metric
          : definitions.getFactMetricById(id),
    }),
    [definitions, draft, metric],
  );
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const units = getMetricPreviewUnits(metric, getFactTableById);
  const unit =
    selectedUnit && units.includes(selectedUnit)
      ? selectedUnit
      : (units[0] ?? null);
  const unitFactTable = getFactTableById(
    metric?.metricType === "funnel"
      ? (metric.funnelSettings?.steps[0]?.factTableId ?? "")
      : (metric?.numerator.factTableId ?? ""),
  );
  const multiTable =
    metric?.metricType === "funnel" || metric?.metricType === "ratio";
  const dateRange = usePreviewDateRange();
  const config = useMemo(
    () =>
      metric
        ? getMetricPreviewConfig(metric, {
            draft,
            unit,
            dateRange,
          })
        : null,
    [metric, draft, unit, dateRange],
  );
  const permissions = usePermissionsUtil();
  const datasource = getDatasourceById(datasourceId);
  if (!datasource)
    return (
      <DisabledPreview description="Select a fact table to see live sample data for the last 7 days." />
    );
  if (!permissions.canRunMetricQueries(datasource))
    return (
      <DisabledPreview description="Live sample data for the last 7 days appears here.">
        <PermissionBlocker>
          You don’t have permission to load this metric’s performance.
        </PermissionBlocker>
      </DisabledPreview>
    );
  return (
    <DefinitionsContext.Provider value={previewDefinitions}>
      <PreviewExplorer
        config={config}
        trackingSource="metric-preview"
        emptyDescription="Run the query to see live sample data for the last 7 days."
        incompleteDescription="Complete the metric definition to see live sample data for the last 7 days."
        warehouseUnavailableText="Metric performance will be available when the warehouse is ready."
        renderChart={(state) => <MetricPreviewChart {...state} />}
        controls={
          units.length > 0 ? (
            <PreviewUnitSelect
              units={units}
              value={unit}
              setValue={setSelectedUnit}
              factTable={unitFactTable}
              size="sm"
              aria-label="Unit"
            />
          ) : multiTable ? (
            <Text size="sm" color="text-mid">
              {metric?.metricType === "ratio"
                ? "The numerator and denominator need a shared identifier to preview this ratio."
                : "The steps need a shared identifier to preview this funnel."}
            </Text>
          ) : undefined
        }
      />
    </DefinitionsContext.Provider>
  );
}
