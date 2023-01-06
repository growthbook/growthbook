import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import clsx from "clsx";
import { useState } from "react";
import { ExperimentReportVariation } from "back-end/types/report";
import { useAuth } from "@/services/auth";
import { ago, datetime } from "@/services/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import RunQueriesButton, { getQueryStatus } from "../Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "../Queries/ViewAsyncQueriesButton";
import DimensionChooser from "../Dimensions/DimensionChooser";
import AnalysisForm from "./AnalysisForm";
import RefreshSnapshotButton from "./RefreshSnapshotButton";
import ResultMoreMenu from "./ResultMoreMenu";
import PhaseSelector from "./PhaseSelector";
import { useSnapshot } from "./SnapshotProvider";

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
  mutateExperiment,
  editMetrics,
  editPhases,
  variations,
  alwaysShowPhaseSelector = false,
}: {
  mutateExperiment: () => void;
  editMetrics?: () => void;
  editPhases?: () => void;
  variations: ExperimentReportVariation[];
  alwaysShowPhaseSelector?: boolean;
}) {
  const {
    experiment,
    snapshot,
    latest,
    dimension,
    mutateSnapshot: mutate,
    phase,
    setDimension,
  } = useSnapshot();

  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);
  const outdated = isOutdated(experiment, snapshot);
  const [modalOpen, setModalOpen] = useState(false);

  const permissions = usePermissions();

  const { apiCall } = useAuth();

  const status = getQueryStatus(latest?.queries || [], latest?.error);

  const hasData = snapshot?.results?.[0]?.variations?.length > 0;

  const [refreshError, setRefreshError] = useState("");

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
        {experiment.phases &&
          (alwaysShowPhaseSelector || experiment.phases.length > 1) && (
            <div className="col-auto form-inline">
              <PhaseSelector
                mutateExperiment={mutateExperiment}
                editPhases={editPhases}
              />
            </div>
          )}
        <div className="col-auto form-inline">
          <DimensionChooser
            value={dimension}
            setValue={setDimension}
            activationMetric={!!experiment.activationMetric}
            datasourceId={experiment.datasource}
            exposureQueryId={experiment.exposureQueryId}
            userIdType={experiment.userIdType}
            labelClassName="mr-2"
          />
        </div>
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
        {permissions.check("runQueries", "") && experiment.metrics.length > 0 && (
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
                      setRefreshError("");
                    })
                    .catch((e) => {
                      setRefreshError(e.message);
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
        <div className="col-auto">
          <ResultMoreMenu
            id={snapshot?.id || ""}
            forceRefresh={async () => {
              await apiCall(
                `/experiment/${experiment.id}/snapshot?force=true`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    phase,
                    dimension,
                  }),
                }
              )
                .then(() => {
                  mutate();
                })
                .catch((e) => {
                  console.error(e);
                });
            }}
            configure={() => setModalOpen(true)}
            editMetrics={editMetrics}
            notebookUrl={`/experiments/notebook/${snapshot?.id}`}
            notebookFilename={experiment.trackingKey}
            generateReport={true}
            queries={snapshot?.queries}
            queryError={snapshot?.error}
            hasUserQuery={snapshot && !("skipPartialData" in snapshot)}
            supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
            hasData={hasData}
            metrics={experiment.metrics}
            results={snapshot?.results}
            variations={variations}
            trackingKey={experiment.trackingKey}
            dimension={dimension}
            project={experiment.project}
          />
        </div>
      </div>
      {permissions.check("runQueries", "") && datasource && (
        <div className="px-3">
          {refreshError && (
            <div className="alert alert-danger">
              <strong>Error updating data: </strong> {refreshError}
            </div>
          )}
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
          </div>
        </div>
      )}
    </div>
  );
}
