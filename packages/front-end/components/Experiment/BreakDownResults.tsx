import { FC, useMemo, useState } from "react";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricSnapshotSettings,
} from "back-end/types/report";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
} from "shared/experiments";
import { isDefined } from "shared/util";
import { FaAngleRight, FaUsers } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
  hasRisk,
} from "@/services/experiments";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import {
  ResultsMetricFilters,
  sortAndFilterMetricsByTags,
} from "@/components/Experiment/Results";
import ResultsMetricFilter from "@/components/Experiment/ResultsMetricFilter";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import useOrgSettings from "@/hooks/useOrgSettings";
import UsersTable from "./UsersTable";

const numberFormatter = Intl.NumberFormat();

export function getMetricResultGroup(
  metricId,
  goalMetrics: string[],
  secondaryMetrics: string[]
): "goal" | "secondary" | "guardrail" {
  return goalMetrics.includes(metricId)
    ? "goal"
    : secondaryMetrics.includes(metricId)
    ? "secondary"
    : "guardrail";
}

type TableDef = {
  metric: ExperimentMetricInterface;
  isGuardrail: boolean;
  rows: ExperimentTableRow[];
};

const BreakDownResults: FC<{
  results: ExperimentReportResultDimension[];
  queryStatusData?: QueryStatusData;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  baselineRow?: number;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  dimensionId: string;
  isLatestPhase: boolean;
  startDate: string;
  endDate: string;
  reportDate: Date;
  activationMetric?: string;
  status: ExperimentStatus;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  regressionAdjustmentEnabled?: boolean;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  sequentialTestingEnabled?: boolean;
  differenceType: DifferenceType;
  metricFilter?: ResultsMetricFilters;
  setMetricFilter?: (filter: ResultsMetricFilters) => void;
  isBandit?: boolean;
  ssrPolyfills?: SSRPolyfills;
  hideDetails?: boolean;
}> = ({
  dimensionId,
  results,
  queryStatusData,
  variations,
  variationFilter,
  baselineRow,
  goalMetrics,
  secondaryMetrics,
  metricOverrides,
  guardrailMetrics,
  isLatestPhase,
  startDate,
  endDate,
  activationMetric,
  status,
  reportDate,
  statsEngine,
  pValueCorrection,
  regressionAdjustmentEnabled,
  settingsForSnapshotMetrics,
  sequentialTestingEnabled,
  differenceType,
  metricFilter,
  setMetricFilter,
  isBandit,
  ssrPolyfills,
  hideDetails,
}) => {
  const [showMetricFilter, setShowMetricFilter] = useState<boolean>(false);

  const {
    getDimensionById,
    getExperimentMetricById,
    metricGroups,
    ready,
  } = useDefinitions();

  const _pValueThreshold = usePValueThreshold();
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold() || _pValueThreshold;

  const _settings = useOrgSettings();
  const settings = ssrPolyfills?.useOrgSettings?.() || _settings;

  const dimension =
    ssrPolyfills?.getDimensionById?.(dimensionId)?.name ||
    getDimensionById(dimensionId)?.name ||
    dimensionId?.split(":")?.[1] ||
    "Dimension";

  const totalUsers = useMemo(() => {
    let totalUsers = 0;
    results?.map((result) =>
      result?.variations?.map((v) => (totalUsers += v?.users || 0))
    );
    return totalUsers;
  }, [results]);

  const {
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
  } = useMemo(() => {
    const expandedGoals = expandMetricGroups(
      goalMetrics,
      ssrPolyfills?.metricGroups || metricGroups
    );
    const expandedSecondaries = expandMetricGroups(
      secondaryMetrics,
      ssrPolyfills?.metricGroups || metricGroups
    );
    const expandedGuardrails = expandMetricGroups(
      guardrailMetrics,
      ssrPolyfills?.metricGroups || metricGroups
    );

    return { expandedGoals, expandedSecondaries, expandedGuardrails };
  }, [
    goalMetrics,
    metricGroups,
    ssrPolyfills?.metricGroups,
    secondaryMetrics,
    guardrailMetrics,
  ]);

  const allMetricTags = useMemo(() => {
    const allMetricTagsSet: Set<string> = new Set();
    [...goalMetrics, ...secondaryMetrics, ...guardrailMetrics].forEach(
      (metricId) => {
        const metric =
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId);
        metric?.tags?.forEach((tag) => {
          allMetricTagsSet.add(tag);
        });
      }
    );
    return [...allMetricTagsSet];
  }, [
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    ssrPolyfills,
    getExperimentMetricById,
  ]);

  const tables = useMemo<TableDef[]>(() => {
    if (!ready && !ssrPolyfills) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      // Only include goals in calculation, not secondary or guardrails
      setAdjustedPValuesOnResults(results, expandedGoals, pValueCorrection);
      setAdjustedCIs(results, pValueThreshold);
    }

    const metricDefs = [
      ...expandedGoals,
      ...expandedSecondaries,
      ...expandedGuardrails,
    ]
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId)
      )
      .filter(isDefined);
    const sortedFilteredMetrics = sortAndFilterMetricsByTags(
      metricDefs,
      metricFilter
    );

    return Array.from(new Set(sortedFilteredMetrics))
      .map((metricId) => {
        const metric =
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId);
        if (!metric) return;
        const ret = sortAndFilterMetricsByTags([metric], metricFilter);
        if (ret.length === 0) return;

        const { newMetric, overrideFields } = applyMetricOverrides(
          metric,
          metricOverrides
        );
        let metricSnapshotSettings: MetricSnapshotSettings | undefined;
        if (settingsForSnapshotMetrics) {
          metricSnapshotSettings = settingsForSnapshotMetrics.find(
            (s) => s.metric === metricId
          );
        }
        const resultGroup = getMetricResultGroup(
          metricId,
          expandedGoals,
          expandedSecondaries
        );

        const rows: ExperimentTableRow[] = results.map((d) => ({
          label: d.name,
          metric: newMetric,
          variations: d.variations.map((variation) => {
            return variation.metrics[metricId];
          }),
          metricSnapshotSettings,
          resultGroup,
          metricOverrideFields: overrideFields,
        }));
        return {
          metric: newMetric,
          isGuardrail: resultGroup === "guardrail",
          rows: rows,
        };
      })
      .filter((table) => table?.metric) as TableDef[];
  }, [
    results,
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    metricOverrides,
    settingsForSnapshotMetrics,
    pValueCorrection,
    statsEngine,
    pValueThreshold,
    ready,
    ssrPolyfills,
    getExperimentMetricById,
    metricFilter,
  ]);

  const _hasRisk = hasRisk(
    ([] as ExperimentTableRow[]).concat(...tables.map((t) => t.rows))
  );

  const activationMetricObj = activationMetric
    ? ssrPolyfills?.getExperimentMetricById?.(activationMetric) ||
      getExperimentMetricById(activationMetric)
    : undefined;

  return (
    <div className="mb-3">
      <div className="mb-4">
        {dimensionId === "pre:activation" && activationMetricObj && (
          <div className="alert alert-info mt-1 mx-3">
            Your experiment has an Activation Metric (
            <strong>{activationMetricObj?.name}</strong>
            ). This report lets you compare activated users with those who
            entered into the experiment, but were not activated.
          </div>
        )}
        {!isBandit && (
          <div className="users">
            <Collapsible
              trigger={
                <div className="d-inline-flex mx-3 align-items-center">
                  <FaUsers size={16} className="mr-1" />
                  {numberFormatter.format(totalUsers)} total users
                  <FaAngleRight className="chevron ml-1" />
                </div>
              }
              transitionTime={100}
            >
              <UsersTable
                dimension={dimension}
                results={results}
                variations={variations}
                settings={settings}
              />
            </Collapsible>
          </div>
        )}
      </div>

      <div className="d-flex mx-2">
        {setMetricFilter ? (
          <ResultsMetricFilter
            metricTags={allMetricTags}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            showMetricFilter={showMetricFilter}
            setShowMetricFilter={setShowMetricFilter}
          />
        ) : null}
      </div>
      {tables.map((table, i) => {
        const metric = table.metric;
        return (
          <>
            <h5 className="ml-2 mt-2 position-relative">
              {expandedGoals.includes(metric.id)
                ? "Goal Metric"
                : expandedSecondaries.includes(metric.id)
                ? "Secondary Metric"
                : expandedGuardrails.includes(metric.id)
                ? "Guardrail Metric"
                : null}
            </h5>
            <ResultsTable
              key={i}
              dateCreated={reportDate}
              isLatestPhase={isLatestPhase}
              startDate={startDate}
              endDate={endDate}
              status={status}
              queryStatusData={queryStatusData}
              variations={variations}
              variationFilter={variationFilter}
              baselineRow={baselineRow}
              rows={table.rows}
              dimension={dimension}
              id={table.metric.id}
              hasRisk={_hasRisk}
              tableRowAxis="dimension" // todo: dynamic grouping?
              labelHeader={
                <div style={{ marginBottom: 2 }}>
                  {getRenderLabelColumn(
                    !!regressionAdjustmentEnabled,
                    statsEngine,
                    hideDetails
                  )(table.metric.name, table.metric, table.rows[0])}
                </div>
              }
              editMetrics={undefined}
              statsEngine={statsEngine}
              sequentialTestingEnabled={sequentialTestingEnabled}
              pValueCorrection={pValueCorrection}
              differenceType={differenceType}
              renderLabelColumn={(label) => (
                <>
                  {label ? (
                    label === "__NULL_DIMENSION" ? (
                      <em>NULL (unset)</em>
                    ) : (
                      <span
                        style={{
                          lineHeight: "1.2em",
                          wordBreak: "break-word",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {label}
                      </span>
                    )
                  ) : (
                    <em>unknown</em>
                  )}
                </>
              )}
              metricFilter={metricFilter}
              isTabActive={true}
              isBandit={isBandit}
              ssrPolyfills={ssrPolyfills}
            />
            <div className="mb-5" />
          </>
        );
      })}
    </div>
  );
};
export default BreakDownResults;
