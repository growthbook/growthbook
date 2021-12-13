import React, { FC } from "react";
import { useDefinitions } from "../../services/DefinitionsContext";
import { MdSwapCalls } from "react-icons/md";
import Tooltip from "../Tooltip";
import DataQualityWarning from "./DataQualityWarning";
import {
  ExperimentTableRow,
  useRiskVariation,
} from "../../services/experiments";
import { useMemo } from "react";
import ResultsTable from "./ResultsTable";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import { ExperimentStatus } from "back-end/types/experiment";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const CompactResults: FC<{
  isUpdating?: boolean;
  editMetrics?: () => void;
  variations: ExperimentReportVariation[];
  unknownVariations: string[];
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
  isUpdating,
  unknownVariations,
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
  const totalUsers = users.reduce((sum, n) => sum + n, 0);

  const risk = useRiskVariation(variations.length, rows);

  return (
    <>
      <div className="px-3">
        <DataQualityWarning
          results={results}
          unknownVariations={unknownVariations}
          variations={variations}
          isUpdating={isUpdating}
        />
        {totalUsers && multipleExposures / totalUsers >= 0.02 && (
          <div className="alert alert-warning">
            <strong>Multiple Exposures Warning</strong>. A large number of users
            ({percentFormatter.format(multipleExposures / totalUsers)}) saw
            multiple variations and were automatically removed from results.
          </div>
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
              Add/Remove Metrics
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
            if (!metric.inverse) return label;

            return (
              <>
                {label}{" "}
                <Tooltip
                  text="metric is inverse, lower is better"
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
