import { FactMetricInterface } from "shared/types/fact-table";
// Type-only to avoid a runtime import cycle with experiments.ts.
import type { ExperimentMetricInterface } from "./experiments";

export type HardcodedFunnelMetric = {
  id: string;
  name: string;
  steps: { name: string }[];
};

export const FUNNEL_DEMO_METRIC_ID = "fact__funnel_demo";

export const funnelStepMetricId = (index: number): string =>
  `${FUNNEL_DEMO_METRIC_ID}?funnelStep=${index}`;

// True for the overall funnel id and any of its per-step ids.
export const isFunnelMetricId = (id: string): boolean =>
  id === FUNNEL_DEMO_METRIC_ID ||
  id.startsWith(`${FUNNEL_DEMO_METRIC_ID}?funnelStep=`);

export const HARDCODED_FUNNEL_METRIC: HardcodedFunnelMetric = {
  id: FUNNEL_DEMO_METRIC_ID,
  name: "Demo funnel",
  steps: [
    { name: "Viewed landing page" },
    { name: "Signed up" },
    { name: "Completed onboarding" },
    { name: "Made a purchase" },
  ],
};

// Retention factor per hardcoded step. Steps beyond this list derive their
// factor from the previous one so the mock works for any funnel length.
const STEP_RETENTION = [0.62, 0.41, 0.24, 0.13];

export function getFunnelMetricNumbers(
  funnel: HardcodedFunnelMetric,
  variations: { index: number }[],
): {
  population: Record<number, number>;
  overall: Record<number, { count: number }>;
  steps: Array<{ name: string; count: Record<number, number> }>;
} {
  const retention: number[] = [];
  funnel.steps.forEach((_, i) => {
    retention.push(
      i < STEP_RETENTION.length ? STEP_RETENTION[i] : retention[i - 1] * 0.6,
    );
  });

  const population: Record<number, number> = {};
  const overall: Record<number, { count: number }> = {};
  const steps = funnel.steps.map((step) => ({
    name: step.name,
    count: {} as Record<number, number>,
  }));

  variations.forEach(({ index }) => {
    const pop = 10000 + index * 500;
    population[index] = pop;

    // Higher variations retain better, and the boost compounds per step so
    // the funnel SHAPE diverges, not just its absolute level. A uniform
    // per-variation factor cancels out once the chart normalizes each series
    // to its own first step, making every variation render identically.
    const baseLift = 1 + index * 0.03;
    let previous = pop;
    funnel.steps.forEach((_, i) => {
      const liftFactor = baseLift * Math.pow(1 + index * 0.04, i);
      const count = Math.min(
        Math.round(pop * retention[i] * liftFactor),
        previous,
        pop,
      );
      steps[i].count[index] = count;
      previous = count;
    });

    overall[index] = { count: funnel.steps.length > 0 ? previous : pop };
  });

  return { population, overall, steps };
}

function buildEphemeralProportionMetric(
  id: string,
  name: string,
): FactMetricInterface {
  return {
    id,
    organization: "",
    owner: "",
    datasource: "",
    dateCreated: new Date(0),
    dateUpdated: new Date(0),
    name,
    description: "",
    tags: [],
    projects: [],
    inverse: false,
    metricType: "proportion",
    numerator: { factTableId: "", column: "$$distinctUsers" },
    denominator: null,
    cappingSettings: { type: "", value: 0 },
    windowSettings: {
      type: "",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: 3,
      windowUnit: "days",
    },
    priorSettings: { override: false, proper: false, mean: 0, stddev: 0.1 },
    maxPercentChange: 0.5,
    minPercentChange: 0.005,
    minSampleSize: 150,
    winRisk: 0.0025,
    loseRisk: 0.0125,
    regressionAdjustmentOverride: false,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 14,
    quantileSettings: null,
  };
}

export function getFunnelEphemeralMetrics(
  funnel: HardcodedFunnelMetric,
): FactMetricInterface[] {
  return [
    buildEphemeralProportionMetric(funnel.id, funnel.name),
    ...funnel.steps.map((step, index) =>
      buildEphemeralProportionMetric(funnelStepMetricId(index), step.name),
    ),
  ];
}

export function addFunnelEphemeralMetricsToMap(
  metricMap: Map<string, ExperimentMetricInterface>,
): void {
  for (const metric of getFunnelEphemeralMetrics(HARDCODED_FUNNEL_METRIC)) {
    metricMap.set(metric.id, metric);
  }
}

export function getFunnelEphemeralMetricById(
  id: string,
): FactMetricInterface | null {
  return (
    getFunnelEphemeralMetrics(HARDCODED_FUNNEL_METRIC).find(
      (metric) => metric.id === id,
    ) ?? null
  );
}

export function getFunnelParentStepDescriptors(
  metricId: string,
): { index: number; name: string; stepMetricId: string }[] | null {
  if (metricId !== FUNNEL_DEMO_METRIC_ID) {
    return null;
  }
  return HARDCODED_FUNNEL_METRIC.steps.map((step, index) => ({
    index,
    name: step.name,
    stepMetricId: funnelStepMetricId(index),
  }));
}
