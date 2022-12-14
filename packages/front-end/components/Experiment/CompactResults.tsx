import React, { FC, useMemo } from "react";
import { MdSwapCalls } from "react-icons/md";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import Link from "next/link";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
  useRiskVariation,
} from "@/services/experiments";
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
}) => {
  const { getMetricById, ready } = useDefinitions();

  const rows = useMemo<ExperimentTableRow[]>(() => {
    if (!results || !results.variations || !ready) return [];
    return metrics
      .map((metricId) => {
        const metric = getMetricById(metricId);
        const { newMetric } = applyMetricOverrides(metric, metricOverrides);
        return {
          label: newMetric?.name,
          metric: newMetric,
          rowClass: newMetric?.inverse ? "inverse" : "",
          variations: results.variations.map((v) => {
            return v.metrics[metricId];
          }),
        };
      })
      .filter((row) => row.metric);
  }, [results, metrics, metricOverrides, ready]);

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
      <div className="mb-3 experiment-compact-holder">
        <ResultsTable
          dateCreated={reportDate}
          isLatestPhase={isLatestPhase}
          startDate={startDate}
          status={status}
          variations={variations}
          id={id}
          {...risk}
          labelHeader="Metric"
          users={users}
          renderLabelColumn={(label, metric) => {
            const metricLink = (
              <Tooltip
                body={<MetricTooltipBody metric={metric} />}
                tipPosition="right"
              >
                <Link href={`/metric/${metric.id}`}>
                  <a className="text-dark font-weight-bold">{label}</a>
                </Link>
              </Tooltip>
            );
            if (!metric.inverse) {
              return metricLink;
            }
            return (
              <>
                {metricLink}{" "}
                <Tooltip
                  body="metric is inverse, lower is better"
                  className="inverse-indicator"
                >
                  <MdSwapCalls />
                </Tooltip>
              </>
            );
          }}
          rows={rows}
        />
      </div>
    </>
  );
};
export default CompactResults;
