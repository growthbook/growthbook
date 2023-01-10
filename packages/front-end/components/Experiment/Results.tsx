import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { FC, useEffect } from "react";
import dynamic from "next/dynamic";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ago, getValidDate } from "@/services/dates";
import usePermissions from "@/hooks/usePermissions";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import FilterSummary from "@/components/Experiment/FilterSummary";
import DateResults from "@/components/Experiment/DateResults";
import VariationIdWarning from "@/components/Experiment/VariationIdWarning";
import AnalysisSettingsBar from "@/components/Experiment/AnalysisSettingsBar";
import GuardrailResults from "@/components/Experiment/GuardrailResult";
import StatusBanner from "@/components/Experiment/StatusBanner";
import PValueGuardrailResults from "./PValueGuardrailResults";

const BreakDownResults = dynamic(
  () => import("@/components/Experiment/BreakDownResults")
);
const CompactResults = dynamic(
  () => import("@/components/Experiment/CompactResults")
);

const Results: FC<{
  experiment: ExperimentInterfaceStringDates;
  editMetrics?: () => void;
  editResult?: () => void;
  editPhases?: () => void;
  mutateExperiment: () => void;
  alwaysShowPhaseSelector?: boolean;
  reportDetailsLink?: boolean;
}> = ({
  experiment,
  editMetrics,
  editResult,
  editPhases,
  mutateExperiment,
  alwaysShowPhaseSelector = false,
  reportDetailsLink = true,
}) => {
  const { getMetricById } = useDefinitions();
  const settings = useOrgSettings();

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

  const status = getQueryStatus(latest?.queries || [], latest?.error);

  const hasData =
    snapshot?.results?.[0]?.variations?.length > 0 &&
    snapshot.statsEngine === settings.statsEngine;

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
      <StatusBanner
        mutateExperiment={mutateExperiment}
        editResult={editResult}
      />
      <AnalysisSettingsBar
        mutateExperiment={mutateExperiment}
        editMetrics={editMetrics}
        variations={variations}
        editPhases={editPhases}
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
                ago(experiment.phases[phase]?.dateStarted) +
                ". Give it a little longer and click the 'Update' button above to check again."}
            {!snapshot &&
              permissions.check("runQueries", "") &&
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
          project={experiment.project}
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
            metricOverrides={experiment.metricOverrides}
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
          {reportDetailsLink && (
            <div className="float-right pr-3">
              <FilterSummary
                experiment={experiment}
                phase={phaseObj}
                snapshot={snapshot}
              />
            </div>
          )}
          <CompactResults
            id={experiment.id}
            isLatestPhase={phase === experiment.phases.length - 1}
            metrics={experiment.metrics}
            metricOverrides={experiment.metricOverrides}
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
                      {settings.statsEngine === "frequentist" ? (
                        <PValueGuardrailResults
                          data={data}
                          variations={variations}
                          metric={metric}
                        />
                      ) : (
                        <GuardrailResults
                          data={data}
                          variations={variations}
                          metric={metric}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      {permissions.check("createAnalyses", experiment.project) &&
        experiment.metrics?.length > 0 && (
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
