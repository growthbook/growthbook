import React, { FC, useMemo } from "react";
import { useDefinitions } from "../../services/DefinitionsContext";
import { MdSwapCalls } from "react-icons/md";
import Tooltip from "../Tooltip";
import DataQualityWarning from "./DataQualityWarning";
import {
  ExperimentTableRow,
  useRiskVariation,
} from "../../services/experiments";
import ResultsTable from "./ResultsTable";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import { ExperimentStatus } from "back-end/types/experiment";
import MultipleExposureWarning from "./MultipleExposureWarning";
import MetricTooltipBody from "../Metrics/MetricTooltipBody";
import Link from "next/link";

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
  id,
}) => {
  const { getMetricById, ready } = useDefinitions();

  const rows = useMemo<ExperimentTableRow[]>(() => {
    if (!results || !results.variations || !ready) return [];
    return metrics
      .map((m) => {
        const metric = getMetricById(m);
        return {
          label: metric?.name,
          metric,
          rowClass: metric?.inverse ? "inverse" : "",
          variations: results.variations.map((v) => {
            return v.metrics[m];
          }),
        };
      })
      .filter((row) => row.metric);
  }, [results, ready]);

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
