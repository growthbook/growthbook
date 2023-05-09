import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { FC, useEffect } from "react";
import dynamic from "next/dynamic";
import { StatsEngine } from "back-end/types/stats";
import { MetricRegressionAdjustmentStatus } from "back-end/types/report";
import { getValidDate, ago, DEFAULT_STATS_ENGINE } from "shared";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import FilterSummary from "@/components/Experiment/FilterSummary";
import DateResults from "@/components/Experiment/DateResults";
import VariationIdWarning from "@/components/Experiment/VariationIdWarning";
import AnalysisSettingsBar from "@/components/Experiment/AnalysisSettingsBar";
import GuardrailResults from "@/components/Experiment/GuardrailResult";
import StatusBanner from "@/components/Experiment/StatusBanner";
import { GBCuped, GBSequential } from "@/components/Icons";
import useOrgSettings from "@/hooks/useOrgSettings";
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
  statsEngine?: StatsEngine;
  regressionAdjustmentAvailable?: boolean;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentHasValidMetrics?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  onRegressionAdjustmentChange?: (enabled: boolean) => void;
}> = ({
  experiment,
  editMetrics,
  editResult,
  editPhases,
  mutateExperiment,
  alwaysShowPhaseSelector = false,
  reportDetailsLink = true,
  statsEngine,
  regressionAdjustmentAvailable = false,
  regressionAdjustmentEnabled = false,
  regressionAdjustmentHasValidMetrics = false,
  metricRegressionAdjustmentStatuses,
  onRegressionAdjustmentChange,
}) => {
  const { getMetricById } = useDefinitions();

  const { apiCall } = useAuth();

  // todo: move to snapshot property
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

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
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    snapshot?.results?.[0]?.variations?.length > 0 &&
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    (snapshot.statsEngine || DEFAULT_STATS_ENGINE) === statsEngine;

  const phaseObj = experiment.phases?.[phase];

  const phaseAgeMinutes =
    // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
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
      {/* @ts-expect-error TS(2786) If you come across this, please fix it!: 'StatusBanner' cannot be used as a JSX component. */}
      <StatusBanner
        mutateExperiment={mutateExperiment}
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '(() => void) | undefined' is not assignable ... Remove this comment to see the full error message
        editResult={editResult}
      />
      <AnalysisSettingsBar
        mutateExperiment={mutateExperiment}
        editMetrics={editMetrics}
        variations={variations}
        editPhases={editPhases}
        alwaysShowPhaseSelector={alwaysShowPhaseSelector}
        statsEngine={statsEngine}
        regressionAdjustmentAvailable={regressionAdjustmentAvailable}
        regressionAdjustmentEnabled={regressionAdjustmentEnabled}
        regressionAdjustmentHasValidMetrics={
          regressionAdjustmentHasValidMetrics
        }
        metricRegressionAdjustmentStatuses={metricRegressionAdjustmentStatuses}
        onRegressionAdjustmentChange={onRegressionAdjustmentChange}
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
                // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
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
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'ExperimentReportResultDimension | undefined'... Remove this comment to see the full error message
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
        // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
        snapshot.dimension &&
        // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
        (snapshot.dimension === "pre:date" ? (
          <DateResults
            metrics={experiment.metrics}
            guardrails={experiment.guardrails}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'ExperimentReportResultDimension[] | undefine... Remove this comment to see the full error message
            results={snapshot.results}
            variations={variations}
          />
        ) : (
          <BreakDownResults
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            key={snapshot.dimension}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            results={snapshot.results || []}
            variations={variations}
            metrics={experiment.metrics}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'MetricOverride[] | undefined' is not assigna... Remove this comment to see the full error message
            metricOverrides={experiment.metricOverrides}
            guardrails={experiment.guardrails}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            dimensionId={snapshot.dimension}
            isLatestPhase={phase === experiment.phases.length - 1}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
            startDate={phaseObj?.dateStarted}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            reportDate={snapshot.dateCreated}
            activationMetric={experiment.activationMetric}
            status={experiment.status}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            statsEngine={snapshot.statsEngine}
            pValueCorrection={pValueCorrection}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            regressionAdjustmentEnabled={snapshot.regressionAdjustmentEnabled}
            metricRegressionAdjustmentStatuses={
              // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
              snapshot.metricRegressionAdjustmentStatuses
            }
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            sequentialTestingEnabled={snapshot.sequentialTestingEnabled}
          />
        ))}
      {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
      {hasData && !snapshot.dimension && (
        <>
          {reportDetailsLink && (
            <div className="float-right pr-3">
              <FilterSummary
                experiment={experiment}
                phase={phaseObj}
                // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'ExperimentSnapshotInterface | undefined' is ... Remove this comment to see the full error message
                snapshot={snapshot}
              />
            </div>
          )}
          <CompactResults
            editMetrics={editMetrics}
            variations={variations}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            multipleExposures={snapshot.multipleExposures || 0}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'ExperimentReportResultDimension | undefined'... Remove this comment to see the full error message
            results={snapshot.results?.[0]}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            reportDate={snapshot.dateCreated}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
            startDate={phaseObj?.dateStarted}
            isLatestPhase={phase === experiment.phases.length - 1}
            status={experiment.status}
            metrics={experiment.metrics}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'MetricOverride[] | undefined' is not assigna... Remove this comment to see the full error message
            metricOverrides={experiment.metricOverrides}
            id={experiment.id}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            statsEngine={snapshot.statsEngine}
            pValueCorrection={pValueCorrection}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            regressionAdjustmentEnabled={snapshot.regressionAdjustmentEnabled}
            metricRegressionAdjustmentStatuses={
              // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
              snapshot.metricRegressionAdjustmentStatuses
            }
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            sequentialTestingEnabled={snapshot.sequentialTestingEnabled}
          />
          {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
          {experiment.guardrails?.length > 0 && (
            <div className="mt-1 px-3">
              <h3 className="mb-3">Guardrails</h3>
              <div className="row">
                {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
                {experiment.guardrails.map((g) => {
                  const metric = getMetricById(g);
                  if (!metric) return "";

                  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                  const data = snapshot.results[0]?.variations;
                  if (!data) return "";

                  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                  const xlargeCols = experiment.guardrails.length === 2 ? 6 : 4;
                  return (
                    <div
                      className={`col-12 col-xl-${xlargeCols} col-lg-6`}
                      key={g}
                    >
                      {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
                      {snapshot.statsEngine === "frequentist" ? (
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
      {hasData && (
        <div className="row align-items-center mx-2 my-3">
          <div className="col-auto small" style={{ lineHeight: 1.2 }}>
            <div className="text-muted mb-1">
              The above results were computed with:
            </div>
            <div>
              <span className="text-muted">Engine:</span>{" "}
              <span>
                {snapshot?.statsEngine === "frequentist"
                  ? "Frequentist"
                  : "Bayesian"}
              </span>
            </div>
            {snapshot?.statsEngine === "frequentist" && (
              <>
                <div>
                  <span className="text-muted">
                    <GBCuped size={13} /> CUPED:
                  </span>{" "}
                  <span>
                    {snapshot?.regressionAdjustmentEnabled
                      ? "Enabled"
                      : "Disabled"}
                  </span>
                </div>
                <div>
                  <span className="text-muted">
                    <GBSequential size={13} /> Sequential:
                  </span>{" "}
                  <span>
                    {snapshot?.sequentialTestingEnabled
                      ? "Enabled"
                      : "Disabled"}
                  </span>
                </div>
              </>
            )}
            <div>
              <span className="text-muted">Run date:</span>{" "}
              <span>
                {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
                {getValidDate(snapshot.dateCreated).toLocaleString([], {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>
          <div style={{ flex: "1 1 0%" }}></div>
          <div className="col-4 small text-muted" style={{ lineHeight: 1.2 }}>
            {permissions.check("createAnalyses", experiment.project) &&
              experiment.metrics?.length > 0 && (
                <>
                  Click the 3 dots next to the Update button above to configure
                  this report, download as a Jupyter notebook, and more.
                </>
              )}
          </div>
        </div>
      )}
    </>
  );
};

export default Results;
