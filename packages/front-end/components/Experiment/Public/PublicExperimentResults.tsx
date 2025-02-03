import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import {
  MetricSnapshotSettings,
} from "back-end/types/report";
import { getSnapshotAnalysis } from "shared/util";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import {ExperimentInterfaceStringDates} from "back-end/types/experiment";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/components/Radix/Callout";
import DateResults from "@/components/Experiment/DateResults";
import BreakDownResults from "@/components/Experiment/BreakDownResults";
import CompactResults from "@/components/Experiment/CompactResults";
import LoadingSpinner from "@/components/LoadingSpinner";
import PublicExperimentAnalysisSettingsBar from "@/components/Experiment/Public/PublicExperimentAnalysisSettingsBar";

export default function PublicExperimentResults({
  experiment,
  snapshot,
  snapshotError,
  ssrPolyfills,
  isTabActive,
}: {
  experiment: ExperimentInterfaceStringDates;
  snapshot?: ExperimentSnapshotInterface;
  snapshotError?: Error;
  ssrPolyfills: SSRPolyfills;
  isTabActive: boolean;
}) {
  const phases = experiment.phases;
  const phase = phases.length - 1;
  const phaseObj = phases[phase];

  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });
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

  const isBandit = experiment?.type === "multi-armed-bandit";

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
      <PublicExperimentAnalysisSettingsBar
        experiment={experiment}
        snapshot={snapshot ?? undefined}
        ssrPolyfills={ssrPolyfills}
      />

      <div className="bg-white border pt-3 mb-5">
        {snapshotError ? (
          <div className="mx-3 mb-3">
            <Callout status="error">
              Experiment snapshot error
            </Callout>
          </div>
        ) : snapshot && !analysis ? (
          <div className="mx-3 mb-3">
            <Callout status="error">
              Missing analysis
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
                goalMetrics={experiment.goalMetrics}
                secondaryMetrics={experiment.secondaryMetrics}
                guardrailMetrics={experiment.guardrailMetrics}
                results={analysis?.results ?? []}
                seriestype={snapshot.dimension ?? ""}
                variations={variations}
                statsEngine={analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE}
                differenceType={analysis.settings?.differenceType}
                ssrPolyfills={ssrPolyfills}
              />
            ) : showBreakDownResults ? (
              <BreakDownResults
                key={snapshot.dimension}
                results={analysis?.results ?? []}
                queryStatusData={queryStatusData}
                variations={variations}
                goalMetrics={experiment.goalMetrics}
                secondaryMetrics={experiment.secondaryMetrics}
                guardrailMetrics={experiment.guardrailMetrics}
                metricOverrides={experiment.metricOverrides ?? []}
                dimensionId={snapshot.dimension ?? ""}
                isLatestPhase={phase === experiment.phases.length - 1}
                startDate={phaseObj?.dateStarted ?? ""}
                reportDate={snapshot.dateCreated}
                activationMetric={experiment.activationMetric}
                status={experiment.status}
                statsEngine={analysis.settings.statsEngine}
                pValueCorrection={pValueCorrection}
                regressionAdjustmentEnabled={analysis?.settings?.regressionAdjusted}
                settingsForSnapshotMetrics={settingsForSnapshotMetrics}
                sequentialTestingEnabled={analysis?.settings?.sequentialTesting}
                differenceType={analysis.settings?.differenceType}
                isBandit={isBandit}
                ssrPolyfills={ssrPolyfills}
                hideDetails={true}
              />
            ) : showCompactResults ? (
              <CompactResults
                variations={variations}
                multipleExposures={snapshot.multipleExposures || 0}
                results={analysis.results[0]}
                queryStatusData={queryStatusData}
                reportDate={snapshot.dateCreated}
                startDate={phaseObj?.dateStarted ?? ""}
                isLatestPhase={phase === experiment.phases.length - 1}
                status={experiment.status}
                goalMetrics={experiment.goalMetrics}
                secondaryMetrics={experiment.secondaryMetrics}
                guardrailMetrics={experiment.guardrailMetrics}
                metricOverrides={experiment.metricOverrides ?? []}
                id={experiment.id}
                statsEngine={analysis.settings.statsEngine}
                pValueCorrection={pValueCorrection}
                regressionAdjustmentEnabled={analysis.settings?.regressionAdjusted}
                settingsForSnapshotMetrics={settingsForSnapshotMetrics}
                sequentialTestingEnabled={analysis.settings?.sequentialTesting}
                differenceType={analysis.settings?.differenceType}
                isTabActive={isTabActive}
                experimentType={experiment.type}
                ssrPolyfills={ssrPolyfills}
                hideDetails={true}
              />
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
