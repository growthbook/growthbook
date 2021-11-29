import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useContext } from "react";
import { FaCog } from "react-icons/fa";
import { useAuth } from "../../services/auth";
import { ago, datetime } from "../../services/dates";
import { useDefinitions } from "../../services/DefinitionsContext";
import { phaseSummaryText } from "../../services/utils";
import Field from "../Forms/Field";
import { UserContext } from "../ProtectedPage";
import RunQueriesButton, { getQueryStatus } from "../Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "../Queries/ViewAsyncQueriesButton";
import AnalysisForm from "./AnalysisForm";
import RefreshSnapshotButton from "./RefreshSnapshotButton";

function isDifferent(val1?: string | boolean, val2?: string | boolean) {
  if (!val1 && !val2) return false;
  return val1 !== val2;
}

function isOutdated(
  experiment: ExperimentInterfaceStringDates,
  snapshot: ExperimentSnapshotInterface
) {
  if (!snapshot) return false;
  if (isDifferent(experiment.activationMetric, snapshot.activationMetric)) {
    return true;
  }
  if (isDifferent(experiment.segment, snapshot.segment)) {
    return true;
  }
  if (isDifferent(experiment.queryFilter, snapshot.queryFilter)) {
    return true;
  }
  if (experiment.datasource && !("skipPartialData" in snapshot)) {
    return true;
  }
  if (isDifferent(experiment.skipPartialData, snapshot.skipPartialData)) {
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
  const { getDatasourceById, dimensions } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);
  const supportsSql = datasource?.properties?.queryLanguage === "sql";
  const outdated = isOutdated(experiment, snapshot);
  const [modalOpen, setModalOpen] = useState(false);

  // If an experiment doesn't have an activation metric, don't allow selecting it
  useEffect(() => {
    if (dimension === "pre:activation" && !experiment.activationMetric) {
      setDimension("");
    }
  }, [dimension, experiment.activationMetric]);

  const { permissions } = useContext(UserContext);

  const { apiCall } = useAuth();

  const filteredDimensions = dimensions
    .filter((d) => d.datasource === experiment.datasource)
    .map((d) => {
      return {
        display: d.name,
        value: d.id,
      };
    });

  if (datasource?.settings?.experimentDimensions?.length > 0) {
    datasource.settings.experimentDimensions.forEach((d) => {
      filteredDimensions.push({
        display: d,
        value: "exp:" + d,
      });
    });
  }

  const status = getQueryStatus(latest?.queries || [], latest?.error);

  return (
    <div>
      {modalOpen && (
        <AnalysisForm
          cancel={() => setModalOpen(false)}
          experiment={experiment}
          mutate={mutateExperiment}
          phase={phase}
        />
      )}
      <div className="row align-items-center p-3">
        {experiment.phases && experiment.phases.length > 1 && (
          <div className="col-auto form-inline">
            <Field
              label="Phase"
              labelClassName="mr-2"
              value={phase}
              onChange={(e) => {
                setPhase(parseInt(e.target.value));
              }}
              options={experiment.phases.map((phase, i) => ({
                display: `${i + 1}: ${phaseSummaryText(phase)}`,
                value: i,
              }))}
            />
          </div>
        )}
        {(filteredDimensions.length > 0 || supportsSql) && (
          <div className="col-auto form-inline">
            <label className="mr-2">Dimension</label>{" "}
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
                  {datasource?.properties?.activationDimension &&
                    experiment.activationMetric && (
                      <option value="pre:activation">Activation Status</option>
                    )}
                </optgroup>
              )}
              {filteredDimensions.length > 0 && (
                <optgroup label="Custom">
                  {filteredDimensions.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.display}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          {snapshot &&
            (outdated && status !== "running" ? (
              <div
                className="badge badge-warning d-block py-1"
                style={{ marginBottom: 3 }}
              >
                Out of Date
              </div>
            ) : (
              <div
                className="text-muted"
                style={{ fontSize: "0.8em" }}
                title={datetime(snapshot.dateCreated)}
              >
                last updated {ago(snapshot.dateCreated)}
              </div>
            ))}
        </div>
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
                <RunQueriesButton
                  cta="Update Data"
                  initialStatus={status}
                  statusEndpoint={`/snapshot/${latest.id}/status`}
                  cancelEndpoint={`/snapshot/${latest.id}/cancel`}
                  onReady={() => {
                    mutate();
                  }}
                  icon="refresh"
                  color="outline-primary"
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
      {permissions.runExperiments && datasource && (
        <div className="px-3">
          <div className="row">
            {latest && status !== "succeeded" && (
              <div className="col-auto pb-3">
                <ViewAsyncQueriesButton
                  queries={latest.queries.map((q) => q.query)}
                  error={latest.error}
                  color={clsx(
                    {
                      danger: status === "failed",
                      info: status === "running",
                    },
                    " "
                  )}
                  display={
                    status === "failed"
                      ? "View Update Errors"
                      : "View Running Queries"
                  }
                />
              </div>
            )}
            <div style={{ flex: 1 }} />
            <div className="col-auto">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setModalOpen(true);
                }}
              >
                <FaCog /> Configure Analysis
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
