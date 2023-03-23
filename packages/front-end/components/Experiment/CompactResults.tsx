import React, { FC, useMemo } from "react";
import { MdSwapCalls } from "react-icons/md";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import { StatsEngine } from "back-end/types/stats";
import Link from "next/link";
import { FaTimes } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
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
  id: string;
  statsEngine?: StatsEngine;
  regressionAdjustmentEnabled?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
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
  regressionAdjustmentEnabled,
  metricRegressionAdjustmentStatuses,
}) => {
  const { getMetricById, ready } = useDefinitions();

  const rows = useMemo<ExperimentTableRow[]>(() => {
    if (!results || !results.variations || !ready) return [];
    return metrics
      .map((metricId) => {
        const metric = getMetricById(metricId);
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
      .filter((row) => row.metric);
  }, [
    results,
    metrics,
    metricOverrides,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    ready,
  ]);

  const users = useMemo(() => {
    const vars = results?.variations;
    return variations.map((v, i) => vars?.[i]?.users || 0);
  }, [results]);
  const risk = useRiskVariation(variations.length, rows);

  return (
    <>
      <div className="px-3">
        <DataQualityWarning results={results} variations={variations} />
        <MultipleExposureWarning
          users={users}
          multipleExposures={multipleExposures}
        />
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
        <ResultsTable
          dateCreated={reportDate}
          isLatestPhase={isLatestPhase}
          startDate={startDate}
          status={status}
          variations={variations}
          rows={rows}
          id={id}
          {...risk}
          labelHeader="Metric"
          users={users}
          statsEngine={statsEngine}
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
                <Link href={`/metric/${metric.id}`}>
                  <a className="text-dark font-weight-bold">{label}</a>
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
export default CompactResults;
