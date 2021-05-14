import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FC, useState, useContext } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import RefreshSnapshotButton from "./RefreshSnapshotButton";
import { phaseSummary } from "../../services/utils";
import clsx from "clsx";
import { UserContext } from "../ProtectedPage";
import ViewQueryButton from "../Metrics/ViewQueryButton";
import { FaPencilAlt } from "react-icons/fa";
import dynamic from "next/dynamic";
import Markdown from "../Markdown/Markdown";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";

const BreakDownResults = dynamic(() => import("./BreakDownResults"));
const CompactResults = dynamic(() => import("./CompactResults"));

const Results: FC<{
  experiment: ExperimentInterfaceStringDates;
  editMetrics: () => void;
  editResult: () => void;
}> = ({ experiment, editMetrics, editResult }) => {
  const { dimensions } = useDefinitions();

  const [phase, setPhase] = useState(experiment.phases.length - 1);
  const [dimension, setDimension] = useState("");

  const { permissions } = useContext(UserContext);

  const { data, error, mutate } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment.id}/snapshot/${phase}` +
      (dimension ? "/" + dimension : "")
  );

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const snapshot = data.snapshot;

  const result = experiment.results;

  const variationsPlural =
    experiment.variations.length > 2 ? "variations" : "variation";

  const filteredDimensions = dimensions.filter(
    (d) => d.datasource === experiment.datasource
  );

  return (
    <>
      {experiment.status === "stopped" && result && (
        <div
          className={clsx("alert", {
            "alert-success": result === "won",
            "alert-danger": result === "lost",
            "alert-info": result === "inconclusive",
            "alert-warning": result === "dnf",
          })}
        >
          {permissions.runExperiments && (
            <a
              href="#"
              className="alert-link float-right ml-2"
              onClick={(e) => {
                e.preventDefault();
                editResult();
              }}
            >
              <FaPencilAlt />
            </a>
          )}
          <strong>
            {result === "won" &&
              `${
                experiment.winner > 0
                  ? experiment.variations[experiment.winner]?.name
                  : "A variation"
              } beat the control and won!`}
            {result === "lost" &&
              `The ${variationsPlural} did not beat the control.`}
            {result === "dnf" &&
              `The experiment was stopped early and did not finish.`}
            {result === "inconclusive" && `The results were inconclusive.`}
          </strong>
          {experiment.analysis && (
            <div className="card text-dark mt-2">
              <div className="card-body">
                <Markdown className="card-text">{experiment.analysis}</Markdown>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="row mb-3">
        {experiment.phases && experiment.phases.length > 1 && (
          <div className="col-auto mb-2">
            <div className="input-group">
              <div className="input-group-prepend">
                <div className="input-group-text">Phase</div>
              </div>
              <select
                className="form-control"
                value={phase}
                onChange={(e) => {
                  setPhase(parseInt(e.target.value));
                }}
              >
                {experiment.phases.map((phase, i) => (
                  <option key={i} value={i}>
                    {i + 1}: {phaseSummary(phase)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {filteredDimensions.length > 0 && (
          <div className="col-auto">
            <div className="input-group">
              <div className="input-group-prepend">
                <div className="input-group-text">Dimension</div>
              </div>
              <select
                className="form-control"
                value={dimension}
                onChange={(e) => {
                  setDimension(e.target.value);
                }}
              >
                <option value="">None</option>
                {filteredDimensions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div style={{ flex: 1 }} />
        {permissions.runExperiments && experiment.metrics.length > 0 && (
          <div className="col-auto">
            <RefreshSnapshotButton
              mutate={mutate}
              phase={phase}
              experiment={experiment}
              lastSnapshot={snapshot}
              dimension={dimension}
            />
          </div>
        )}
      </div>
      {experiment.metrics.length === 0 && (
        <div className="alert alert-info">
          Add at least 1 metric to view results.
        </div>
      )}
      {!snapshot && experiment.metrics.length > 0 && (
        <div className="alert alert-info">
          No data yet.{" "}
          {permissions.runExperiments && `Click the "Update" button above.`}
        </div>
      )}
      {snapshot && snapshot.dimension && (
        <BreakDownResults snapshot={snapshot} experiment={experiment} />
      )}
      {snapshot && !snapshot.dimension && (
        <CompactResults snapshot={snapshot} experiment={experiment} />
      )}
      {snapshot && (
        <div>
          {permissions.runExperiments && editMetrics && (
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => {
                editMetrics();
              }}
            >
              Add/Remove Metrics
            </button>
          )}
          {snapshot && snapshot.query && snapshot.queryLanguage !== "none" && (
            <ViewQueryButton
              queries={[snapshot.query]}
              language={snapshot.queryLanguage}
            />
          )}
        </div>
      )}
    </>
  );
};

export default Results;
