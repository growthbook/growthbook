import { ReactNode, useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FactMetricInterface } from "shared/types/fact-table";
import { ExplorationConfig } from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import {
  DefinitionsContext,
  useDefinitions,
} from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { Select, SelectItem } from "@/ui/Select";
import {
  getMetricPreviewConfig,
  getMetricPreviewDateRange,
  getMetricPreviewUnits,
  getMetricPreviewUnitLabel,
} from "@/components/FactTables/MetricEditor/metricPreview";
import styles from "@/components/FactTables/MetricEditor/PreviewPanel.module.scss";
import { ExplorerProvider, useExplorerContext } from "./ExplorerContext";
import ExplorerChart from "./MainSection/ExplorerChart";

const EMPTY_CONFIG: ExplorationConfig = {
  ...DEFAULT_EXPLORE_STATE,
  type: "metric",
  dataset: { type: "metric", values: [] },
};

function PerformanceChart({
  config,
  controls,
}: {
  config: ExplorationConfig | null;
  controls: ReactNode;
}) {
  const {
    exploration,
    submittedExploreState,
    draftExploreState,
    loading,
    error,
    isSubmittable,
    managedWarehouseUnavailable,
    handleSubmit,
    setDraftExploreState,
    isStale,
    needsFetch,
  } = useExplorerContext();
  useEffect(() => {
    if (config) setDraftExploreState(config);
  }, [config, setDraftExploreState]);
  const outdated = !!exploration && (!config || isStale || needsFetch);
  if (managedWarehouseUnavailable)
    return (
      <Text color="text-mid">
        Metric performance will be available when the warehouse is ready.
      </Text>
    );
  return (
    <Flex direction="column" gap="3" minHeight="0">
      {outdated && (
        <Callout status="warning" size="sm">
          {config
            ? "Changes not applied. Run the query to refresh."
            : "Complete the metric definition and filters, then run the query."}
        </Callout>
      )}
      <Flex align="center" justify="between" gap="2" wrap="wrap">
        {controls}
        <Text size="sm" color="text-mid" title="Last 7 complete days (UTC)">
          Last 7 days (UTC)
        </Text>
      </Flex>
      {exploration || loading ? (
        <ExplorerChart
          compact
          exploration={exploration}
          submittedExploreState={submittedExploreState ?? draftExploreState}
          loading={loading}
          error={error}
        />
      ) : (
        <Text color="text-mid">
          {config
            ? "Run the query to preview this metric."
            : "Complete the metric definition and all filters to preview it."}
        </Text>
      )}
      {error && !exploration && <Callout status="error">{error}</Callout>}
      <Box className={styles.footer}>
        <Button
          style={{ width: "100%" }}
          disabled={!config || loading || !isSubmittable}
          onClick={() => handleSubmit()}
        >
          Run query
        </Button>
      </Box>
    </Flex>
  );
}

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
  const dateRange = useMemo(() => getMetricPreviewDateRange(), []);
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
      <Text color="text-mid">Select a fact table to preview this metric.</Text>
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
        <PerformanceChart
          config={config}
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
              {metric?.metricType === "funnel" && (
                <ol className={styles.funnelSteps} aria-label="Funnel steps">
                  {metric.funnelSettings?.steps.map((step, index) => {
                    const table = getFactTableById(step.factTableId);
                    const column = unit
                      ? getMetricPreviewUnitLabel(unit, table).column
                      : null;
                    return (
                      <li key={index}>
                        <span className={styles.stepNumber} aria-hidden="true">
                          {index + 1}
                        </span>
                        <Flex direction="column" gap="1" minWidth="0">
                          <Text weight="semibold">
                            {step.name || `Step ${index + 1}`}
                            {step.optional ? " (optional)" : ""}
                          </Text>
                          <Text size="sm" color="text-mid">
                            {table?.name ||
                              step.factTableId ||
                              "Select a Fact Table"}
                          </Text>
                          {column && (
                            <Text size="sm" color="text-low">
                              {column}
                            </Text>
                          )}
                        </Flex>
                      </li>
                    );
                  })}
                </ol>
              )}
              {metric?.metricType === "ratio" && (
                <Flex direction="column" gap="1">
                  <Text size="sm" weight="semibold" color="text-mid">
                    Numerator
                  </Text>
                  <Text size="sm" color="text-mid">
                    {numeratorFactTable?.name ||
                      metric.numerator.factTableId ||
                      "Select a Fact Table"}
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
                          <span>
                            <Text color="text-mid">
                              {metric?.metricType === "funnel"
                                ? "Shared unit "
                                : "Unit "}
                            </Text>
                            {label}
                          </span>
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
                        "Select a Fact Table"}
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
                          <span>
                            <Text color="text-mid">Unit </Text>
                            {label}
                          </span>
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
