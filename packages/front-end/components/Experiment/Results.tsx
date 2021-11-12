import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FC, useState, useContext } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import clsx from "clsx";
import { UserContext } from "../ProtectedPage";
import ViewQueryButton from "../Metrics/ViewQueryButton";
import { FaFileDownload, FaPencilAlt } from "react-icons/fa";
import dynamic from "next/dynamic";
import Markdown from "../Markdown/Markdown";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";
import GuardrailResults from "./GuardrailResult";
import ViewAsyncQueriesButton from "../Queries/ViewAsyncQueriesButton";
import { getQueryStatus } from "../Queries/RunQueriesButton";
import { useAuth } from "../../services/auth";
import { ago, getValidDate } from "../../services/dates";
import Button from "../Button";
import { useEffect } from "react";
import DateResults from "./DateResults";
import AnalysisSettingsBar from "./AnalysisSettingsBar";

const BreakDownResults = dynamic(() => import("./BreakDownResults"));
const CompactResults = dynamic(() => import("./CompactResults"));

const Results: FC<{
  experiment: ExperimentInterfaceStringDates;
  editMetrics: () => void;
  editResult: () => void;
  mutateExperiment: () => void;
}> = ({ experiment, editMetrics, editResult, mutateExperiment }) => {
  const { dimensions, getMetricById, getDatasourceById } = useDefinitions();

  const { apiCall } = useAuth();

  const [phase, setPhase] = useState(experiment.phases.length - 1);
  const [dimension, setDimension] = useState("");

  useEffect(() => {
    setPhase(experiment.phases.length - 1);
  }, [experiment.phases.length]);

  const { permissions } = useContext(UserContext);

  const { data, error, mutate } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    latest?: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment.id}/snapshot/${phase}` +
      (dimension ? "/" + dimension : "")
  );

  if (error) {
    return <div className="alert alert-danger m-3">{error.message}</div>;
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

  const status = getQueryStatus(latest?.queries || [], latest?.error);

  const hasData = snapshot?.results?.[0]?.variations?.length > 0;

  const phaseAgeMinutes =
    (Date.now() -
      getValidDate(experiment.phases?.[phase]?.dateStarted).getTime()) /
    (1000 * 60);

  return (
    <>
      {experiment.status === "stopped" && (
        <div
          className={clsx("alert mb-0", {
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
      <AnalysisSettingsBar
        experiment={experiment}
        snapshot={snapshot}
        dimension={dimension}
        mutate={mutate}
        mutateExperiment={mutateExperiment}
        phase={phase}
        setDimension={setDimension}
        setPhase={setPhase}
        latest={latest}
      />
      {experiment.metrics.length === 0 && (
        <div className="alert alert-info m-3">
          Add at least 1 metric to view results.
        </div>
      )}
      {!hasData && status !== "running" && experiment.metrics.length > 0 && (
        <div className="alert alert-info m-3">
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
      {hasData &&
        snapshot.dimension &&
        (snapshot.dimension === "pre:date" ? (
          <DateResults snapshot={snapshot} experiment={experiment} />
        ) : (
          <BreakDownResults
            snapshot={snapshot}
            experiment={experiment}
            key={snapshot.dimension}
          />
        ))}
      {hasData && !snapshot.dimension && (
        <>
          <CompactResults
            snapshot={snapshot}
            experiment={experiment}
            phase={experiment.phases?.[phase]}
            isUpdating={status === "running"}
            editMetrics={editMetrics}
          />
          {experiment.guardrails?.length > 0 && (
            <div className="mb-3 p-3">
              <h3 className="mb-3">
                Guardrails
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
                    Add/Remove Guardrails
                  </a>
                )}
              </h3>
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
      <div className="px-3">
        <div className="row mb-3">
          {permissions.runExperiments && editMetrics && (
            <div className="col-auto">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  editMetrics();
                }}
              >
                Add{experiment.metrics?.length > 0 ? "/Remove" : ""} Metrics
              </button>
            </div>
          )}
          {snapshot &&
            hasData &&
            snapshot.hasRawQueries &&
            "skipPartialData" in snapshot &&
            datasource?.settings?.notebookRunQuery && (
              <div className="col-auto">
                <Button
                  color="outline-info"
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
                  <FaFileDownload /> Download Notebook
                </Button>
              </div>
            )}

          {snapshot && (
            <div className="col-auto">
              {snapshot.queries?.length > 0 ? (
                <ViewAsyncQueriesButton
                  queries={snapshot.queries.map((q) => q.query)}
                  error={snapshot.error}
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
          )}
        </div>
      </div>
    </>
  );
};

export default Results;
