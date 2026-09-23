import { useEffect, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FactMetricInterface } from "shared/types/fact-table";
import { ExplorationConfig } from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { ago, datetime } from "shared/dates";
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
} from "@/components/FactTables/MetricEditor/metricPreview";
import { ExplorerProvider, useExplorerContext } from "./ExplorerContext";
import ExplorerChart from "./MainSection/ExplorerChart";

const EMPTY_CONFIG: ExplorationConfig = {
  ...DEFAULT_EXPLORE_STATE,
  type: "metric",
  dataset: { type: "metric", values: [] },
};

function PerformanceChart({ config }: { config: ExplorationConfig | null }) {
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
  const lastQueried =
    exploration?.status === "success"
      ? (exploration.runStarted ?? exploration.dateCreated)
      : null;
  const outdated = !!exploration && (!config || isStale || needsFetch);
  if (managedWarehouseUnavailable)
    return (
      <Text color="text-mid">
        Metric performance will be available when the warehouse is ready.
      </Text>
    );
  return (
    <Flex direction="column" gap="3" minHeight="0">
      <Text size="sm" color="text-mid">
        Last 7 complete days (UTC)
      </Text>
      {outdated && (
        <Callout status="warning" size="sm">
          Your latest changes are not applied to this graph.{" "}
          {config
            ? "Run query to update it."
            : "Complete the metric definition and filters, then run the query."}
        </Callout>
      )}
      {lastQueried && (
        <Text size="sm" color="text-low">
          <span title={datetime(lastQueried)}>Updated {ago(lastQueried)}</span>
        </Text>
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
        <Text color="text-mid">
          {config
            ? "Run the query to preview this metric."
            : "Complete the metric definition and all filters to preview it."}
        </Text>
      )}
      {error && !exploration && <Callout status="error">{error}</Callout>}
      <Button
        disabled={!config || loading || !isSubmittable}
        onClick={() => handleSubmit()}
      >
        Run query
      </Button>
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
      <Flex direction="column" gap="3">
        {units.numerator.length > 1 && (
          <Select
            label={
              metric?.metricType === "ratio"
                ? "Numerator identifier"
                : "Identifier"
            }
            value={unit ?? ""}
            setValue={setSelectedUnit}
          >
            {units.numerator.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </Select>
        )}
        {units.denominator.length > 1 && (
          <Select
            label="Denominator identifier"
            value={denominatorUnit ?? ""}
            setValue={setSelectedDenominatorUnit}
          >
            {units.denominator.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </Select>
        )}
        <ExplorerProvider
          initialConfig={config ?? EMPTY_CONFIG}
          queryEnabled={config !== null}
          trackingSource="metric-preview"
        >
          <PerformanceChart config={config} />
        </ExplorerProvider>
      </Flex>
    </DefinitionsContext.Provider>
  );
}
