import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { FC } from "react";
import clsx from "clsx";
import { FaPencilAlt } from "react-icons/fa";
import dynamic from "next/dynamic";
import Markdown from "../Markdown/Markdown";
import { useDefinitions } from "../../services/DefinitionsContext";
import GuardrailResults from "./GuardrailResult";
import { getQueryStatus } from "../Queries/RunQueriesButton";
import { ago, getValidDate } from "../../services/dates";
import { useEffect } from "react";
import DateResults from "./DateResults";
import AnalysisSettingsBar from "./AnalysisSettingsBar";
import usePermissions from "../../hooks/usePermissions";
import { useAuth } from "../../services/auth";
import FilterSummary from "./FilterSummary";
import VariationIdWarning from "./VariationIdWarning";
import { useSnapshot } from "./SnapshotProvider";

const BreakDownResults = dynamic(() => import("./BreakDownResults"));
const CompactResults = dynamic(() => import("./CompactResults"));

const Results: FC<{
  experiment: ExperimentInterfaceStringDates;
  editMetrics?: () => void;
  editResult?: () => void;
  mutateExperiment: () => void;
  alwaysShowPhaseSelector?: boolean;
}> = ({
  experiment,
  editMetrics,
  editResult,
  mutateExperiment,
  alwaysShowPhaseSelector = false,
}) => {
  const { getMetricById } = useDefinitions();

  const { apiCall } = useAuth();

  const {
    error,
    snapshot,
    latest,
    phase,
    setPhase,
    dimension,
    mutateSnapshot: mutate,
  } = useSnapshot();

  useEffect(() => {
    setPhase(experiment.phases.length - 1);
  }, [experiment.phases.length]);

  const permissions = usePermissions();

  if (error) {
    return <div className="alert alert-danger m-3">{error.message}</div>;
  }

  const result = experiment.results;

  const variationsPlural =
    experiment.variations.length > 2 ? "variations" : "variation";

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
          {editResult && (
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
        mutateExperiment={mutateExperiment}
        editMetrics={editMetrics}
        variations={variations}
        alwaysShowPhaseSelector={alwaysShowPhaseSelector}
      />
      {experiment.metrics.length === 0 && (
        <div className="alert alert-info m-3">
          Add at least 1 metric to view results.{" "}
          {editMetrics && (
            <button
              className="btn btn-primary btn-sm ml-3"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                editMetrics();
              }}
            >
              Add Metrics
            </button>
          )}
        </div>
      )}
      {!hasData &&
        !snapshot?.unknownVariations?.length &&
        status !== "running" &&
        experiment.metrics.length > 0 && (
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
              permissions.runQueries &&
              `Click the "Update" button above.`}
          </div>
        )}
      {snapshot && !snapshot.dimension && (
        <VariationIdWarning
          unknownVariations={snapshot.unknownVariations || []}
          isUpdating={status === "running"}
          results={snapshot.results?.[0]}
          variations={variations}
          setVariationIds={async (ids) => {
            // Don't do anything if the query is currently running
            if (status === "running") {
              throw new Error("Cancel running query first");
            }

            // Update variation ids
            await apiCall(`/experiment/${experiment.id}`, {
              method: "POST",
              body: JSON.stringify({
                variations: experiment.variations.map((v, i) => {
                  return {
                    ...v,
                    key: ids[i] ?? v.key,
                  };
                }),
              }),
            });

            // Fetch results again
            await apiCall(`/experiment/${experiment.id}/snapshot`, {
              method: "POST",
              body: JSON.stringify({
                phase,
                dimension,
              }),
            });

            mutateExperiment();
            mutate();
          }}
        />
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
          <div className="float-right pr-3">
            <FilterSummary
              experiment={experiment}
              phase={phaseObj}
              snapshot={snapshot}
            />
          </div>
          <CompactResults
            id={experiment.id}
            isLatestPhase={phase === experiment.phases.length - 1}
            metrics={experiment.metrics}
            reportDate={snapshot.dateCreated}
            results={snapshot.results?.[0]}
            status={experiment.status}
            startDate={phaseObj?.dateStarted}
            multipleExposures={snapshot.multipleExposures || 0}
            variations={variations}
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
                    Adjust Guardrails
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
        </>
      )}
      {permissions.createAnalyses && (
        <div className="px-3 mb-3">
          <span className="text-muted">
            Click the 3 dots next to the Update button above to configure this
            report, download as a Jupyter notebook, and more.
          </span>
        </div>
      )}
    </>
  );
};

export default Results;
