import {
  MetricTimeSeries,
  MetricTimeSeriesDataPoint,
  SafeRolloutInterface,
} from "shared/validators";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { SafeRolloutSnapshotInterface } from "shared/types/safe-rollout";
import {
  ExperimentMetricInterface,
  isBinomialMetric,
} from "shared/experiments";
import {
  DummyIssueProfile,
  DummyScenario,
  hashString,
  seededRandom,
} from "@/components/RampSchedule/dummyMonitoringData";

// Non-binomial dummy metrics need non-zero display scale.
function dummyPerUnitMeanAndTotal(
  metricId: string,
  users: number,
  rand: () => number,
  getExperimentMetricById?: (id: string) => ExperimentMetricInterface | null,
): { mean: number; total: number } {
  const metric = getExperimentMetricById?.(metricId);
  if (metric && !isBinomialMetric(metric)) {
    const mean = 50 + rand() * 350;
    return { mean, total: mean * users };
  }
  const mean = 0.02 + rand() * 0.15;
  return { mean, total: mean * users };
}

export function generateDummySnapshotMetrics(
  metricIds: string[],
  scenarios: DummyScenario[],
  issueProfile?: DummyIssueProfile,
  isInverseMetric: (metricId: string) => boolean = () => false,
  getExperimentMetricById?: (id: string) => ExperimentMetricInterface | null,
): Record<string, { baseline: SnapshotMetric; variation: SnapshotMetric }> {
  const result: Record<
    string,
    { baseline: SnapshotMetric; variation: SnapshotMetric }
  > = {};
  metricIds.forEach((id, idx) => {
    const rand = seededRandom(hashString(id));
    const scenario = scenarios[idx % scenarios.length];
    const userMultiplier = issueProfile?.userMultiplier ?? 1;
    const baseUsers = Math.max(
      8,
      Math.round((800 + Math.floor(rand() * 4000)) * userMultiplier),
    );
    const { mean: baseCr, total: baseValue } = dummyPerUnitMeanAndTotal(
      id,
      baseUsers,
      rand,
      getExperimentMetricById,
    );

    const baseline: SnapshotMetric = {
      value: baseValue,
      cr: baseCr,
      users: baseUsers,
      ci: [-Infinity, 0.05],
      expected: 0,
      pValue: 1,
    };

    if (scenario === "nodata") {
      result[id] = {
        baseline: { value: 0, cr: 0, users: 12 },
        variation: { value: 0, cr: 0, users: 8 },
      };
      return;
    }

    const varUsers = baseUsers + Math.floor((rand() - 0.5) * 200);
    const inverse = isInverseMetric(id);
    let effect: number;
    let pValue: number;
    if (scenario === "failing") {
      const magnitude = 0.04 + rand() * 0.08;
      effect = inverse ? magnitude : -magnitude;
      pValue = 0.001 + rand() * 0.03;
    } else {
      effect = (rand() - 0.5) * 0.04;
      pValue = 0.15 + rand() * 0.7;
    }
    const varCr = baseCr * (1 + effect);
    const varValue = varUsers * varCr;
    const ciHalf =
      scenario === "failing"
        ? Math.abs(effect) * (0.3 + rand() * 0.5)
        : Math.abs(effect) * (1.5 + rand() * 2);

    const variation: SnapshotMetric = {
      value: varValue,
      cr: varCr,
      users: varUsers,
      ci: inverse
        ? ([effect - ciHalf, Infinity] as [number, number])
        : ([-Infinity, effect + ciHalf] as [number, number]),
      expected: effect,
      pValue,
    };

    result[id] = { baseline, variation };
  });
  return result;
}

export function generateDummyTimeSeries(
  metricIds: string[],
  scenarios: DummyScenario[],
  snapshotMetrics?: Record<
    string,
    { baseline: SnapshotMetric; variation: SnapshotMetric }
  >,
  isInverseMetric: (metricId: string) => boolean = () => false,
  startMs?: number,
): MetricTimeSeries[] {
  const now = Date.now();
  const threeDaysAgo = startMs ?? now - 3 * 24 * 60 * 60 * 1000;
  const pointCount = 20;

  return metricIds.map((metricId, idx) => {
    const rand = seededRandom(hashString(metricId) + 999);
    const scenario = scenarios[idx % scenarios.length];
    const baseCr =
      snapshotMetrics?.[metricId]?.baseline?.cr ?? 0.02 + rand() * 0.15;

    const snapshotEffect =
      snapshotMetrics?.[metricId]?.variation?.expected ?? 0;
    const inverse = isInverseMetric(metricId);

    const dataPoints: MetricTimeSeriesDataPoint[] = [];
    if (scenario === "nodata") {
      return {
        id: `dummy-ts-${metricId}`,
        organization: "dummy",
        dateCreated: new Date(threeDaysAgo),
        dateUpdated: new Date(now),
        metricId,
        source: "safe-rollout" as const,
        sourceId: "dummy",
        lastExperimentSettingsHash: "",
        lastMetricSettingsHash: "",
        dataPoints: [],
      };
    }
    for (let p = 0; p < pointCount; p++) {
      const date = new Date(
        threeDaysAgo + (p / (pointCount - 1)) * (now - threeDaysAgo),
      );
      const progress = p / pointCount;

      const effect =
        scenario === "failing"
          ? snapshotEffect * progress + (rand() - 0.5) * 0.01
          : (rand() - 0.5) * 0.015;

      const pVal =
        scenario === "failing"
          ? Math.max(0.001, 0.5 - progress * 0.45 + (rand() - 0.5) * 0.1)
          : 0.2 + rand() * 0.6;

      const ciMargin =
        scenario === "failing"
          ? 0.04 / Math.sqrt(0.5 + progress * 5)
          : 0.03 / Math.sqrt(0.5 + progress * 5);

      const ci = inverse
        ? ([effect - ciMargin, Infinity] as [number, number])
        : ([-Infinity, effect + ciMargin] as [number, number]);

      dataPoints.push({
        date,
        variations: [
          {
            id: "0",
            name: "Control",
            stats: {
              users: 100 + p * 50,
              mean: baseCr,
              stddev: baseCr * 0.3,
            },
          },
          {
            id: "1",
            name: "Rollout Value",
            stats: {
              users: 98 + p * 48,
              mean: baseCr * (1 + effect),
              stddev: baseCr * 0.3,
            },
            relative: {
              value: effect,
              ci,
              pValue: pVal,
              expected: effect,
            },
            absolute: {
              value: effect,
              ci,
              pValue: pVal,
              expected: effect,
            },
          },
        ],
      });
    }

    return {
      id: `dummy-ts-${metricId}`,
      organization: "dummy",
      dateCreated: new Date(threeDaysAgo),
      dateUpdated: new Date(now),
      metricId,
      source: "safe-rollout" as const,
      sourceId: "dummy",
      lastExperimentSettingsHash: "",
      lastMetricSettingsHash: "",
      dataPoints,
    };
  });
}

export function generateDummyTrafficSnapshot(
  variationUsers?: { treatmentUsers: number; controlUsers: number },
  issueProfile?: DummyIssueProfile,
): SafeRolloutSnapshotInterface {
  const forceNoTraffic = !!issueProfile?.forceNoTraffic;
  const treatmentUsers = forceNoTraffic
    ? 0
    : (variationUsers?.treatmentUsers ?? 4821);
  const controlUsers = forceNoTraffic
    ? 0
    : (variationUsers?.controlUsers ?? 5203);
  const totalUsers = treatmentUsers + controlUsers;
  const multipleExposures = forceNoTraffic
    ? 0
    : Math.round(totalUsers * (issueProfile?.multipleExposureRate ?? 0.03));
  return {
    id: "srsnp_dummy",
    organization: "",
    safeRolloutId: "",
    dateCreated: new Date(),
    runStarted: new Date(),
    status: "success",
    queries: [],
    multipleExposures,
    analyses: [],
    health: {
      traffic: {
        overall: {
          name: "All",
          srm: issueProfile?.srmPValue ?? 0.42,
          variationUnits: [treatmentUsers, controlUsers],
        },
        dimension: {},
      },
    },
    settings: {
      datasourceId: "",
      exposureQueryId: "",
      startDate: new Date(),
      metricSettings: [],
    },
  } as unknown as SafeRolloutSnapshotInterface;
}

export function buildDummySafeRolloutForSignals(
  guardrailMetricIds: string[],
  signalMetricIds: string[],
  snapshotMetrics: Record<
    string,
    { baseline: SnapshotMetric; variation: SnapshotMetric }
  >,
  isInverseMetric: (metricId: string) => boolean = () => false,
): SafeRolloutInterface {
  const allMetricIds = new Set([...guardrailMetricIds, ...signalMetricIds]);
  const guardrailMetrics: Record<string, { status: string }> = {};

  for (const metricId of allMetricIds) {
    const metric = snapshotMetrics[metricId]?.variation;
    if (!metric) continue;
    const expected = metric.expected ?? 0;
    const pValue = metric.pValue ?? 1;
    const isSignificantLoss =
      pValue < 0.05 &&
      (isInverseMetric(metricId) ? expected > 0 : expected < 0);
    guardrailMetrics[metricId] = {
      status: isSignificantLoss ? "lost" : "won",
    };
  }

  return {
    analysisSummary: {
      resultsStatus: {
        variations: [
          { variationId: "1", guardrailMetrics },
          { variationId: "0", guardrailMetrics: {} },
        ],
      },
    },
  } as unknown as SafeRolloutInterface;
}
