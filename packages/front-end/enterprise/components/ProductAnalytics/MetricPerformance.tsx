import { ReactNode, useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiChartBar } from "react-icons/pi";
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

// Relative heights of the placeholder bars, as a percent of the tallest.
const PLACEHOLDER_BARS = [62, 68, 54, 75, 83, 46, 100];

function PreviewEmptyState({ description }: { description: string }) {
  return (
    <Flex direction="column" align="center" gap="3" pb="2">
      <div className={styles.placeholderBars} aria-hidden="true">
        {PLACEHOLDER_BARS.map((height, i) => (
          <span key={i} style={{ height: `${height}%` }} />
        ))}
      </div>
      <span className={styles.emptyIcon} aria-hidden="true">
        <PiChartBar size={20} />
      </span>
      <Text size="lg" weight="semibold" align="center">
        Preview will appear here
      </Text>
      <Text color="text-mid" align="center">
        {description}
      </Text>
    </Flex>
  );
}

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
      {(config || exploration) && (
        <Flex align="center" justify="between" gap="2" wrap="wrap">
          {controls}
          <Text size="sm" color="text-mid" title="Last 7 complete days (UTC)">
            Last 7 days (UTC)
          </Text>
        </Flex>
      )}
      {exploration || loading ? (
        <ExplorerChart
          compact
          exploration={exploration}
          submittedExploreState={submittedExploreState ?? draftExploreState}
          loading={loading}
          error={error}
        />
      ) : (
        <PreviewEmptyState
          description={
            config
              ? "Run the query to see live sample data for the last 7 days."
              : "Configure a filter to see live sample data for the last 7 days."
          }
        />
      )}
      {/* ExplorerChart renders nothing for an error, so show it here. */}
      {error && !loading && <Callout status="error">{error}</Callout>}
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
        <Box className={styles.footer}>
          <Button style={{ width: "100%" }} disabled>
            Run query
          </Button>
        </Box>
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
