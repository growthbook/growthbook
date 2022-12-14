import { FC, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { FaQuestionCircle } from "react-icons/fa";
import { datetime } from "@/services/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import Modal from "../Modal";
import Code from "../SyntaxHighlighting/Code";
import { AttributionModelTooltip } from "./AttributionModelTooltip";

const FilterSummary: FC<{
  experiment: ExperimentInterfaceStringDates;
  phase?: ExperimentPhaseStringDates;
  snapshot: ExperimentSnapshotInterface;
}> = ({ experiment, phase, snapshot }) => {
  const [showExpandedFilter, setShowExpandedFilter] = useState(false);
  const hasFilter =
    snapshot.segment || snapshot.queryFilter || snapshot.activationMetric;
  const { getSegmentById, getMetricById, getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);

  return (
    <>
      <span className="text-muted" style={{ fontSize: "0.8em" }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setShowExpandedFilter(true);
          }}
          title={
            hasFilter
              ? "Custom filters applied, click to see"
              : "Click to see the report details"
          }
        >
          Report details{hasFilter && "*"}
        </a>
      </span>
      <Modal
        header={"Experiment Details and Filters"}
        open={showExpandedFilter}
        closeCta="Close"
        close={() => {
          setShowExpandedFilter(false);
        }}
        size="md"
      >
        <div className="text-gray">
          <div className="row mb-3">
            <div className="col-5">
              <strong className="text-gray">Experiment Id:</strong>
            </div>
            <div className="col">{experiment.trackingKey}</div>
          </div>
          {datasource?.properties?.exposureQueries && (
            <div className="row mb-3">
              <div className="col-5">
                <strong className="text-gray">Exposure Query:</strong>
              </div>
              <div className="col">
                {getExposureQuery(
                  datasource?.settings,
                  experiment.exposureQueryId,
                  experiment.userIdType
                )?.name || "None"}
              </div>
            </div>
          )}
          {phase && (
            <div className="row mb-3">
              <div className="col-5">
                <strong className="text-gray">Date range:</strong>
              </div>
              <div className="col">
                <strong>{datetime(phase.dateStarted)}</strong> to
                <br />
                <strong>
                  {datetime(phase.dateEnded || snapshot.dateCreated)}
                </strong>
                {!phase.dateEnded && " (last update)"}
              </div>
            </div>
          )}
          {datasource?.properties?.segments && (
            <div className="row mb-3">
              <div className="col-5">
                <strong className="text-gray">Segment:</strong>
                <small className="form-text text-muted">
                  Only users in this segment are included in analysis
                </small>
              </div>
              <div className="col">
                {snapshot.segment ? (
                  getSegmentById(snapshot.segment)?.name ?? "(unknown)"
                ) : (
                  <>
                    <em>none</em> (all users included)
                  </>
                )}
              </div>
            </div>
          )}
          <div className="row mb-3">
            <div className="col-5">
              <strong className="text-gray">Activation Metric:</strong>
              <small className="form-text text-muted">
                Users must convert on this metric before being included
              </small>
            </div>
            <div className="col">
              {snapshot.activationMetric ? (
                getMetricById(snapshot.activationMetric)?.name ?? "(unknown)"
              ) : (
                <em>none</em>
              )}
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-5">
              <strong className="text-gray">Metric Conversions:</strong>
            </div>
            <div className="col">
              {snapshot.skipPartialData
                ? "Excluding In-Progress Conversions"
                : "Including In-Progress Conversions"}
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-5">
              <strong className="text-gray">
                Users in Multiple Variations:
              </strong>
            </div>
            <div className="col">
              {experiment.removeMultipleExposures
                ? "Removed from analysis"
                : "Included in analysis"}
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-5">
              <strong className="text-gray">
                <AttributionModelTooltip>
                  Attribution Model <FaQuestionCircle />
                </AttributionModelTooltip>
              </strong>
            </div>
            <div className="col">
              {experiment.attributionModel === "allExposures"
                ? "All Exposures"
                : "First Exposure"}
            </div>
          </div>
          {datasource?.properties?.queryLanguage === "sql" && (
            <div className="row mb-3">
              <div className="col-5">
                <strong className="text-gray">Custom SQL Filter:</strong>
              </div>
              <div className="col">
                {snapshot.queryFilter ? (
                  <Code
                    language="sql"
                    code={snapshot.queryFilter}
                    expandable={true}
                  />
                ) : (
                  <em>none</em>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};

export default FilterSummary;
