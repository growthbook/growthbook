import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import {
  ExperimentSnapshotReportInterface,
  MetricSnapshotSettings,
} from "back-end/types/report";
import { getSnapshotAnalysis } from "shared/util";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { getValidDate } from "shared/dates";
import React, { RefObject } from "react";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/components/Radix/Callout";
import DateResults from "@/components/Experiment/DateResults";
import BreakDownResults from "@/components/Experiment/BreakDownResults";
import CompactResults from "@/components/Experiment/CompactResults";
import ReportAnalysisSettingsBar from "@/components/Report/ReportAnalysisSettingsBar";
import LoadingSpinner from "@/components/LoadingSpinner";

export default function ReportResults({
  report,
  snapshot,
  snapshotError,
  mutateReport,
  mutateSnapshot,
  ssrPolyfills,
  canEdit,
  setEditAnalysisOpen,
  runQueriesButtonRef,
  showDetails,
}: {
  report: ExperimentSnapshotReportInterface;
  snapshot?: ExperimentSnapshotInterface;
  snapshotError?: Error;
  mutateReport?: () => Promise<unknown> | unknown;
  mutateSnapshot?: () => Promise<unknown> | unknown;
  ssrPolyfills?: SSRPolyfills;
  canEdit?: boolean;
  setEditAnalysisOpen?: (o: boolean) => void;
  runQueriesButtonRef?: RefObject<HTMLButtonElement>;
  showDetails?: boolean;
}) {
  const phases = report.experimentMetadata.phases;
  const phase = phases.length - 1;
  const phaseObj = phases[phase];

  const variations = report.experimentMetadata.variations.map(
    (variation, i) => ({
      id: variation.id,
      name: variation.name,
      weight:
        report.experimentMetadata.phases?.[snapshot?.phase || 0]
          ?.variationWeights?.[i] ||
        1 / (report.experimentMetadata?.variations?.length || 2),
    })
  );
  const analysis = snapshot
    ? getSnapshotAnalysis(snapshot) ?? undefined
    : undefined;
  const queryStatusData = getQueryStatus(
    snapshot?.queries || [],
    snapshot?.error
  );

  const settingsForSnapshotMetrics: MetricSnapshotSettings[] =
    snapshot?.settings?.metricSettings?.map((m) => ({
      metric: m.id,
      properPrior: m.computedSettings?.properPrior ?? false,
      properPriorMean: m.computedSettings?.properPriorMean ?? 0,
      properPriorStdDev:
        m.computedSettings?.properPriorStdDev ?? DEFAULT_PROPER_PRIOR_STDDEV,
      regressionAdjustmentReason:
        m.computedSettings?.regressionAdjustmentReason || "",
      regressionAdjustmentDays:
        m.computedSettings?.regressionAdjustmentDays || 0,
      regressionAdjustmentEnabled: !!m.computedSettings
        ?.regressionAdjustmentEnabled,
      regressionAdjustmentAvailable: !!m.computedSettings
        ?.regressionAdjustmentAvailable,
    })) || [];

  const _orgSettings = useOrgSettings();
  const pValueCorrection =
    ssrPolyfills?.useOrgSettings?.()?.pValueCorrection ||
    _orgSettings?.pValueCorrection;

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  const showBreakDownResults =
    hasData &&
    !!snapshot?.dimension &&
    snapshot.dimension.substring(0, 8) !== "pre:date" &&
    !!analysis?.settings?.dimensions?.length;

  const showDateResults =
    hasData &&
    snapshot?.dimension?.substring(0, 8) === "pre:date" &&
    !!analysis?.settings?.dimensions?.length;

  const showCompactResults =
    hasData &&
    !!snapshot &&
    !!analysis &&
    !analysis?.settings?.dimensions?.length;

  return (
    <>
      <ReportAnalysisSettingsBar
        report={report}
        snapshot={snapshot}
        mutateReport={mutateReport}
        mutateSnapshot={mutateSnapshot}
        ssrPolyfills={ssrPolyfills}
        canUpdateReport={canEdit}
        setEditAnalysisOpen={setEditAnalysisOpen}
        runQueriesButtonRef={runQueriesButtonRef}
      />
      <div className="bg-white border pt-3 mb-5">
        {snapshotError ? (
          <div className="mx-3 mb-3">
            <Callout status="error">
              Report error
              {showDetails && (
                <>: {snapshotError?.message ?? "Unknown error"}</>
              )}
              {canEdit && (
                <div className="mt-2 text-muted">
                  Try refreshing this report, or click &quot;View Queries&quot;
                  from the report menu to debug.
                </div>
              )}
            </Callout>
          </div>
        ) : snapshot && !analysis ? (
          <div className="mx-3 mb-3">
            <Callout status="error">
              Missing analysis
              {canEdit && (
                <div className="mt-2 text-muted">
                  Try refreshing this report to resolve.
                </div>
              )}
            </Callout>
          </div>
        ) : !snapshot ? (
          <div className="d-flex justify-content-center my-4">
            <LoadingSpinner />
          </div>
        ) : (
          <>
            {showDateResults ? (
              <DateResults
                goalMetrics={report.experimentAnalysisSettings.goalMetrics}
                secondaryMetrics={
                  report.experimentAnalysisSettings.secondaryMetrics
                }
                guardrailMetrics={
                  report.experimentAnalysisSettings.guardrailMetrics
                }
                results={analysis?.results ?? []}
                seriestype={snapshot.dimension ?? ""}
                variations={variations}
                statsEngine={
                  analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE
                }
                differenceType={
                  report?.experimentAnalysisSettings?.differenceType ||
                  "relative"
                }
                ssrPolyfills={ssrPolyfills}
              />
            ) : showBreakDownResults ? (
              <BreakDownResults
                key={snapshot.dimension}
                results={analysis?.results ?? []}
                queryStatusData={queryStatusData}
                variations={variations}
                // variationFilter={variationFilter}
                // baselineRow={baselineRow}
                goalMetrics={report.experimentAnalysisSettings.goalMetrics}
                secondaryMetrics={
                  report.experimentAnalysisSettings.secondaryMetrics
                }
                guardrailMetrics={
                  report.experimentAnalysisSettings.guardrailMetrics
                }
                activationMetric={
                  report.experimentAnalysisSettings.activationMetric
                }
                metricOverrides={
                  report.experimentAnalysisSettings.metricOverrides ?? []
                }
                dimensionId={snapshot.dimension ?? ""}
                startDate={getValidDate(phaseObj.dateStarted).toISOString()}
                isLatestPhase={phase === phases.length - 1}
                reportDate={snapshot.dateCreated}
                status={"stopped"}
                statsEngine={analysis.settings.statsEngine}
                pValueCorrection={pValueCorrection}
                regressionAdjustmentEnabled={
                  analysis?.settings?.regressionAdjusted
                }
                settingsForSnapshotMetrics={settingsForSnapshotMetrics}
                sequentialTestingEnabled={analysis?.settings?.sequentialTesting}
                differenceType={
                  report?.experimentAnalysisSettings?.differenceType ||
                  "relative"
                }
                // metricFilter={metricFilter}
                // setMetricFilter={setMetricFilter}
                ssrPolyfills={ssrPolyfills}
                hideDetails={!showDetails}
              />
            ) : showCompactResults ? (
              <CompactResults
                variations={variations}
                multipleExposures={snapshot.multipleExposures || 0}
                results={analysis.results[0]}
                queryStatusData={queryStatusData}
                reportDate={snapshot.dateCreated}
                startDate={getValidDate(phaseObj.dateStarted).toISOString()}
                isLatestPhase={phase === phases.length - 1}
                status={"stopped"}
                goalMetrics={report.experimentAnalysisSettings.goalMetrics}
                secondaryMetrics={
                  report.experimentAnalysisSettings.secondaryMetrics
                }
                guardrailMetrics={
                  report.experimentAnalysisSettings.guardrailMetrics
                }
                metricOverrides={
                  report.experimentAnalysisSettings.metricOverrides ?? []
                }
                id={report.id}
                statsEngine={analysis.settings.statsEngine}
                pValueCorrection={pValueCorrection} // todo: bake this into snapshot or report
                regressionAdjustmentEnabled={
                  report.experimentAnalysisSettings.regressionAdjustmentEnabled
                }
                settingsForSnapshotMetrics={settingsForSnapshotMetrics}
                sequentialTestingEnabled={analysis.settings?.sequentialTesting}
                differenceType={
                  report?.experimentAnalysisSettings?.differenceType ||
                  "relative"
                }
                isTabActive={true}
                experimentType={report.experimentMetadata.type}
                ssrPolyfills={ssrPolyfills}
                hideDetails={!showDetails}
              />
            ) : (
              <div className="mx-3 mb-3">
                <Callout status="error">
                  No analysis found for this report
                </Callout>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
