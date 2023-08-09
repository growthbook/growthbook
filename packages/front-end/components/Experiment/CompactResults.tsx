import React, { FC, useMemo } from "react";
import { MdSwapCalls } from "react-icons/md";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import Link from "next/link";
import { FaTimes } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  setAdjustedPValuesOnResults,
  ExperimentTableRow,
  useRiskVariation,
} from "@/services/experiments";
import { GBCuped } from "@/components/Icons";
import Tooltip from "../Tooltip/Tooltip";
import MetricTooltipBody from "../Metrics/MetricTooltipBody";
import DataQualityWarning from "./DataQualityWarning";
import ResultsTable from "./ResultsTable";
import MultipleExposureWarning from "./MultipleExposureWarning";

const CompactResults: FC<{
  editMetrics?: () => void;
  variations: ExperimentReportVariation[];
  multipleExposures?: number;
  results: ExperimentReportResultDimension;
  reportDate: Date;
  startDate: string;
  isLatestPhase: boolean;
  status: ExperimentStatus;
  metrics: string[];
  metricOverrides: MetricOverride[];
  guardrails?: string[];
  id: string;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  regressionAdjustmentEnabled?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  sequentialTestingEnabled?: boolean;
  showAdvanced?: boolean;
  isTabActive: boolean;
}> = ({
  results,
  variations,
  multipleExposures = 0,
  editMetrics,
  reportDate,
  startDate,
  status,
  isLatestPhase,
  metrics,
  metricOverrides,
  guardrails = [],
  id,
  statsEngine,
  pValueCorrection,
  regressionAdjustmentEnabled,
  metricRegressionAdjustmentStatuses,
  sequentialTestingEnabled,
  showAdvanced = false,
  isTabActive,
}) => {
  const { getMetricById, ready } = useDefinitions();

  const rows = useMemo<ExperimentTableRow[]>(() => {
    function getRow(metricId: string, isGuardrail: boolean) {
      const metric = getMetricById(metricId);
      if (!metric) return null;
      const { newMetric } = applyMetricOverrides(metric, metricOverrides);
      let regressionAdjustmentStatus:
        | MetricRegressionAdjustmentStatus
        | undefined;
      if (regressionAdjustmentEnabled && metricRegressionAdjustmentStatuses) {
        regressionAdjustmentStatus = metricRegressionAdjustmentStatuses.find(
          (s) => s.metric === metricId
        );
      }
      return {
        label: newMetric?.name,
        metric: newMetric,
        rowClass: newMetric?.inverse ? "inverse" : "",
        variations: results.variations.map((v) => {
          return v.metrics[metricId];
        }),
        regressionAdjustmentStatus,
        isGuardrail,
      };
    }

    if (!results || !results.variations || !ready) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      setAdjustedPValuesOnResults([results], metrics, pValueCorrection);
    }
    const retMetrics = metrics
      .map((metricId) => getRow(metricId, false))
      .filter((row) => row?.metric) as ExperimentTableRow[];
    const retGuardrails = guardrails
      .map((metricId) => getRow(metricId, true))
      .filter((row) => row?.metric) as ExperimentTableRow[];
    return [...retMetrics, ...retGuardrails];
  }, [
    results,
    metrics,
    guardrails,
    metricOverrides,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    pValueCorrection,
    ready,
    getMetricById,
    statsEngine,
  ]);

  const users = useMemo(() => {
    const vars = results?.variations;
    return variations.map((v, i) => vars?.[i]?.users || 0);
  }, [results, variations]);
  const risk = useRiskVariation(variations.length, rows);

  return (
    <>
      <div className="">
        <DataQualityWarning results={results} variations={variations} />
        <MultipleExposureWarning
          users={users}
          multipleExposures={multipleExposures}
        />
      </div>
      <ResultsTable
        dateCreated={reportDate}
        isLatestPhase={isLatestPhase}
        startDate={startDate}
        status={status}
        variations={variations}
        rows={rows.filter((r) => !r.isGuardrail)}
        id={id}
        hasRisk={risk.hasRisk}
        tableRowAxis="metric"
        labelHeader="Goal Metrics"
        editMetrics={editMetrics}
        statsEngine={statsEngine}
        sequentialTestingEnabled={sequentialTestingEnabled}
        pValueCorrection={pValueCorrection}
        renderLabelColumn={getRenderLabelColumn(regressionAdjustmentEnabled)}
        showAdvanced={showAdvanced}
        isTabActive={isTabActive}
      />

      <div className="mt-4">
        <ResultsTable
          dateCreated={reportDate}
          isLatestPhase={isLatestPhase}
          startDate={startDate}
          status={status}
          variations={variations}
          rows={rows.filter((r) => r.isGuardrail)}
          id={id}
          hasRisk={risk.hasRisk}
          tableRowAxis="metric"
          labelHeader="Guardrail Metrics"
          editMetrics={editMetrics}
          metricsAsGuardrails={true}
          statsEngine={statsEngine}
          sequentialTestingEnabled={sequentialTestingEnabled}
          pValueCorrection={pValueCorrection}
          renderLabelColumn={getRenderLabelColumn(regressionAdjustmentEnabled)}
          showAdvanced={showAdvanced}
          isTabActive={isTabActive}
        />
      </div>
    </>
  );
};
export default CompactResults;

function getRenderLabelColumn(regressionAdjustmentEnabled) {
  return function renderLabelColumn(label, metric, row) {
    const metricLink = (
      <Tooltip
        body={
          <MetricTooltipBody
            metric={metric}
            row={row}
            reportRegressionAdjustmentEnabled={regressionAdjustmentEnabled}
            newUi={true}
          />
        }
        tipPosition="right"
      >
        <Link href={`/metric/${metric.id}`}>
          <a className="metriclabel text-dark">{label}</a>
        </Link>
      </Tooltip>
    );

    const cupedIconDisplay =
      regressionAdjustmentEnabled &&
      !row?.regressionAdjustmentStatus?.regressionAdjustmentEnabled ? (
        <Tooltip
          className="ml-1"
          body={
            row?.regressionAdjustmentStatus?.reason
              ? `CUPED disabled: ${row?.regressionAdjustmentStatus?.reason}`
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
      <>
        {metricLink}
        {metricInverseIconDisplay}
        {cupedIconDisplay}
      </>
    );
  };
}
