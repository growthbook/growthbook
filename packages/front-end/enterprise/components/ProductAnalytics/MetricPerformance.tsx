import { useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FactMetricInterface } from "shared/types/fact-table";
import { ExplorationConfig } from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import {
  DefinitionsContext,
  useDefinitions,
} from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";
import {
  getMetricPreviewConfig,
  getMetricPreviewDateRange,
  getMetricPreviewUnits,
  getMetricPreviewUnitLabel,
} from "@/components/FactTables/MetricEditor/metricPreview";
import styles from "@/components/FactTables/MetricEditor/PreviewPanel.module.scss";
import { ExplorerProvider } from "./ExplorerContext";
import MetricPreviewChart from "./MainSection/MetricPreviewChart";
import PreviewEmptyState from "./MainSection/PreviewEmptyState";
import PreviewShell, { PreviewFooter } from "./MainSection/PreviewShell";

const EMPTY_CONFIG: ExplorationConfig = {
  ...DEFAULT_EXPLORE_STATE,
  type: "metric",
  dataset: { type: "metric", values: [] },
};

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
  const [selectedDenominatorUnit, setSelectedDenominatorUnit] = useState<
    string | null
  >(null);
  const units = getMetricPreviewUnits(metric, getFactTableById);
  const unit =
    selectedUnit && units.numerator.includes(selectedUnit)
      ? selectedUnit
      : (units.numerator[0] ?? null);
  const denominatorUnit =
    selectedDenominatorUnit &&
    units.denominator.includes(selectedDenominatorUnit)
      ? selectedDenominatorUnit
      : (units.denominator[0] ?? null);
  const numeratorFactTable = getFactTableById(
    metric?.metricType === "funnel"
      ? (metric.funnelSettings?.steps[0]?.factTableId ?? "")
      : (metric?.numerator.factTableId ?? ""),
  );
  const denominatorFactTable = getFactTableById(
    metric?.denominator?.factTableId ?? "",
  );
  // Recompute when the UTC day rolls over so "last 7 days" doesn't go stale.
  const utcToday = new Date().toISOString().slice(0, 10);
  const dateRange = useMemo(
    () => getMetricPreviewDateRange(new Date(`${utcToday}T00:00:00Z`)),
    [utcToday],
  );
  const config = useMemo(
    () =>
      metric
        ? getMetricPreviewConfig(metric, {
            draft,
            unit,
            denominatorUnit,
            dateRange,
          })
        : null,
    [metric, draft, unit, denominatorUnit, dateRange],
  );
  const permissions = usePermissionsUtil();
  const datasource = getDatasourceById(datasourceId);
  if (!datasource)
    return (
      <>
        <PreviewEmptyState description="Select a fact table to see live sample data for the last 7 days." />
        <PreviewFooter
          layout="panel"
          exploration={null}
          outdated={false}
          loading={false}
          disabled
        />
      </>
    );
  if (!permissions.canRunMetricQueries(datasource))
    return (
      <Text color="text-mid">
        You don’t have permission to load this metric’s performance.
      </Text>
    );
  return (
    <DefinitionsContext.Provider value={previewDefinitions}>
      <ExplorerProvider
        initialConfig={config ?? EMPTY_CONFIG}
        queryEnabled={config !== null}
        trackingSource="metric-preview"
      >
        <PreviewShell
          config={config}
          layout="panel"
          emptyDescription="Run the query to see live sample data for the last 7 days."
          incompleteDescription="Complete the metric definition to see live sample data for the last 7 days."
          warehouseUnavailableText="Metric performance will be available when the warehouse is ready."
          renderChart={(state) => <MetricPreviewChart {...state} />}
          controls={
            <Flex
              direction="column"
              gap="3"
              width={
                metric?.metricType === "ratio" ||
                metric?.metricType === "funnel"
                  ? "100%"
                  : undefined
              }
              minWidth="0"
            >
              {metric?.metricType === "ratio" && (
                <Flex direction="column" gap="1">
                  <Text size="sm" weight="semibold" color="text-mid">
                    Numerator
                  </Text>
                  <Text size="sm" color="text-mid">
                    {numeratorFactTable?.name ||
                      metric.numerator.factTableId ||
                      "Select a fact table"}
                  </Text>
                </Flex>
              )}
              {units.numerator.length > 0 && (
                <Select
                  size={
                    metric?.metricType === "ratio" ||
                    metric?.metricType === "funnel"
                      ? "md"
                      : "sm"
                  }
                  triggerClassName={styles.unitTrigger}
                  aria-label={
                    metric?.metricType === "ratio"
                      ? "Numerator unit"
                      : metric?.metricType === "funnel"
                        ? "Shared unit for all steps"
                        : "Unit"
                  }
                  value={unit ?? ""}
                  setValue={setSelectedUnit}
                >
                  {units.numerator.map((id) => {
                    const { label, column } = getMetricPreviewUnitLabel(
                      id,
                      numeratorFactTable,
                    );
                    return (
                      <SelectItem
                        key={id}
                        value={id}
                        textValue={label}
                        className={styles.unitItem}
                      >
                        <span className={styles.unitOption}>
                          <span>{label}</span>
                          <span className={styles.unitDescriptor}>
                            {column}
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </Select>
              )}
              {metric?.metricType === "funnel" &&
                units.numerator.length === 0 && (
                  <Text size="sm" color="text-mid">
                    The steps need a shared identifier to preview this funnel.
                  </Text>
                )}
              {metric?.metricType === "ratio" && (
                <>
                  <div className={styles.ratioDivider} aria-hidden="true">
                    <span>÷</span>
                  </div>
                  <Flex direction="column" gap="1">
                    <Text size="sm" weight="semibold" color="text-mid">
                      Denominator
                    </Text>
                    <Text size="sm" color="text-mid">
                      {denominatorFactTable?.name ||
                        metric.denominator?.factTableId ||
                        "Select a fact table"}
                    </Text>
                  </Flex>
                </>
              )}
              {units.denominator.length > 0 && (
                <Select
                  size="md"
                  triggerClassName={styles.unitTrigger}
                  aria-label="Denominator unit"
                  value={denominatorUnit ?? ""}
                  setValue={setSelectedDenominatorUnit}
                >
                  {units.denominator.map((id) => {
                    const { label, column } = getMetricPreviewUnitLabel(
                      id,
                      denominatorFactTable,
                    );
                    return (
                      <SelectItem
                        key={id}
                        value={id}
                        textValue={label}
                        className={styles.unitItem}
                      >
                        <span className={styles.unitOption}>
                          <span>{label}</span>
                          <span className={styles.unitDescriptor}>
                            {column}
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </Select>
              )}
            </Flex>
          }
        />
      </ExplorerProvider>
    </DefinitionsContext.Provider>
  );
}
