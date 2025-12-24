import { FC, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { FaQuestionCircle } from "react-icons/fa";
import { datetime } from "shared/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import Modal from "@/components/Modal";
import Code from "@/components/SyntaxHighlighting/Code";
import { AttributionModelTooltip } from "./AttributionModelTooltip";

const FilterSummary: FC<{
  experiment: ExperimentInterfaceStringDates;
  phase?: ExperimentPhaseStringDates;
  snapshot: ExperimentSnapshotInterface;
}> = ({ experiment, phase, snapshot }) => {
  const [showExpandedFilter, setShowExpandedFilter] = useState(false);
  const hasFilter =
    snapshot.settings.segment ||
    snapshot.settings.queryFilter ||
    snapshot.settings.activationMetric;
  const { getSegmentById, getExperimentMetricById, getDatasourceById } =
    useDefinitions();
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
        trackingEventModalType=""
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
                  experiment.userIdType,
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
                <strong>{datetime(phase.dateStarted ?? "", "UTC")}</strong> to
                <br />
                <strong>
                  {datetime(phase.dateEnded || snapshot.dateCreated, "UTC")}
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
                {snapshot.settings.segment ? (
                  (getSegmentById(snapshot.settings.segment)?.name ??
                  "(unknown)")
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
              {snapshot.settings.activationMetric ? (
                (getExperimentMetricById(snapshot.settings.activationMetric)
                  ?.name ?? "(unknown)")
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
              {snapshot.settings.skipPartialData
                ? "Excluding In-Progress Conversions"
                : "Including In-Progress Conversions"}
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-5">
              <strong className="text-gray">
                <AttributionModelTooltip>
                  Conversion Window Override <FaQuestionCircle />
                </AttributionModelTooltip>
              </strong>
            </div>
            <div className="col">
              {experiment.attributionModel === "experimentDuration"
                ? "Ignore Conversion Windows"
                : "Respect Conversion Windows"}
            </div>
          </div>
          {datasource?.properties?.queryLanguage === "sql" && (
            <div className="row mb-3">
              <div className="col-5">
                <strong className="text-gray">Custom SQL Filter:</strong>
              </div>
              <div className="col">
                {snapshot.settings.queryFilter ? (
                  <Code
                    language="sql"
                    code={snapshot.settings.queryFilter}
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
