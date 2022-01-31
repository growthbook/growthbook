import { FC, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { datetime } from "../../services/dates";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";

const FilterSummary: FC<{
  experiment: ExperimentInterfaceStringDates;
  selectedPhase?: ExperimentPhaseStringDates;
}> = ({ experiment, selectedPhase }) => {
  const [showExpandedFilter, setShowExpandedFilter] = useState(false);
  const hasFilter =
    experiment.segment || experiment.queryFilter || experiment.activationMetric;
  const { metrics, segments } = useDefinitions();

  const getSegmentName = (segmentId: string) => {
    const segmentObj = segments.filter((s) => s.id === segmentId);
    if (segmentObj) {
      return segmentObj[0].name;
    }
    return "(unknown)";
  };

  const getMetricName = (metricId: string) => {
    const metric = metrics.filter((m) => m.id === metricId);
    if (metric) {
      return metric[0].name;
    }
    return "(unknown)";
  };

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
          {hasFilter ? "Report details*" : "Report details"}
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
          {selectedPhase && (
            <>
              <div className="row mb-3">
                <div className="col-5">
                  <strong className="text-gray">Date range:</strong>
                </div>
                <div className="col">
                  <strong>{datetime(selectedPhase.dateStarted)}</strong> to
                  <br />
                  {selectedPhase.dateEnded ? (
                    datetime(selectedPhase.dateEnded)
                  ) : (
                    <>
                      <strong>{datetime(experiment.dateUpdated)}</strong> (last
                      update)
                    </>
                  )}
                </div>
              </div>
            </>
          )}
          <div className="row mb-3">
            <div className="col-5">
              <strong className="text-gray">Segments:</strong>
              <small className="form-text text-muted">
                Only users in this segment are included in analysis
              </small>
            </div>
            <div className="col">
              {experiment.segment
                ? getSegmentName(experiment.segment)
                : "No segments applied (all users)"}
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-5">
              <strong className="text-gray">Activation Metric:</strong>
              <small className="form-text text-muted">
                Users must convert on this metric before being included
              </small>
            </div>
            <div className="col">
              {experiment.activationMetric ? (
                getMetricName(experiment.activationMetric)
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
              {experiment.skipPartialData
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
              <strong className="text-gray">Custom filter query:</strong>
            </div>
            <div className="col">
              {experiment.queryFilter ? (
                <code>{experiment.queryFilter}</code>
              ) : (
                <em>none</em>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default FilterSummary;
