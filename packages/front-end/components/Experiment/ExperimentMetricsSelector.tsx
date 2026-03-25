import { useState, useMemo } from "react";
import { FaPlusCircle } from "react-icons/fa";
import { Text } from "@radix-ui/themes";
import {
  expandMetricGroups,
  quantileMetricType,
  isFactMetric,
  getUserIdTypes,
} from "shared/experiments";
import { FactTableMap } from "shared/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import { getExposureQuery } from "@/services/datasources";
import Callout from "@/ui/Callout";
import MetricsSelector from "./MetricsSelector";

export interface Props {
  datasource?: string;
  exposureQueryId?: string;
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
  noLegacyMetrics?: boolean;
  disabled?: boolean;
  goalDisabled?: boolean;
  collapseSecondary?: boolean;
  collapseGuardrail?: boolean;
  goalMetricsDescription?: string;
  filterConversionWindowMetrics?: boolean;
  excludeQuantiles?: boolean;
  experimentId?: string;
}

export default function ExperimentMetricsSelector({
  datasource,
  exposureQueryId,
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
  noLegacyMetrics = false,
  disabled,
  goalDisabled,
  collapseSecondary,
  collapseGuardrail,
  goalMetricsDescription,
  filterConversionWindowMetrics,
  excludeQuantiles = false,
  experimentId,
}: Props) {
  const {
    getExperimentMetricById,
    getDatasourceById,
    metricGroups,
    factTables,
  } = useDefinitions();

  const getMetricDisabledInfo = useMemo(
    () => (metricId: string, isGroup: boolean) => {
      const datasourceObj = datasource ? getDatasourceById(datasource) : null;
      const isExperimentIncludedInIncrementalRefresh =
        getIsExperimentIncludedInIncrementalRefresh(
          datasourceObj ?? undefined,
          experimentId,
        );

      if (!isExperimentIncludedInIncrementalRefresh) {
        return { disabled: false };
      }

      if (isGroup) {
        // Check if metric group contains cross fact-table ratio metrics
        const metricGroup = metricGroups.find((mg) => mg.id === metricId);
        if (!metricGroup) {
          return { disabled: false };
        }
        const expandedIds = expandMetricGroups(
          metricGroup.metrics,
          metricGroups,
        );
        const hasInvalidMetrics = expandedIds.some((id) => {
          const metric = getExperimentMetricById(id);
          return (
            metric &&
            "numerator" in metric &&
            !!metric.denominator &&
            metric.numerator.factTableId !== metric.denominator.factTableId
          );
        });

        if (hasInvalidMetrics) {
          return {
            disabled: true,
            reason:
              "We currently don't support cross fact-table metrics with Incremental Refresh",
          };
        }

        // Check if metric group contains quantile metrics
        const hasQuantileMetrics = expandedIds.some((id) => {
          const metric = getExperimentMetricById(id);
          return metric && quantileMetricType(metric);
        });

        if (hasQuantileMetrics) {
          return {
            disabled: true,
            reason: "Not supported with Incremental Refresh while in beta",
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
        // Check if individual metric is a cross fact-table ratio metric
        const metric = getExperimentMetricById(metricId);
        if (
          metric &&
          "numerator" in metric &&
          !!metric.denominator &&
          metric.numerator.factTableId !== metric.denominator.factTableId
        ) {
          return {
            disabled: true,
            reason:
              "We currently don't support cross fact-table metrics with Incremental Refresh",
          };
        }

        // Check if metric is a quantile metric
        if (metric && quantileMetricType(metric)) {
          return {
            disabled: true,
            reason: "Not supported with Incremental Refresh while in beta",
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
      datasource,
      experimentId,
      getExperimentMetricById,
      getDatasourceById,
      metricGroups,
    ],
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
    const randomizationUnitUserIdType = exposureQuery?.userIdType;

    if (!randomizationUnitUserIdType) {
      return false;
    }

    const goalMetricId = goalMetrics[0];
    const goalMetric = getExperimentMetricById(goalMetricId);
    if (!goalMetric) {
      return false;
    }

    // Build factTableMap for getUserIdTypes
    const factTableMap: FactTableMap = new Map();
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
    getDatasourceById,
    getExperimentMetricById,
    factTables,
  ]);

  return (
    <>
      {setGoalMetrics !== undefined && (
        <div className="form-group flex-1">
          <label className="font-weight-bold mb-1">
            {!forceSingleGoalMetric ? "Goal Metrics" : "Decision Metric"}
          </label>
          <Text
            as="p"
            size="2"
            style={{ color: "var(--color-text-mid)" }}
            className="mb-1"
          >
            {goalMetricsDescription
              ? goalMetricsDescription
              : !forceSingleGoalMetric
                ? "The primary metrics you are trying to improve with this experiment. "
                : "Choose the goal metric that will be used to update variation weights. "}
          </Text>
          <MetricsSelector
            selected={goalMetrics}
            onChange={setGoalMetrics}
            datasource={datasource}
            exposureQueryId={exposureQueryId}
            project={project}
            autoFocus={autoFocus}
            includeFacts={true}
            forceSingleMetric={forceSingleGoalMetric}
            includeGroups={!forceSingleGoalMetric}
            excludeQuantiles={noQuantileGoalMetrics || excludeQuantiles}
            filterConversionWindowMetrics={filterConversionWindowMetrics}
            noLegacyMetrics={noLegacyMetrics}
            disabled={disabled || goalDisabled}
            getMetricDisabledInfo={getMetricDisabledInfo}
          />
          {hasIdentifierTypeMismatch && (
            <Callout status="warning" my="4">
              Mismatch between the randomization unit and the Decision Metric
              identifier type can lead to double counting if the randomization
              unit has multiple exposures.
            </Callout>
          )}
        </div>
      )}

      {setSecondaryMetrics !== undefined && (
        <div className="form-group flex-1">
          {secondaryCollapsed ? (
            <a
              role="button"
              className="d-inline-block link-purple font-weight-bold mt-2"
              onClick={() => setSecondaryCollapsed(false)}
            >
              <FaPlusCircle className="mr-1" />
              Add Secondary Metrics
            </a>
          ) : (
            <>
              <label className="font-weight-bold mb-1">Secondary Metrics</label>
              <Text
                as="p"
                size="2"
                style={{ color: "var(--color-text-mid)" }}
                className="mb-1"
              >
                {!forceSingleGoalMetric
                  ? "Additional metrics to learn about experiment impacts, but not primary objectives."
                  : "Additional metrics to learn about experiment impacts. "}
              </Text>
              <MetricsSelector
                selected={secondaryMetrics}
                onChange={setSecondaryMetrics}
                datasource={datasource}
                exposureQueryId={exposureQueryId}
                project={project}
                includeFacts={true}
                filterConversionWindowMetrics={filterConversionWindowMetrics}
                excludeQuantiles={excludeQuantiles}
                noLegacyMetrics={noLegacyMetrics}
                disabled={disabled}
                getMetricDisabledInfo={getMetricDisabledInfo}
              />
            </>
          )}
        </div>
      )}

      {setGuardrailMetrics !== undefined && (
        <div className="form-group flex-1">
          {guardrailCollapsed ? (
            <a
              role="button"
              className="d-inline-block link-purple font-weight-bold mt-2"
              onClick={() => setGuardrailCollapsed(false)}
            >
              <FaPlusCircle className="mr-1" />
              Add Guardrail Metrics
            </a>
          ) : (
            <>
              <label className="font-weight-bold mb-1">Guardrail Metrics</label>
              <Text
                as="p"
                size="2"
                style={{ color: "var(--color-text-mid)" }}
                className="mb-1"
              >
                Metrics you want to monitor, but are NOT specifically trying to
                improve.
              </Text>
              <MetricsSelector
                selected={guardrailMetrics}
                onChange={setGuardrailMetrics}
                datasource={datasource}
                exposureQueryId={exposureQueryId}
                project={project}
                includeFacts={true}
                filterConversionWindowMetrics={filterConversionWindowMetrics}
                excludeQuantiles={excludeQuantiles}
                noLegacyMetrics={noLegacyMetrics}
                disabled={disabled}
                getMetricDisabledInfo={getMetricDisabledInfo}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
