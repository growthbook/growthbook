import { ReactNode, useState, useMemo } from "react";
import { resolveAnalysisIdentifierType } from "shared/util";
import { FaPlusCircle } from "react-icons/fa";
import { Text } from "@radix-ui/themes";
import {
  expandMetricGroups,
  quantileMetricType,
  isFactMetric,
  isFactFunnelMetric,
  getUserIdTypes,
} from "shared/experiments";
import {
  FactMetricType,
  FactTableDefinitionMap,
} from "shared/types/fact-table";
import { ExperimentType } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import { getExposureQuery } from "@/services/datasources";
import Callout from "@/ui/Callout";
import MetricsSelector from "./MetricsSelector";
import SetupFieldRow from "./TabbedPage/SetupFieldRow";

export interface Props {
  datasource?: string;
  exposureQueryId?: string;
  exposureQueryIdentifierType?: string;
  project?: string;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  setGoalMetrics?: (goalMetrics: string[]) => void;
  setSecondaryMetrics?: (secondaryMetrics: string[]) => void;
  setGuardrailMetrics?: (guardrailMetrics: string[]) => void;
  autoFocus?: boolean;
  forceSingleGoalMetric?: boolean;
  noQuantileGoalMetrics?: boolean;
  goalMetricAllowedFactMetricTypes?: FactMetricType[];
  noLegacyMetrics?: boolean;
  disabled?: boolean;
  goalDisabled?: boolean;
  collapseSecondary?: boolean;
  collapseGuardrail?: boolean;
  goalMetricsDescription?: string;
  filterConversionWindowMetrics?: boolean;
  excludeQuantiles?: boolean;
  experimentId?: string;
  requireDatasource?: boolean;
  experimentType: ExperimentType | undefined;
  // Each selector beside its label, as on the experiment's setup page.
  asRows?: boolean;
}

/** Which metrics an experiment can't use, and why. */
/** Each metric list as a setup row reads it. */
export const METRIC_ROWS = {
  goalMetrics: {
    label: "Goal metrics",
    tooltip: "What this experiment is trying to improve.",
  },
  secondaryMetrics: {
    label: "Secondary metrics",
    tooltip: "Extra metrics to learn from, but not the objective.",
  },
  guardrailMetrics: {
    label: "Guardrail metrics",
    tooltip: "Metrics to watch for harm, not to improve.",
  },
};

export function useMetricDisabledInfo(
  datasource: string | undefined,
  experimentId: string | undefined,
  experimentType: ExperimentType | undefined,
) {
  const { getExperimentMetricById, getDatasourceById, metricGroups } =
    useDefinitions();
  const datasourceObj = datasource ? getDatasourceById(datasource) : null;
  const incrementalRefresh = getIsExperimentIncludedInIncrementalRefresh(
    datasourceObj ?? undefined,
    experimentId,
    experimentType,
  );
  const getMetricDisabledInfo = useMemo(
    () => (metricId: string, isGroup: boolean) => {
      // Query generation rejects funnel metrics for bandits.
      if (experimentType === "multi-armed-bandit") {
        const ids = isGroup
          ? expandMetricGroups(
              metricGroups.find((mg) => mg.id === metricId)?.metrics ?? [],
              metricGroups,
            )
          : [metricId];
        const hasFunnelMetric = ids.some((id) => {
          const metric = getExperimentMetricById(id);
          return metric && isFactFunnelMetric(metric);
        });
        if (hasFunnelMetric) {
          return {
            disabled: true,
            reason: "Funnel metrics are not supported in Bandit experiments",
          };
        }
      }

      if (!incrementalRefresh) {
        return { disabled: false };
      }

      if (isGroup) {
        const metricGroup = metricGroups.find((mg) => mg.id === metricId);
        if (!metricGroup) {
          return { disabled: false };
        }
        const expandedIds = expandMetricGroups(
          metricGroup.metrics,
          metricGroups,
        );

        // Event quantile metrics require KLL support for incremental refresh.
        const hasUnsupportedEventQuantileMetrics = expandedIds.some((id) => {
          const metric = getExperimentMetricById(id);
          return (
            metric &&
            quantileMetricType(metric) === "event" &&
            !datasourceObj?.properties?.hasQuantileSketch
          );
        });

        if (hasUnsupportedEventQuantileMetrics) {
          return {
            disabled: true,
            reason:
              "Event quantile metrics with Incremental Refresh require a data source that supports KLL quantile sketches.",
          };
        }

        // Check if metric group contains legacy metrics
        const hasLegacyMetrics = expandedIds.some((id) => {
          const metric = getExperimentMetricById(id);
          return metric && !isFactMetric(metric);
        });

        if (hasLegacyMetrics) {
          return {
            disabled: true,
            reason: "Only fact metrics are supported with Incremental Refresh",
          };
        }
      } else {
        const metric = getExperimentMetricById(metricId);

        // Event quantile metrics require KLL support for incremental refresh.
        if (
          metric &&
          quantileMetricType(metric) === "event" &&
          !datasourceObj?.properties?.hasQuantileSketch
        ) {
          return {
            disabled: true,
            reason:
              "Event quantile metrics with Incremental Refresh require a data source that supports KLL quantile sketches.",
          };
        }

        // Check if metric is a legacy metric (non-fact metric)
        if (metric && !isFactMetric(metric)) {
          return {
            disabled: true,
            reason: "Only fact metrics are supported with Incremental Refresh",
          };
        }
      }

      return { disabled: false };
    },
    [
      datasourceObj,
      incrementalRefresh,
      experimentType,
      getExperimentMetricById,
      metricGroups,
    ],
  );
  return getMetricDisabledInfo;
}

export default function ExperimentMetricsSelector({
  datasource,
  exposureQueryId,
  exposureQueryIdentifierType,
  project,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  setGoalMetrics,
  setSecondaryMetrics,
  setGuardrailMetrics,
  autoFocus = false,
  forceSingleGoalMetric = false,
  noQuantileGoalMetrics = false,
  goalMetricAllowedFactMetricTypes,
  noLegacyMetrics = false,
  disabled,
  goalDisabled,
  collapseSecondary,
  collapseGuardrail,
  goalMetricsDescription,
  filterConversionWindowMetrics,
  excludeQuantiles = false,
  experimentId,
  requireDatasource = false,
  experimentType,
  asRows = false,
}: Props) {
  const { getExperimentMetricById, getDatasourceById, factTables } =
    useDefinitions();

  const getMetricDisabledInfo = useMetricDisabledInfo(
    datasource,
    experimentId,
    experimentType,
  );

  const [secondaryCollapsed, setSecondaryCollapsed] = useState<boolean>(
    !!collapseSecondary && secondaryMetrics.length === 0,
  );
  const [guardrailCollapsed, setGuardrailCollapsed] = useState<boolean>(
    !!collapseGuardrail && guardrailMetrics.length === 0,
  );

  // Check for mismatch between randomization unit and goal metric identifier type for bandits
  const hasIdentifierTypeMismatch = useMemo(() => {
    if (
      !forceSingleGoalMetric ||
      !goalMetrics.length ||
      !datasource ||
      !exposureQueryId
    ) {
      return false;
    }

    const datasourceObj = getDatasourceById(datasource);
    const exposureQuery = getExposureQuery(
      datasourceObj?.settings,
      exposureQueryId,
    );
    const randomizationUnitUserIdType = exposureQuery
      ? resolveAnalysisIdentifierType(
          exposureQuery,
          exposureQueryIdentifierType,
        )
      : undefined;

    if (!randomizationUnitUserIdType) {
      return false;
    }

    const goalMetricId = goalMetrics[0];
    const goalMetric = getExperimentMetricById(goalMetricId);
    if (!goalMetric) {
      return false;
    }

    // Build factTableMap for getUserIdTypes
    const factTableMap: FactTableDefinitionMap = new Map();
    factTables.forEach((ft) => {
      factTableMap.set(ft.id, ft);
    });

    const metricUserIdTypes = getUserIdTypes(goalMetric, factTableMap);
    return !metricUserIdTypes.includes(randomizationUnitUserIdType);
  }, [
    forceSingleGoalMetric,
    goalMetrics,
    datasource,
    exposureQueryId,
    exposureQueryIdentifierType,
    getDatasourceById,
    getExperimentMetricById,
    factTables,
  ]);

  const section = (label: string, description: string, field: ReactNode) =>
    asRows ? (
      <SetupFieldRow label={label} tooltip={description}>
        {field}
      </SetupFieldRow>
    ) : (
      <div className="form-group flex-1">
        <label className="font-weight-bold mb-1">{label}</label>
        <Text
          as="p"
          size="2"
          style={{ color: "var(--color-text-mid)" }}
          className="mb-1"
        >
          {description}
        </Text>
        {field}
      </div>
    );

  return (
    <>
      {setGoalMetrics !== undefined &&
        section(
          asRows
            ? !forceSingleGoalMetric
              ? METRIC_ROWS.goalMetrics.label
              : "Decision metric"
            : !forceSingleGoalMetric
              ? "Goal Metrics"
              : "Decision Metric",
          goalMetricsDescription
            ? goalMetricsDescription
            : !forceSingleGoalMetric
              ? asRows
                ? METRIC_ROWS.goalMetrics.tooltip
                : "The primary metrics you are trying to improve with this experiment. "
              : "Choose the goal metric that will be used to update variation weights. ",
          <>
            <MetricsSelector
              selected={goalMetrics}
              onChange={setGoalMetrics}
              datasource={datasource}
              exposureQueryId={exposureQueryId}
              exposureQueryIdentifierType={exposureQueryIdentifierType}
              project={project}
              autoFocus={autoFocus}
              includeFacts={true}
              forceSingleMetric={forceSingleGoalMetric}
              includeGroups={!forceSingleGoalMetric}
              excludeQuantiles={noQuantileGoalMetrics || excludeQuantiles}
              allowedFactMetricTypes={goalMetricAllowedFactMetricTypes}
              filterConversionWindowMetrics={filterConversionWindowMetrics}
              noLegacyMetrics={noLegacyMetrics}
              disabled={disabled || goalDisabled}
              requireDatasource={requireDatasource}
              getMetricDisabledInfo={getMetricDisabledInfo}
            />
            {hasIdentifierTypeMismatch && (
              <Callout status="warning" my="4">
                Mismatch between the randomization unit and the Decision Metric
                identifier type can lead to double counting if the randomization
                unit has multiple exposures.
              </Callout>
            )}
          </>,
        )}

      {setSecondaryMetrics !== undefined &&
        (secondaryCollapsed ? (
          <div className="form-group flex-1">
            <a
              role="button"
              className="d-inline-block link-purple font-weight-bold mt-2"
              onClick={() => setSecondaryCollapsed(false)}
            >
              <FaPlusCircle className="mr-1" />
              Add Secondary Metrics
            </a>
          </div>
        ) : (
          section(
            asRows ? METRIC_ROWS.secondaryMetrics.label : "Secondary Metrics",
            asRows
              ? METRIC_ROWS.secondaryMetrics.tooltip
              : !forceSingleGoalMetric
                ? "Additional metrics to learn about experiment impacts, but not primary objectives."
                : "Additional metrics to learn about experiment impacts. ",
            <MetricsSelector
              selected={secondaryMetrics}
              onChange={setSecondaryMetrics}
              datasource={datasource}
              exposureQueryId={exposureQueryId}
              exposureQueryIdentifierType={exposureQueryIdentifierType}
              project={project}
              includeFacts={true}
              filterConversionWindowMetrics={filterConversionWindowMetrics}
              excludeQuantiles={excludeQuantiles}
              noLegacyMetrics={noLegacyMetrics}
              disabled={disabled}
              getMetricDisabledInfo={getMetricDisabledInfo}
            />,
          )
        ))}

      {setGuardrailMetrics !== undefined &&
        (guardrailCollapsed ? (
          <div className="form-group flex-1">
            <a
              role="button"
              className="d-inline-block link-purple font-weight-bold mt-2"
              onClick={() => setGuardrailCollapsed(false)}
            >
              <FaPlusCircle className="mr-1" />
              Add Guardrail Metrics
            </a>
          </div>
        ) : (
          section(
            asRows ? METRIC_ROWS.guardrailMetrics.label : "Guardrail Metrics",
            asRows
              ? METRIC_ROWS.guardrailMetrics.tooltip
              : "Metrics you want to monitor, but are NOT specifically trying to improve.",
            <MetricsSelector
              selected={guardrailMetrics}
              onChange={setGuardrailMetrics}
              datasource={datasource}
              exposureQueryId={exposureQueryId}
              exposureQueryIdentifierType={exposureQueryIdentifierType}
              project={project}
              includeFacts={true}
              filterConversionWindowMetrics={filterConversionWindowMetrics}
              excludeQuantiles={excludeQuantiles}
              noLegacyMetrics={noLegacyMetrics}
              disabled={disabled}
              getMetricDisabledInfo={getMetricDisabledInfo}
            />,
          )
        ))}
    </>
  );
}
