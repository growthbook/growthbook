import { useState, useMemo } from "react";
import { resolveAnalysisIdentifierType } from "shared/util";
import { FaPlusCircle } from "react-icons/fa";
import { Text } from "@radix-ui/themes";
import {
  expandMetricGroups,
  quantileMetricType,
  isFactMetric,
  isFactFunnelMetric,
  getUserIdTypes,
  getClusterExperimentMetricEligibility,
  getClusterSubUnit,
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
  isClusterExperiment?: boolean;
  clusterSubUnitIdentifier?: string;
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
  isClusterExperiment = false,
  clusterSubUnitIdentifier,
}: Props) {
  const {
    getExperimentMetricById,
    getDatasourceById,
    getFactTableById,
    metricGroups,
    factTables,
  } = useDefinitions();

  const getMetricDisabledInfo = useMemo(() => {
    const datasourceObj = datasource ? getDatasourceById(datasource) : null;
    const isExperimentIncludedInIncrementalRefresh =
      getIsExperimentIncludedInIncrementalRefresh(
        datasourceObj ?? undefined,
        experimentId,
        experimentType,
      );
    // Same rule as the back-end and MetricsSelector: cluster checks need a
    // sub-unit and the selected assignment query.
    const clusterSubUnit = getClusterSubUnit({
      isClusterExperiment,
      clusterSubUnitIdentifier,
    });
    const exposureQuery = datasourceObj?.settings?.queries?.exposure?.find(
      (e) => e.id === exposureQueryId,
    );
    const clusterIdentifier =
      clusterSubUnit && exposureQuery
        ? resolveAnalysisIdentifierType(
            exposureQuery,
            exposureQueryIdentifierType,
          )
        : null;

    return (metricId: string, isGroup: boolean) => {
      const metricGroup = isGroup
        ? metricGroups.find((mg) => mg.id === metricId)
        : undefined;
      const ids = isGroup
        ? expandMetricGroups(metricGroup?.metrics ?? [], metricGroups)
        : [metricId];

      // Query generation rejects funnel metrics for bandits.
      if (experimentType === "multi-armed-bandit") {
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

      if (clusterSubUnit && clusterIdentifier) {
        for (const id of ids) {
          const metric = getExperimentMetricById(id);
          if (!metric) continue;
          const eligibility = getClusterExperimentMetricEligibility(metric, {
            clusterIdentifier,
            clusterSubUnitIdentifier: clusterSubUnit,
            getFactTable: getFactTableById,
            datasourceSettings: datasourceObj?.settings,
          });
          if (!eligibility.allowed) {
            return {
              disabled: true,
              reason: isGroup
                ? `"${metric.name}" can't be used in cluster experiments. ${eligibility.reason}`
                : eligibility.reason,
            };
          }
        }
      }

      if (!isExperimentIncludedInIncrementalRefresh) {
        return { disabled: false };
      }
      if (isGroup && !metricGroup) {
        return { disabled: false };
      }

      // Event quantile metrics require KLL support for incremental refresh.
      const hasUnsupportedEventQuantileMetrics = ids.some((id) => {
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

      const hasLegacyMetrics = ids.some((id) => {
        const metric = getExperimentMetricById(id);
        return metric && !isFactMetric(metric);
      });
      if (hasLegacyMetrics) {
        return {
          disabled: true,
          reason: "Only fact metrics are supported with Incremental Refresh",
        };
      }

      return { disabled: false };
    };
  }, [
    datasource,
    exposureQueryId,
    exposureQueryIdentifierType,
    experimentId,
    experimentType,
    isClusterExperiment,
    clusterSubUnitIdentifier,
    getFactTableById,
    getExperimentMetricById,
    getDatasourceById,
    metricGroups,
  ]);

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
            exposureQueryIdentifierType={exposureQueryIdentifierType}
            isClusterExperiment={isClusterExperiment}
            clusterSubUnitIdentifier={clusterSubUnitIdentifier}
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
                exposureQueryIdentifierType={exposureQueryIdentifierType}
                isClusterExperiment={isClusterExperiment}
                clusterSubUnitIdentifier={clusterSubUnitIdentifier}
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
                exposureQueryIdentifierType={exposureQueryIdentifierType}
                isClusterExperiment={isClusterExperiment}
                clusterSubUnitIdentifier={clusterSubUnitIdentifier}
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
