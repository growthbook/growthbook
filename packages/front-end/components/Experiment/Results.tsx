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
import GuardrailResults from "./GuardrailResult";
import ViewAsyncQueriesButton from "../Queries/ViewAsyncQueriesButton";
import RunQueriesButton, { getQueryStatus } from "../Queries/RunQueriesButton";
import { useAuth } from "../../services/auth";
import { ago, datetime } from "../../services/dates";
import Button from "../Button";

const BreakDownResults = dynamic(() => import("./BreakDownResults"));
const CompactResults = dynamic(() => import("./CompactResults"));

const Results: FC<{
  experiment: ExperimentInterfaceStringDates;
  editMetrics: () => void;
  editResult: () => void;
}> = ({ experiment, editMetrics, editResult }) => {
  const { dimensions, getMetricById, getDatasourceById } = useDefinitions();

  const { apiCall } = useAuth();

  const [phase, setPhase] = useState(experiment.phases.length - 1);
  const [dimension, setDimension] = useState("");

  const { permissions } = useContext(UserContext);

  const { data, error, mutate } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    latest?: ExperimentSnapshotInterface;
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
  const latest = data.latest;

  const result = experiment.results;

  const variationsPlural =
    experiment.variations.length > 2 ? "variations" : "variation";

  const filteredDimensions: { id: string; name: string }[] = dimensions.filter(
    (d) => d.datasource === experiment.datasource
  );

  const datasource = getDatasourceById(experiment.datasource);
  if (datasource?.settings?.experimentDimensions?.length > 0) {
    datasource.settings.experimentDimensions.forEach((d) => {
      filteredDimensions.push({
        id: "exp:" + d,
        name: d,
      });
    });
  }

  const status = getQueryStatus(latest?.queries || []);

  const hasData = snapshot?.results?.[0]?.variations?.length > 0;

  const phaseAgeMinutes =
    (Date.now() -
      new Date(experiment.phases?.[phase]?.dateStarted || 0).getTime()) /
    (1000 * 60);

  return (
    <>
      {experiment.status === "stopped" && (
        <div
          className={clsx("alert", {
            "alert-success": result === "won",
            "alert-danger": result === "lost",
            "alert-info": !result || result === "inconclusive",
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
            {!result &&
              `The experiment was stopped, but a winner has not been selected yet.`}
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
        {snapshot && (
          <div
            className="col-auto text-muted font-italic"
            style={{ paddingTop: 6 }}
            title={datetime(snapshot.dateCreated)}
          >
            <small>last updated {ago(snapshot.dateCreated)}</small>
          </div>
        )}
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
      {status === "failed" && (
        <div className="alert alert-danger">
          The most recent update ({ago(latest.dateCreated)}) failed.
          <ViewAsyncQueriesButton
            queries={latest.queries.map((q) => q.query)}
            color="danger btn-sm ml-3"
          />
        </div>
      )}
      {status === "running" && (
        <div className="alert alert-info">
          Results are being updated now.
          {snapshot && (
            <>
              The data below is from the previous run (
              {ago(snapshot.dateCreated)}).
            </>
          )}
          <ViewAsyncQueriesButton
            queries={latest.queries.map((q) => q.query)}
            color="info btn-sm ml-3"
            display="View Running Queries"
          />
        </div>
      )}
      {experiment.metrics.length === 0 && (
        <div className="alert alert-info">
          Add at least 1 metric to view results.
        </div>
      )}
      {!hasData && experiment.metrics.length > 0 && (
        <div className="alert alert-info">
          No data yet.{" "}
          {snapshot &&
            phaseAgeMinutes >= 120 &&
            "Make sure your experiment is tracking properly."}
          {snapshot &&
            phaseAgeMinutes < 120 &&
            "It was just started " +
              ago(experiment.phases[phase].dateStarted) +
              ". Give it a little longer and click the 'Update' button above to check again."}
          {!snapshot &&
            permissions.runExperiments &&
            `Click the "Update" button above.`}
        </div>
      )}
      {hasData && snapshot.dimension && (
        <BreakDownResults snapshot={snapshot} experiment={experiment} />
      )}
      {hasData && !snapshot.dimension && (
        <>
          <CompactResults
            snapshot={snapshot}
            experiment={experiment}
            phase={experiment.phases?.[phase]}
          />
          {experiment.guardrails?.length > 0 && (
            <div className="mb-3">
              <hr />
              <h2 className="mt-4">Guardrails</h2>
              <div className="row mt-3">
                {experiment.guardrails.map((g) => {
                  const metric = getMetricById(g);
                  if (!metric) return "";

                  const variations = snapshot.results[0]?.variations;
                  if (!variations) return "";

                  return (
                    <div className="col-12 col-xl-4 col-lg-6 mb-3" key={g}>
                      <GuardrailResults
                        experiment={experiment}
                        variations={variations}
                        metric={metric}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      {snapshot && (
        <div className="row">
          {permissions.runExperiments && editMetrics && (
            <div className="col-auto">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  editMetrics();
                }}
              >
                Add/Remove Metrics
              </button>
            </div>
          )}

          <div className="col-auto">
            {snapshot.queries?.length > 0 ? (
              <ViewAsyncQueriesButton
                queries={snapshot.queries.map((q) => q.query)}
              />
            ) : (
              // From old query engine
              snapshot.query && (
                <ViewQueryButton
                  queries={[snapshot.query]}
                  language={snapshot.queryLanguage}
                />
              )
            )}
          </div>
          {!snapshot.dimension &&
            snapshot.hasRawQueries &&
            datasource?.settings?.notebookRunQuery && (
              <div className="col-auto">
                <Button
                  color="outline-primary"
                  onClick={async () => {
                    const res = await apiCall<{ notebook: string }>(
                      `/experiments/notebook/${snapshot.id}`,
                      {
                        method: "POST",
                      }
                    );

                    const url = URL.createObjectURL(
                      new Blob([res.notebook], {
                        type: "application/json",
                      })
                    );

                    const name = experiment.trackingKey
                      .replace(/[^a-zA-Z0-9_-]+/g, "")
                      .replace(/[-]+/g, "_")
                      .replace(/[_]{2,}/g, "_");

                    const d = new Date()
                      .toISOString()
                      .slice(0, 10)
                      .replace(/-/g, "_");

                    const el = document.createElement("a");
                    el.href = url;
                    el.download = `${name}_${d}.ipynb`;
                    el.click();
                  }}
                >
                  Download Notebook
                </Button>
              </div>
            )}
        </div>
      )}
    </>
  );
};

export default Results;
