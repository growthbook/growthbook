import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { FC, useEffect } from "react";
import dynamic from "next/dynamic";
import { StatsEngine } from "back-end/types/stats";
import { getValidDate, ago } from "shared/dates";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { ExperimentSnapshotInterface } from "@back-end/types/experiment-snapshot";
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
import { trackSnapshot } from "@/services/track";
import PValueGuardrailResults from "./PValueGuardrailResults";

const BreakDownResults = dynamic(
  () => import("@/components/Experiment/BreakDownResults_old")
);
const CompactResults_old = dynamic(
  () => import("@/components/Experiment/CompactResults_old")
);

const Results_old: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => void;
  editMetrics?: () => void;
  editResult?: () => void;
  editPhases?: () => void;
  alwaysShowPhaseSelector?: boolean;
  reportDetailsLink?: boolean;
  statsEngine: StatsEngine;
  regressionAdjustmentAvailable?: boolean;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentHasValidMetrics?: boolean;
  onRegressionAdjustmentChange?: (enabled: boolean) => void;
}> = ({
  experiment,
  mutateExperiment,
  editMetrics,
  editResult,
  editPhases,
  alwaysShowPhaseSelector = false,
  reportDetailsLink = true,
  statsEngine,
  regressionAdjustmentAvailable = false,
  regressionAdjustmentEnabled = false,
  regressionAdjustmentHasValidMetrics = false,
  onRegressionAdjustmentChange,
}) => {
  const { getExperimentMetricById } = useDefinitions();

  const { apiCall } = useAuth();

  // todo: move to snapshot property
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  const {
    error,
    snapshot,
    analysis,
    latest,
    phase,
    setPhase,
    setAnalysisSettings,
    dimension,
    mutateSnapshot: mutate,
  } = useSnapshot();

  useEffect(() => {
    setPhase(experiment.phases.length - 1);
  }, [experiment.phases.length, setPhase]);

  const permissions = usePermissions();
  const { getDatasourceById } = useDefinitions();

  if (error) {
    return <div className="alert alert-danger m-3">{error.message}</div>;
  }

  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const hasData =
    (analysis?.results?.[0]?.variations?.length ?? 0) > 0 &&
    (analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE) === statsEngine;

  const phaseObj = experiment.phases?.[phase];

  const phaseAgeMinutes =
    (Date.now() - getValidDate(phaseObj?.dateStarted ?? "").getTime()) /
    (1000 * 60);

  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });

  const snapshotMetricRegressionAdjustmentStatuses =
    snapshot?.settings?.metricSettings?.map((m) => ({
      metric: m.id,
      reason: m.computedSettings?.regressionAdjustmentReason || "",
      regressionAdjustmentDays:
        m.computedSettings?.regressionAdjustmentDays || 0,
      regressionAdjustmentEnabled: !!m.computedSettings
        ?.regressionAdjustmentEnabled,
      regressionAdjustmentAvailable: !!m.computedSettings
        ?.regressionAdjustmentAvailable,
    })) || [];

  return (
    <>
      <StatusBanner
        mutateExperiment={mutateExperiment}
        editResult={editResult}
      />
      <AnalysisSettingsBar
        mutateExperiment={mutateExperiment}
        setAnalysisSettings={setAnalysisSettings}
        editMetrics={editMetrics}
        variations={variations}
        editPhases={editPhases}
        alwaysShowPhaseSelector={alwaysShowPhaseSelector}
        regressionAdjustmentAvailable={regressionAdjustmentAvailable}
        regressionAdjustmentEnabled={regressionAdjustmentEnabled}
        regressionAdjustmentHasValidMetrics={
          regressionAdjustmentHasValidMetrics
        }
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
                ago(experiment.phases[phase]?.dateStarted ?? "") +
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
          results={analysis?.results?.[0]}
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
            const res = await apiCall<{
              snapshot: ExperimentSnapshotInterface;
            }>(`/experiment/${experiment.id}/snapshot`, {
              method: "POST",
              body: JSON.stringify({
                phase,
                dimension,
              }),
            });
            trackSnapshot(
              "create",
              "VariationIdWarning",
              getDatasourceById(experiment.datasource)?.type || null,
              res.snapshot
            );

            mutateExperiment();
            mutate();
          }}
          project={experiment.project}
        />
      )}
      {hasData &&
        snapshot?.dimension &&
        (snapshot.dimension.substring(0, 8) === "pre:date" ? (
          <DateResults
            metrics={experiment.metrics}
            guardrails={experiment.guardrails}
            results={analysis?.results ?? []}
            seriestype={snapshot.dimension}
            variations={variations}
            statsEngine={
              analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE
            }
          />
        ) : (
          <BreakDownResults
            key={snapshot.dimension}
            results={analysis?.results ?? []}
            variations={variations}
            metrics={experiment.metrics}
            metricOverrides={experiment.metricOverrides ?? []}
            guardrails={experiment.guardrails}
            dimensionId={snapshot.dimension}
            isLatestPhase={phase === experiment.phases.length - 1}
            startDate={phaseObj?.dateStarted ?? ""}
            reportDate={snapshot.dateCreated}
            activationMetric={experiment.activationMetric}
            status={experiment.status}
            statsEngine={analysis?.settings?.statsEngine}
            pValueCorrection={pValueCorrection}
            regressionAdjustmentEnabled={analysis?.settings?.regressionAdjusted}
            metricRegressionAdjustmentStatuses={
              snapshotMetricRegressionAdjustmentStatuses
            }
            sequentialTestingEnabled={analysis?.settings?.sequentialTesting}
          />
        ))}
      {hasData &&
        snapshot &&
        analysis &&
        analysis.results?.[0] &&
        !analysis?.settings?.dimensions?.length && (
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
            <CompactResults_old
              editMetrics={editMetrics}
              variations={variations}
              multipleExposures={snapshot.multipleExposures || 0}
              results={analysis.results[0]}
              reportDate={snapshot.dateCreated}
              startDate={phaseObj?.dateStarted ?? ""}
              isLatestPhase={phase === experiment.phases.length - 1}
              status={experiment.status}
              metrics={experiment.metrics}
              metricOverrides={experiment.metricOverrides ?? []}
              id={experiment.id}
              statsEngine={analysis.settings.statsEngine}
              pValueCorrection={pValueCorrection}
              regressionAdjustmentEnabled={
                analysis.settings?.regressionAdjusted
              }
              metricRegressionAdjustmentStatuses={
                snapshotMetricRegressionAdjustmentStatuses
              }
              sequentialTestingEnabled={analysis.settings?.sequentialTesting}
            />
            {(experiment.guardrails?.length ?? 0) > 0 && (
              <div className="mt-1 px-3">
                <h3 className="mb-3">Guardrails</h3>
                <div className="row">
                  {experiment.guardrails?.map((g) => {
                    const metric = getExperimentMetricById(g);
                    if (!metric) return "";

                    const data = analysis.results?.[0]?.variations;
                    if (!data) return "";

                    const xlargeCols =
                      experiment.guardrails?.length === 2 ? 6 : 4;
                    return (
                      <div
                        className={`col-12 col-xl-${xlargeCols} col-lg-6`}
                        key={g}
                      >
                        {analysis.settings.statsEngine === "frequentist" ? (
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
                {analysis?.settings?.statsEngine === "frequentist"
                  ? "Frequentist"
                  : "Bayesian"}
              </span>
            </div>
            {analysis?.settings?.statsEngine === "frequentist" && (
              <>
                <div>
                  <span className="text-muted">
                    <GBCuped size={13} /> CUPED:
                  </span>{" "}
                  <span>
                    {analysis?.settings?.regressionAdjusted
                      ? "Enabled"
                      : "Disabled"}
                  </span>
                </div>
                <div>
                  <span className="text-muted">
                    <GBSequential size={13} /> Sequential:
                  </span>{" "}
                  <span>
                    {analysis?.settings?.sequentialTesting
                      ? "Enabled"
                      : "Disabled"}
                  </span>
                </div>
              </>
            )}
            <div>
              <span className="text-muted">Run date:</span>{" "}
              <span>
                {getValidDate(snapshot?.dateCreated ?? "").toLocaleString([], {
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

export default Results_old;
