import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { FC, useState, useContext, useMemo } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import clsx from "clsx";
import { UserContext } from "../ProtectedPage";
import { FaPencilAlt } from "react-icons/fa";
import dynamic from "next/dynamic";
import Markdown from "../Markdown/Markdown";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";
import GuardrailResults from "./GuardrailResult";
import { getQueryStatus } from "../Queries/RunQueriesButton";
import { ago, getValidDate } from "../../services/dates";
import { useEffect } from "react";
import DateResults from "./DateResults";
import AnalysisSettingsBar from "./AnalysisSettingsBar";
import ExperimentReportsList from "./ExperimentReportsList";
import { useAuth } from "../../services/auth";

const BreakDownResults = dynamic(() => import("./BreakDownResults"));
const CompactResults = dynamic(() => import("./CompactResults"));

const Results: FC<{
  experiment: ExperimentInterfaceStringDates;
  isNew?: boolean;
  editMetrics: () => void;
  editResult: () => void;
  mutateExperiment: () => void;
}> = ({
  experiment,
  isNew = false,
  editMetrics,
  editResult,
  mutateExperiment,
}) => {
  const { dimensions, getMetricById, getDatasourceById } = useDefinitions();

  const [phase, setPhase] = useState(experiment.phases.length - 1);
  const [dimension, setDimension] = useState("");

  useEffect(() => {
    setPhase(experiment.phases.length - 1);
  }, [experiment.phases.length]);

  const { permissions } = useContext(UserContext);
  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    latest?: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment.id}/snapshot/${phase}` +
      (dimension ? "/" + dimension : "")
  );

  const showReports = useMemo(() => {
    if (!experiment.datasource) return false;
    return true;
  }, [experiment]);

  if (error) {
    return <div className="alert alert-danger m-3">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const snapshot = data.snapshot;
  const latest = data.latest;

  const result = experiment.results;

  const refreshResults = () => {
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
  };
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

  const phaseObj = experiment.phases?.[phase];

  const phaseAgeMinutes =
    (Date.now() - getValidDate(phaseObj?.dateStarted).getTime()) / (1000 * 60);

  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });

  if (
    experiment.datasource &&
    isNew &&
    !latest &&
    !experiment.lastSnapshotAttempt &&
    experiment.metrics.length > 0
  ) {
    // this new experiment has never been run, so run it:
    refreshResults();
  }

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
        editMetrics={editMetrics}
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
          <DateResults
            metrics={experiment.metrics}
            guardrails={experiment.guardrails}
            results={snapshot.results}
            variations={variations}
          />
        ) : (
          <BreakDownResults
            isLatestPhase={phase === experiment.phases.length - 1}
            metrics={experiment.metrics}
            reportDate={snapshot.dateCreated}
            results={snapshot.results || []}
            status={experiment.status}
            startDate={phaseObj?.dateStarted}
            dimensionId={snapshot.dimension}
            activationMetric={experiment.activationMetric}
            guardrails={experiment.guardrails}
            variations={variations}
            key={snapshot.dimension}
          />
        ))}
      {hasData && !snapshot.dimension && (
        <>
          <CompactResults
            id={experiment.id}
            isLatestPhase={phase === experiment.phases.length - 1}
            metrics={experiment.metrics}
            reportDate={snapshot.dateCreated}
            results={snapshot.results?.[0]}
            status={experiment.status}
            startDate={phaseObj?.dateStarted}
            unknownVariations={snapshot.unknownVariations || []}
            multipleExposures={snapshot.multipleExposures || 0}
            variations={variations}
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

                  const data = snapshot.results[0]?.variations;
                  if (!data) return "";

                  const xlargeCols = experiment.guardrails.length === 2 ? 6 : 4;
                  return (
                    <div
                      className={`col-12 col-xl-${xlargeCols} col-lg-6 mb-3`}
                      key={g}
                    >
                      <GuardrailResults
                        data={data}
                        variations={variations}
                        metric={metric}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {showReports && (
            <div className="p-3">
              <ExperimentReportsList
                experiment={experiment}
                snapshot={snapshot}
              />
            </div>
          )}
        </>
      )}
      <div className="px-3 mb-3">
        <span className="text-muted">
          Click the 3 dots next to the Update button above to configure this
          report, download as a Jupyter notebook, and more.
        </span>
      </div>
    </>
  );
};

export default Results;
