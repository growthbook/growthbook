import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { extent } from "@visx/vendor/d3-array";
import { MetricTimeSeries, RampScheduleInterface } from "shared/validators";
import { getValidDate } from "shared/dates";
import {
  filterInvalidMetricTimeSeries,
  getSafeRolloutSnapshotAnalysis,
} from "shared/util";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { SafeRolloutSnapshotInterface } from "shared/types/safe-rollout";
import { expandMetricGroups } from "shared/experiments";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import {
  getRampHealthOverview,
  isOnMonitoredStep,
  useRampMonitoringSignals,
} from "@/components/RampSchedule/RampMonitoringSignals";
import {
  buildDummyIssueProfile,
  buildDummyScenarios,
  DummyScenario,
  getDummySeed,
  seededRandom,
} from "@/components/RampSchedule/dummyMonitoringData";
import {
  generateDummySnapshotMetrics,
  generateDummyTimeSeries,
  generateDummyTrafficSnapshot,
  buildDummySafeRolloutForSignals,
} from "./dummyData";
import {
  MetricSection,
  HealthChecks,
  buildEventMarkers,
} from "./MetricSection";
import { SafeRolloutStatusBar, MonitoringControls } from "./StatusBar";

interface SafeRolloutRuleDashboardProps {
  rampSchedule: RampScheduleInterface;
  safeRolloutId?: string;
  mutateRule?: () => void;
}

const SafeRolloutRuleDashboard: FC<SafeRolloutRuleDashboardProps> = ({
  rampSchedule,
  safeRolloutId,
  mutateRule,
}) => {
  const router = useRouter();
  const useDummyData = router.query["dummy"] === "true";
  const dummySeedQuery = router.query["dummySeed"];
  const dummySeed = useMemo(() => {
    if (!useDummyData) return 0;
    return getDummySeed(dummySeedQuery, rampSchedule.id);
  }, [useDummyData, dummySeedQuery, rampSchedule.id]);

  const { metricGroups, getExperimentMetricById } = useDefinitions();

  const guardrailMetricIds = useMemo(
    () =>
      expandMetricGroups(
        rampSchedule.monitoringConfig?.guardrailMetricIds ?? [],
        metricGroups,
      ),
    [rampSchedule.monitoringConfig?.guardrailMetricIds, metricGroups],
  );
  const signalMetricIds = useMemo(() => {
    const guardrailSet = new Set(guardrailMetricIds);
    return expandMetricGroups(
      rampSchedule.monitoringConfig?.signalMetricIds ?? [],
      metricGroups,
    ).filter((id) => !guardrailSet.has(id));
  }, [
    rampSchedule.monitoringConfig?.signalMetricIds,
    metricGroups,
    guardrailMetricIds,
  ]);
  const allMetricIds = useMemo(
    () => [...guardrailMetricIds, ...signalMetricIds],
    [guardrailMetricIds, signalMetricIds],
  );

  const dummyIssueProfile = useMemo(
    () => (useDummyData ? buildDummyIssueProfile(dummySeed) : undefined),
    [useDummyData, dummySeed],
  );
  const dummyScenarios = useMemo(
    () =>
      useDummyData && dummyIssueProfile
        ? buildDummyScenarios(allMetricIds, dummySeed, dummyIssueProfile)
        : ([] as DummyScenario[]),
    [useDummyData, dummyIssueProfile, allMetricIds, dummySeed],
  );

  const dummyMetrics = useMemo(
    () =>
      useDummyData
        ? generateDummySnapshotMetrics(
            allMetricIds,
            dummyScenarios,
            dummyIssueProfile,
            (metricId) => !!getExperimentMetricById(metricId)?.inverse,
            getExperimentMetricById,
          )
        : undefined,
    [
      useDummyData,
      allMetricIds,
      dummyScenarios,
      dummyIssueProfile,
      getExperimentMetricById,
    ],
  );

  const dummyStartMs = useMemo(() => {
    if (!useDummyData) return undefined;
    const history = rampSchedule.eventHistory;
    if (history && history.length > 0) {
      return getValidDate(history[0].timestamp).getTime();
    }
    if (rampSchedule.startedAt) {
      return getValidDate(rampSchedule.startedAt).getTime();
    }
    return undefined;
  }, [useDummyData, rampSchedule.eventHistory, rampSchedule.startedAt]);

  const dummyTs = useMemo(
    () =>
      useDummyData
        ? generateDummyTimeSeries(
            allMetricIds,
            dummyScenarios,
            dummyMetrics,
            (metricId) => !!getExperimentMetricById(metricId)?.inverse,
            dummyStartMs,
          )
        : undefined,
    [
      useDummyData,
      allMetricIds,
      dummyScenarios,
      dummyMetrics,
      getExperimentMetricById,
      dummyStartMs,
    ],
  );

  const dummyTrafficUsers = useMemo(() => {
    if (!useDummyData || !dummyMetrics) return undefined;
    if (dummyIssueProfile?.forceNoTraffic) {
      return { treatmentUsers: 0, controlUsers: 0 };
    }
    if (dummyIssueProfile?.forceLowTraffic) {
      const r = seededRandom(dummySeed ^ 0x3ad8025f);
      return {
        treatmentUsers: 15 + Math.round(r() * 40),
        controlUsers: 15 + Math.round(r() * 40),
      };
    }
    const firstMetric = allMetricIds[0];
    const firstMetricData = firstMetric ? dummyMetrics[firstMetric] : undefined;
    if (!firstMetricData) return undefined;
    return {
      treatmentUsers: firstMetricData.variation.users ?? 0,
      controlUsers: firstMetricData.baseline.users ?? 0,
    };
  }, [useDummyData, dummyMetrics, allMetricIds, dummyIssueProfile, dummySeed]);

  const dummyTrafficSnapshot = useMemo(
    () =>
      useDummyData
        ? generateDummyTrafficSnapshot(dummyTrafficUsers, dummyIssueProfile)
        : undefined,
    [useDummyData, dummyTrafficUsers, dummyIssueProfile],
  );

  const snapshotCtx = useSafeRolloutSnapshot();
  const { data: snapshotDataDirect, mutate: mutateSnapshotDirect } = useApi<{
    snapshot: SafeRolloutSnapshotInterface;
    latest?: SafeRolloutSnapshotInterface;
  }>(`/safe-rollout/${safeRolloutId}/snapshot`, {
    shouldRun: () => !useDummyData && !!safeRolloutId && !snapshotCtx.snapshot,
  });
  const snapshotData = useMemo(
    () =>
      snapshotCtx.snapshot
        ? { snapshot: snapshotCtx.snapshot, latest: snapshotCtx.latest }
        : snapshotDataDirect,
    [snapshotCtx.snapshot, snapshotCtx.latest, snapshotDataDirect],
  );

  const snapshotAnalysis = useMemo(() => {
    if (!snapshotData?.snapshot) return null;
    const analysis = getSafeRolloutSnapshotAnalysis(snapshotData.snapshot);
    return analysis?.results?.[0] ?? null;
  }, [snapshotData]);

  const snapshotDate = snapshotData?.snapshot?.dateCreated
    ? getValidDate(snapshotData.snapshot.dateCreated)
    : new Date();
  const startDate = snapshotData?.snapshot?.runStarted
    ? getValidDate(snapshotData.snapshot.runStarted)
    : new Date();

  const urlMetricIds = allMetricIds
    .map((id) => encodeURIComponent(id))
    .join("&metricIds[]=");

  const { data: tsData, mutate: mutateTimeSeries } = useApi<{
    status: number;
    timeSeries: MetricTimeSeries[];
  }>(`/safe-rollout/${safeRolloutId}/time-series?metricIds[]=${urlMetricIds}`, {
    shouldRun: () =>
      !useDummyData && !!safeRolloutId && allMetricIds.length > 0,
  });

  const { mutateSnapshot: mutateSnapshotCtx } = snapshotCtx;
  const mutateAll = useCallback(() => {
    mutateSnapshotCtx();
    mutateSnapshotDirect();
    mutateTimeSeries();
    mutateRule?.();
  }, [mutateSnapshotCtx, mutateSnapshotDirect, mutateTimeSeries, mutateRule]);

  const snapshotMetrics = useMemo(() => {
    if (useDummyData && dummyMetrics) return dummyMetrics;
    if (!snapshotAnalysis?.variations) return {};

    const result: Record<
      string,
      { baseline: SnapshotMetric; variation: SnapshotMetric }
    > = {};
    for (const metricId of allMetricIds) {
      const baseline = snapshotAnalysis.variations[0]?.metrics?.[metricId];
      const variation = snapshotAnalysis.variations[1]?.metrics?.[metricId];
      if (baseline && variation) {
        result[metricId] = { baseline, variation };
      }
    }
    return result;
  }, [useDummyData, dummyMetrics, snapshotAnalysis, allMetricIds]);

  const dummySafeRolloutForSignals = useMemo(() => {
    if (!useDummyData) return undefined;
    return buildDummySafeRolloutForSignals(
      guardrailMetricIds,
      signalMetricIds,
      snapshotMetrics,
      (metricId) => !!getExperimentMetricById(metricId)?.inverse,
    );
  }, [
    useDummyData,
    guardrailMetricIds,
    signalMetricIds,
    snapshotMetrics,
    getExperimentMetricById,
  ]);

  const filteredTs = useMemo(() => {
    if (useDummyData && dummyTs) return dummyTs;
    if (!tsData) return [];
    return filterInvalidMetricTimeSeries(tsData.timeSeries);
  }, [useDummyData, dummyTs, tsData]);

  const timeSeriesMap = useMemo(() => {
    const map: Record<string, MetricTimeSeries> = {};
    for (const ts of filteredTs) {
      map[ts.metricId] = ts;
    }
    return map;
  }, [filteredTs]);

  const eventMarkers = useMemo(
    () => buildEventMarkers(rampSchedule.eventHistory ?? []),
    [rampSchedule.eventHistory],
  );

  const dateExtent = useMemo((): [Date, Date] | [undefined, undefined] => {
    const dataDates: Date[] = filteredTs.flatMap((t) =>
      t.dataPoints.map((d) => getValidDate(d.date)),
    );
    const stepEventDates = eventMarkers
      .filter((m) => m.label !== "Start")
      .map((m) => m.date);

    const dates = [...dataDates, ...stepEventDates];
    if (dates.length > 0) {
      const [lo, hi] = extent(dates) as [Date, Date];
      return [lo, hi];
    }
    const fallbackStart = rampSchedule.startedAt
      ? getValidDate(rampSchedule.startedAt)
      : new Date();
    return [fallbackStart, new Date()];
  }, [filteredTs, eventMarkers, rampSchedule.startedAt]);

  const queryStatus = useMemo(() => {
    const snap = snapshotData?.latest ?? snapshotData?.snapshot;
    if (!snap) return null;
    return getQueryStatus(snap.queries, snap.error);
  }, [snapshotData]);
  const hasQueryIssue =
    queryStatus?.status === "failed" ||
    queryStatus?.status === "partially-succeeded";

  const monitoringSignals = useRampMonitoringSignals(rampSchedule, {
    snapshot: useDummyData ? dummyTrafficSnapshot : snapshotData?.snapshot,
    safeRollout: useDummyData
      ? dummySafeRolloutForSignals
      : snapshotCtx.safeRollout,
  });
  const monitoringOverview = useMemo(
    () => getRampHealthOverview(rampSchedule, monitoringSignals),
    [rampSchedule, monitoringSignals],
  );
  const shouldAutoExpand = monitoringOverview.autoExpand || hasQueryIssue;

  const [controlsExpanded, setControlsExpanded] = useState(false);
  const hasAutoExpanded = useRef(false);
  useEffect(() => {
    if (shouldAutoExpand && !hasAutoExpanded.current) {
      hasAutoExpanded.current = true;
      setControlsExpanded(true);
    }
  }, [shouldAutoExpand]);

  if (allMetricIds.length === 0) return null;

  const suppressMonitoringDetails =
    rampSchedule.status === "running" && !isOnMonitoredStep(rampSchedule);
  const detailsId = `monitoring-details-${safeRolloutId ?? "preview"}`;

  return (
    <Box mt="3">
      <Box
        px="4"
        pt="3"
        pb="2"
        style={{
          border: "1px solid var(--gray-a5)",
          borderRadius: "var(--radius-3)",
        }}
      >
        {safeRolloutId && (
          <SafeRolloutStatusBar
            rampSchedule={rampSchedule}
            snapshot={
              useDummyData ? dummyTrafficSnapshot : snapshotData?.snapshot
            }
            safeRollout={
              useDummyData
                ? dummySafeRolloutForSignals
                : snapshotCtx.safeRollout
            }
            detailsId={detailsId}
            controlsExpanded={controlsExpanded}
            onToggleExpanded={() => setControlsExpanded((v) => !v)}
            useDummyData={useDummyData}
          />
        )}

        {!suppressMonitoringDetails && controlsExpanded && (
          <Box id={detailsId} mt="2" mb="1">
            {safeRolloutId && (
              <MonitoringControls
                rampSchedule={rampSchedule}
                safeRolloutId={safeRolloutId}
                snapshot={
                  useDummyData ? dummyTrafficSnapshot : snapshotData?.snapshot
                }
                latest={
                  useDummyData ? dummyTrafficSnapshot : snapshotData?.latest
                }
                mutateSnapshot={mutateAll}
              />
            )}

            {guardrailMetricIds.length > 0 && (
              <MetricSection
                title="Guardrail Metrics"
                subtitle="Automatically roll back the ramp-up if any of these metrics show a statistically significant regression"
                metricIds={guardrailMetricIds}
                resultGroup="guardrail"
                snapshotMetrics={snapshotMetrics}
                timeSeries={timeSeriesMap}
                dateExtent={dateExtent}
                reportDate={snapshotDate}
                startDate={startDate}
                eventMarkers={eventMarkers}
                signalMetricIds={signalMetricIds}
              />
            )}

            {signalMetricIds.length > 0 && (
              <MetricSection
                title="Signal Metrics"
                subtitle="If any of these metrics show a regression, hold at the current step until healthy or manual advancement"
                metricIds={signalMetricIds}
                resultGroup="secondary"
                snapshotMetrics={snapshotMetrics}
                timeSeries={timeSeriesMap}
                dateExtent={dateExtent}
                reportDate={snapshotDate}
                startDate={startDate}
                eventMarkers={eventMarkers}
                signalMetricIds={signalMetricIds}
              />
            )}

            <HealthChecks
              snapshot={
                useDummyData ? dummyTrafficSnapshot : snapshotData?.snapshot
              }
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default SafeRolloutRuleDashboard;
