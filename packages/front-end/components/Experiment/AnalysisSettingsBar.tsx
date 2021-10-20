import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import clsx from "clsx";
import { useState } from "react";
import { useContext } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { useAuth } from "../../services/auth";
import { datetime } from "../../services/dates";
import { useDefinitions } from "../../services/DefinitionsContext";
import { phaseSummary } from "../../services/utils";
import { UserContext } from "../ProtectedPage";
import RunQueriesButton, { getQueryStatus } from "../Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "../Queries/ViewAsyncQueriesButton";
import AnalysisForm from "./AnalysisForm";
import RefreshSnapshotButton from "./RefreshSnapshotButton";

function isDifferent(val1?: string, val2?: string) {
  if (!val1 && !val2) return false;
  return val1 !== val2;
}

function isOutdated(
  experiment: ExperimentInterfaceStringDates,
  snapshot: ExperimentSnapshotInterface
) {
  if (isDifferent(experiment.activationMetric, snapshot.activationMetric)) {
    console.log("activationMetric different");
    return true;
  }
  if (isDifferent(experiment.segment, snapshot.segment)) {
    console.log("segment different");
    return true;
  }
  if (isDifferent(experiment.queryFilter, snapshot.queryFilter)) {
    console.log("queryFilter different");
    return true;
  }

  return false;
}

export default function AnalysisSettingsBar({
  experiment,
  snapshot,
  latest,
  dimension,
  setDimension,
  phase,
  setPhase,
  mutate,
  mutateExperiment,
}: {
  experiment: ExperimentInterfaceStringDates;
  snapshot?: ExperimentSnapshotInterface;
  latest?: ExperimentSnapshotInterface;
  dimension: string;
  phase: number;
  setPhase: (phase: number) => void;
  setDimension: (dimension: string) => void;
  mutate: () => void;
  mutateExperiment: () => void;
}) {
  const {
    getMetricById,
    getSegmentById,
    getDatasourceById,
    dimensions,
  } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);
  const supportsSql = datasource?.properties?.queryLanguage === "sql";
  const outdated = isOutdated(experiment, snapshot);
  const [modalOpen, setModalOpen] = useState(false);

  const { permissions } = useContext(UserContext);

  const { apiCall } = useAuth();

  const filteredDimensions = dimensions.filter(
    (d) => d.datasource === experiment.datasource
  );

  const status = getQueryStatus(latest?.queries || []);

  return (
    <div className="mb-3 pt-3">
      {modalOpen && (
        <AnalysisForm
          cancel={() => setModalOpen(false)}
          experiment={experiment}
          mutate={mutateExperiment}
        />
      )}
      <div className="row align-items-center px-3">
        {experiment.phases && experiment.phases.length > 1 && (
          <div className="col-auto mb-2">
            <small>Phase</small>
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
        )}
        {(filteredDimensions.length > 0 || supportsSql) && (
          <div className="col-auto">
            <small>Dimension</small>
            <select
              className="form-control"
              value={dimension}
              onChange={(e) => {
                setDimension(e.target.value);
              }}
            >
              <option value="">None</option>
              {supportsSql && (
                <optgroup label="Built-in">
                  <option value="pre:date">Date</option>
                </optgroup>
              )}
              {filteredDimensions.length > 0 && (
                <optgroup label="Custom">
                  {filteredDimensions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}
        {datasource?.properties?.hasSettings && (
          <div className="col-auto my-1">
            <small>Activation metric</small>
            <div>
              {(experiment.activationMetric
                ? getMetricById(experiment.activationMetric)?.name
                : "") || "None"}
            </div>
          </div>
        )}
        {datasource?.properties?.experimentSegments && (
          <div className="col-auto my-1">
            <small>Segment</small>
            <div>
              {(experiment.segment
                ? getSegmentById(experiment.segment)?.name
                : "") || "None"}
            </div>
          </div>
        )}
        {supportsSql && (
          <div className="col-auto my-1">
            <small>Custom SQL filter</small>
            <div>
              {experiment.queryFilter ? (
                <code className="text-dark" title={experiment.queryFilter}>
                  {experiment.queryFilter.substr(0, 20)}...
                </code>
              ) : (
                "None"
              )}
            </div>
          </div>
        )}

        {permissions.runExperiments && datasource?.properties?.hasSettings && (
          <div className="col-auto">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(true);
              }}
            >
              <FaPencilAlt /> Edit
            </a>
          </div>
        )}

        <div style={{ flex: 1 }} />
        {permissions.runExperiments && experiment.metrics.length > 0 && (
          <div className="col-auto">
            {experiment.datasource && latest && latest.queries?.length > 0 ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  apiCall(`/experiment/${experiment.id}/snapshot`, {
                    method: "POST",
                    body: JSON.stringify({
                      phase,
                      dimension,
                    }),
                  })
                    .then(() => {
                      mutate();
                    })
                    .catch((e) => {
                      console.error(e);
                    });
                }}
              >
                {snapshot &&
                  (outdated && status !== "running" ? (
                    <div
                      className="badge badge-warning d-block"
                      style={{ marginBottom: 3 }}
                    >
                      Update Needed
                    </div>
                  ) : (
                    <div style={{ textAlign: "right" }}>
                      <small>{datetime(snapshot.dateCreated)}</small>
                    </div>
                  ))}
                <RunQueriesButton
                  cta="Update Data"
                  initialStatus={status}
                  statusEndpoint={`/snapshot/${latest.id}/status`}
                  cancelEndpoint={`/snapshot/${latest.id}/cancel`}
                  onReady={() => {
                    mutate();
                  }}
                  icon="refresh"
                  color="primary"
                />
              </form>
            ) : (
              <RefreshSnapshotButton
                mutate={mutate}
                phase={phase}
                experiment={experiment}
                lastSnapshot={snapshot}
                dimension={dimension}
              />
            )}
          </div>
        )}
      </div>
      <hr />
      {snapshot && status !== "succeeded" && (
        <div>
          <ViewAsyncQueriesButton
            queries={latest.queries.map((q) => q.query)}
            color={clsx(
              {
                danger: status === "failed",
                info: status === "running",
              },
              "btn-sm ml-3"
            )}
            display={
              status === "failed"
                ? "View Update Errors"
                : "View Running Queries"
            }
          />
        </div>
      )}
    </div>
  );
}
