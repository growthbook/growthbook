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
import { getMetricLink } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  setAdjustedPValuesOnResults,
  ExperimentTableRow,
  useRiskVariation,
  setAdjustedCIs,
} from "@/services/experiments";
import { GBCuped } from "@/components/Icons";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricTooltipBody from "@/components/Metrics/MetricTooltipBody";
import DataQualityWarning from "./DataQualityWarning";
import ResultsTable_old from "./ResultsTable_old";
import MultipleExposureWarning from "./MultipleExposureWarning";

const CompactResults_old: FC<{
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
  id: string;
  statsEngine?: StatsEngine;
  pValueCorrection?: PValueCorrection;
  regressionAdjustmentEnabled?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  sequentialTestingEnabled?: boolean;
}> = ({
  results,
  variations,
  multipleExposures,
  editMetrics,
  reportDate,
  startDate,
  status,
  isLatestPhase,
  metrics,
  metricOverrides,
  id,
  statsEngine,
  pValueCorrection,
  regressionAdjustmentEnabled,
  metricRegressionAdjustmentStatuses,
  sequentialTestingEnabled,
}) => {
  const { getExperimentMetricById, ready } = useDefinitions();
  const pValueThreshold = usePValueThreshold();

  const rows = useMemo<ExperimentTableRow[]>(() => {
    if (!results || !results.variations || !ready) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      setAdjustedPValuesOnResults([results], metrics, pValueCorrection);
      setAdjustedCIs([results], pValueThreshold);
    }
    return metrics
      .map((metricId) => {
        const metric = getExperimentMetricById(metricId);
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
        };
      })
      .filter((row) => row?.metric) as ExperimentTableRow[];
  }, [
    results,
    metrics,
    metricOverrides,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    pValueCorrection,
    pValueThreshold,
    ready,
    getExperimentMetricById,
    statsEngine,
  ]);

  const users = useMemo(() => {
    const vars = results?.variations;
    return variations.map((v, i) => vars?.[i]?.users || 0);
  }, [results, variations]);
  const risk = useRiskVariation(variations.length, rows);

  return (
    <>
      <div className="px-3">
        <DataQualityWarning results={results} variations={variations} />
        {multipleExposures !== undefined && (
          <MultipleExposureWarning
            users={users}
            multipleExposures={multipleExposures}
          />
        )}
        <h3 className="mb-3">
          Metrics
          {editMetrics && (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                editMetrics();
              }}
              className="ml-2"
              style={{ fontSize: "0.8rem" }}
            >
              Adjust Metrics
            </a>
          )}
        </h3>
      </div>
      <div className="mb-1 experiment-compact-holder">
        <ResultsTable_old
          dateCreated={reportDate}
          isLatestPhase={isLatestPhase}
          startDate={startDate}
          status={status}
          variations={variations}
          rows={rows}
          id={id}
          {...risk}
          tableRowAxis="metric"
          labelHeader="Metric"
          users={users}
          statsEngine={statsEngine}
          sequentialTestingEnabled={sequentialTestingEnabled}
          pValueCorrection={pValueCorrection}
          renderLabelColumn={(label, metric, row) => {
            const metricLink = (
              <Tooltip
                body={
                  <MetricTooltipBody
                    metric={metric}
                    row={row}
                    reportRegressionAdjustmentEnabled={
                      regressionAdjustmentEnabled
                    }
                  />
                }
                tipPosition="right"
              >
                <Link href={getMetricLink(metric.id)}>
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
          }}
        />
      </div>
    </>
  );
};
export default CompactResults_old;
