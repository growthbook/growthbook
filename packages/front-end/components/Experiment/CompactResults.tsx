import React, { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
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

const CompactResults: FC<{
  snapshot: ExperimentSnapshotInterface;
  experiment: ExperimentInterfaceStringDates;
  phase?: ExperimentPhaseStringDates;
  isUpdating?: boolean;
  editMetrics?: () => void;
}> = ({ snapshot, experiment, phase, isUpdating, editMetrics }) => {
  const { getMetricById } = useDefinitions();

  const rows = useMemo<ExperimentTableRow[]>(() => {
    const results = snapshot.results[0];
    if (!results || !results.variations) return [];
    return experiment.metrics
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
  }, [snapshot]);

  const users = useMemo(() => {
    const vars = snapshot.results?.[0]?.variations;
    return experiment.variations.map((v, i) => vars?.[i]?.users || 0);
  }, [snapshot]);

  const risk = useRiskVariation(experiment, rows);

  return (
    <>
      <div className="px-3">
        <DataQualityWarning
          experiment={experiment}
          snapshot={snapshot}
          phase={phase}
          isUpdating={isUpdating}
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
              Add/Remove Metrics
            </a>
          )}
        </h3>
      </div>
      <div className="mb-3 experiment-compact-holder">
        <ResultsTable
          dateCreated={snapshot.dateCreated}
          experiment={experiment}
          id={experiment.id}
          {...risk}
          labelHeader="Metric"
          phase={snapshot.phase}
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
