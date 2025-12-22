import { FC, useMemo } from "react";
import { MdSwapCalls } from "react-icons/md";
import {
  ExperimentReportVariation,
  MetricSnapshotSettings,
} from "shared/types/report";
import {
  ExperimentStatus,
  ExperimentType,
  MetricOverride,
} from "shared/types/experiment";
import { PValueCorrection, StatsEngine } from "shared/types/stats";
import Link from "next/link";
import { FaTimes } from "react-icons/fa";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  getMetricLink,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
} from "shared/experiments";
import { isDefined } from "shared/util";
import { SafeRolloutReportResultDimension } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
} from "@/services/experiments";
import { GBCuped } from "@/components/Icons";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricTooltipBody from "@/components/Metrics/MetricTooltipBody";
import MetricName, { PercentileLabel } from "@/components/Metrics/MetricName";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import ConditionalWrapper from "@/components/ConditionalWrapper";
import ResultsTable from "./ResultsTable";

const CompactResults: FC<{
  editMetrics?: () => void;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  baselineRow?: number;
  results: SafeRolloutReportResultDimension;
  queryStatusData?: QueryStatusData;
  reportDate: Date;
  startDate: string;
  isLatestPhase: boolean;
  status: ExperimentStatus;
  goalMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  id: string;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  regressionAdjustmentEnabled?: boolean;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  noTooltip?: boolean;
  experimentType?: ExperimentType;
  ssrPolyfills?: SSRPolyfills;
  hideDetails?: boolean;
}> = ({
  editMetrics,
  variations,
  variationFilter,
  baselineRow = 0,
  results,
  queryStatusData,
  reportDate,
  startDate,
  isLatestPhase,
  status,
  goalMetrics,
  guardrailMetrics,
  metricOverrides,
  id,
  statsEngine,
  pValueCorrection,
  regressionAdjustmentEnabled,
  settingsForSnapshotMetrics,
  noTooltip,
  experimentType,
  ssrPolyfills,
  hideDetails,
}) => {
  const { getExperimentMetricById, metricGroups, ready } = useDefinitions();

  const _pValueThreshold = usePValueThreshold();
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold() || _pValueThreshold;

  const { expandedGoals, expandedGuardrails } = useMemo(() => {
    const expandedGoals = expandMetricGroups(
      goalMetrics,
      ssrPolyfills?.metricGroups || metricGroups,
    );
    const expandedGuardrails = expandMetricGroups(
      guardrailMetrics,
      ssrPolyfills?.metricGroups || metricGroups,
    );

    return { expandedGoals, expandedGuardrails };
  }, [goalMetrics, metricGroups, ssrPolyfills?.metricGroups, guardrailMetrics]);

  const rows = useMemo<ExperimentTableRow[]>(() => {
    function getRow(
      metricId: string,
      resultGroup: "goal" | "secondary" | "guardrail",
    ) {
      const metric =
        ssrPolyfills?.getExperimentMetricById?.(metricId) ||
        getExperimentMetricById(metricId);
      if (!metric) return null;
      const { newMetric, overrideFields } = applyMetricOverrides(
        metric,
        metricOverrides,
      );
      let metricSnapshotSettings: MetricSnapshotSettings | undefined;
      if (settingsForSnapshotMetrics) {
        metricSnapshotSettings = settingsForSnapshotMetrics.find(
          (s) => s.metric === metricId,
        );
      }
      return {
        label: newMetric?.name,
        metric: newMetric,
        metricOverrideFields: overrideFields,
        rowClass: newMetric?.inverse ? "inverse" : "",
        variations: results.variations.map((v) => {
          return (
            v.metrics?.[metricId] || {
              users: 0,
              value: 0,
              cr: 0,
              errorMessage: "No data",
            }
          );
        }),
        metricSnapshotSettings,
        resultGroup,
      };
    }

    if (!results || !results.variations || (!ready && !ssrPolyfills)) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      // Only include goals in calculation, not secondary or guardrails
      setAdjustedPValuesOnResults([results], expandedGoals, pValueCorrection);
      setAdjustedCIs([results], pValueThreshold);
    }

    const retGuardrails = expandedGuardrails
      .map((metricId) => getRow(metricId, "guardrail"))
      .filter(isDefined);
    return [...retGuardrails];
  }, [
    results,
    expandedGoals,
    expandedGuardrails,
    metricOverrides,
    settingsForSnapshotMetrics,
    pValueCorrection,
    pValueThreshold,
    statsEngine,
    ready,
    ssrPolyfills,
    getExperimentMetricById,
  ]);

  const isBandit = experimentType === "multi-armed-bandit";

  return (
    <>
      {expandedGuardrails.length ? (
        <div className="mt-4" style={{ overflowX: "auto" }}>
          <ResultsTable
            dateCreated={reportDate}
            isLatestPhase={isLatestPhase}
            startDate={startDate}
            status={status}
            queryStatusData={queryStatusData}
            variations={variations}
            variationFilter={variationFilter}
            baselineRow={baselineRow}
            rows={rows.filter((r) => r.resultGroup === "guardrail")}
            id={id}
            editMetrics={editMetrics}
            statsEngine="frequentist"
            pValueCorrection={pValueCorrection}
            differenceType="absolute"
            renderLabelColumn={getRenderLabelColumn({
              regressionAdjustmentEnabled,
              statsEngine,
              hideDetails,
            })}
            isTabActive={true}
            noStickyHeader={true}
            noTooltip={noTooltip}
            isBandit={isBandit}
            ssrPolyfills={ssrPolyfills}
          />
        </div>
      ) : (
        <></>
      )}
    </>
  );
};
export default CompactResults;

export function getRenderLabelColumn({
  regressionAdjustmentEnabled,
  statsEngine,
  hideDetails,
}: {
  regressionAdjustmentEnabled?: boolean;
  statsEngine?: StatsEngine;
  hideDetails?: boolean;
}) {
  return function renderLabelColumn({
    metric,
    row,
    maxRows,
  }: {
    metric: ExperimentMetricInterface;
    row?: ExperimentTableRow;
    maxRows?: number;
  }) {
    const metricLink = (
      <Tooltip
        body={
          <MetricTooltipBody
            metric={metric}
            row={row}
            statsEngine={statsEngine}
            hideDetails={hideDetails}
          />
        }
        tipPosition="right"
        className="d-inline-block font-weight-bold metric-label"
        flipTheme={false}
        usePortal={true}
      >
        {" "}
        <span
          style={
            maxRows
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: maxRows,
                  WebkitBoxOrient: "vertical",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  lineHeight: "1.2em",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                }
              : {
                  lineHeight: "1.2em",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                }
          }
        >
          <ConditionalWrapper
            condition={!hideDetails}
            wrapper={
              <Link
                href={getMetricLink(metric.id)}
                className="metriclabel text-dark"
              />
            }
          >
            <MetricName metric={metric} disableTooltip />
            <PercentileLabel metric={metric} />
          </ConditionalWrapper>
        </span>
      </Tooltip>
    );

    const cupedIconDisplay =
      regressionAdjustmentEnabled &&
      !row?.metricSnapshotSettings?.regressionAdjustmentEnabled ? (
        <Tooltip
          className="ml-1"
          body={
            row?.metricSnapshotSettings?.regressionAdjustmentReason
              ? `CUPED disabled: ${row?.metricSnapshotSettings?.regressionAdjustmentReason}`
              : `CUPED disabled`
          }
        >
          <div
            className="d-inline-block mr-1 position-relative"
            style={{ width: 12, height: 12 }}
          >
            <GBCuped className="position-absolute" size={12} />
            <FaTimes
              className="position-absolute"
              color="#ff0000"
              style={{ transform: "scale(0.7)", top: -4, right: -8 }}
            />
          </div>
        </Tooltip>
      ) : null;

    const metricInverseIconDisplay = metric.inverse ? (
      <Tooltip
        body="metric is inverse, lower is better"
        className="inverse-indicator ml-1"
      >
        <MdSwapCalls />
      </Tooltip>
    ) : null;

    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        {metricLink}
        {metricInverseIconDisplay}
        {cupedIconDisplay}
      </span>
    );
  };
}
