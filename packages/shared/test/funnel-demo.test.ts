import { factMetricValidator } from "../src/validators/fact-table";
import {
  getAllExpandedMetricIdsFromExperiment,
  type ExperimentMetricInterface,
} from "../src/experiments/experiments";
import {
  FUNNEL_DEMO_METRIC_ID,
  HARDCODED_FUNNEL_METRIC,
  addFunnelEphemeralMetricsToMap,
  funnelDemoStepMetricId,
  getFunnelEphemeralMetricById,
  getFunnelEphemeralMetrics,
  getFunnelMetricNumbers,
  getFunnelParentStepDescriptors,
} from "../src/experiments/funnel-demo";

describe("getFunnelMetricNumbers", () => {
  const variations = [{ index: 0 }, { index: 1 }];
  const numbers = getFunnelMetricNumbers(HARDCODED_FUNNEL_METRIC, variations);

  it("returns population, overall, and one entry per step for each variation", () => {
    expect(numbers.population[0]).toBe(10000);
    expect(numbers.population[1]).toBe(10500);
    expect(numbers.steps).toHaveLength(HARDCODED_FUNNEL_METRIC.steps.length);
    numbers.steps.forEach((step) => {
      expect(step.count[0]).toBeGreaterThan(0);
      expect(step.count[1]).toBeGreaterThan(0);
    });
    expect(numbers.overall[0]).toBeDefined();
    expect(numbers.overall[1]).toBeDefined();
  });

  it("produces non-increasing step counts within a variation", () => {
    variations.forEach(({ index }) => {
      for (let i = 1; i < numbers.steps.length; i++) {
        expect(numbers.steps[i].count[index]).toBeLessThanOrEqual(
          numbers.steps[i - 1].count[index],
        );
      }
    });
  });

  it("sets overall count to the last step's count", () => {
    const lastStep = numbers.steps[numbers.steps.length - 1];
    expect(numbers.overall[0].count).toBe(lastStep.count[0]);
    expect(numbers.overall[1].count).toBe(lastStep.count[1]);
  });

  it("gives the higher variation a visible lift at every step", () => {
    numbers.steps.forEach((step) => {
      expect(step.count[1]).toBeGreaterThanOrEqual(step.count[0]);
    });
    expect(numbers.overall[1].count).toBeGreaterThanOrEqual(
      numbers.overall[0].count,
    );
  });

  it("diverges in funnel shape across variations, not just absolute level", () => {
    // The chart normalizes each series to its own first step, so a lift that
    // scaled every step by the same factor would render identical funnels.
    // Retention from the first step must differ across variations.
    const retentionFromStart = (index: number, stepIdx: number) =>
      numbers.steps[stepIdx].count[index] / numbers.steps[0].count[index];
    const lastStep = numbers.steps.length - 1;
    expect(retentionFromStart(1, lastStep)).toBeGreaterThan(
      retentionFromStart(0, lastStep),
    );
  });
});

describe("getFunnelEphemeralMetrics", () => {
  const metrics = getFunnelEphemeralMetrics(HARDCODED_FUNNEL_METRIC);

  it("returns the overall metric plus one metric per funnel step", () => {
    expect(metrics).toHaveLength(1 + HARDCODED_FUNNEL_METRIC.steps.length);
    expect(metrics[0].id).toBe(FUNNEL_DEMO_METRIC_ID);
    expect(metrics[0].metricType).toBe("proportion");
    expect(factMetricValidator.safeParse(metrics[0]).success).toBe(true);
  });

  it("emits a valid proportion Fact Metric for each step keyed by its step id", () => {
    HARDCODED_FUNNEL_METRIC.steps.forEach((step, index) => {
      const stepMetric = metrics[index + 1];
      expect(stepMetric.id).toBe(funnelDemoStepMetricId(index));
      expect(stepMetric.name).toBe(step.name);
      expect(stepMetric.metricType).toBe("proportion");
      expect(factMetricValidator.safeParse(stepMetric).success).toBe(true);
    });
  });
});

describe("getFunnelEphemeralMetricById", () => {
  it("resolves the overall funnel metric by id", () => {
    const metric = getFunnelEphemeralMetricById(FUNNEL_DEMO_METRIC_ID);
    expect(metric).not.toBeNull();
    expect(metric?.id).toBe(FUNNEL_DEMO_METRIC_ID);
  });

  it("resolves a funnel step metric by id", () => {
    const metric = getFunnelEphemeralMetricById(funnelDemoStepMetricId(0));
    expect(metric).not.toBeNull();
    expect(metric?.id).toBe(funnelDemoStepMetricId(0));
    expect(metric?.name).toBe(HARDCODED_FUNNEL_METRIC.steps[0].name);
  });

  it("returns null for an unknown id", () => {
    expect(getFunnelEphemeralMetricById("fact__does_not_exist")).toBeNull();
  });
});

describe("getFunnelParentStepDescriptors", () => {
  it("returns one descriptor per step for the funnel parent id", () => {
    const descriptors = getFunnelParentStepDescriptors(FUNNEL_DEMO_METRIC_ID);
    expect(descriptors).not.toBeNull();
    expect(descriptors).toHaveLength(HARDCODED_FUNNEL_METRIC.steps.length);
    descriptors?.forEach((descriptor, index) => {
      expect(descriptor.index).toBe(index);
      expect(descriptor.name).toBe(HARDCODED_FUNNEL_METRIC.steps[index].name);
      expect(descriptor.stepMetricId).toBe(funnelDemoStepMetricId(index));
    });
  });

  it("returns null for any other metric id", () => {
    expect(getFunnelParentStepDescriptors("fact__other")).toBeNull();
    expect(
      getFunnelParentStepDescriptors(funnelDemoStepMetricId(0)),
    ).toBeNull();
  });
});

describe("addFunnelEphemeralMetricsToMap", () => {
  it("adds the overall funnel metric and every step metric to the map", () => {
    const map = new Map<string, ExperimentMetricInterface>();
    addFunnelEphemeralMetricsToMap(map);
    expect(map.get(FUNNEL_DEMO_METRIC_ID)?.metricType).toBe("proportion");
    HARDCODED_FUNNEL_METRIC.steps.forEach((_, index) => {
      expect(map.get(funnelDemoStepMetricId(index))?.metricType).toBe(
        "proportion",
      );
    });
    expect(map.size).toBe(1 + HARDCODED_FUNNEL_METRIC.steps.length);
  });
});

describe("getAllExpandedMetricIdsFromExperiment funnel expansion", () => {
  it("scoops funnel step ids from the map when the overall id is a goal metric", () => {
    const map = new Map<string, ExperimentMetricInterface>();
    addFunnelEphemeralMetricsToMap(map);
    const ids = getAllExpandedMetricIdsFromExperiment({
      exp: { goalMetrics: [FUNNEL_DEMO_METRIC_ID] },
      expandedMetricMap: map,
    });
    expect(ids).toContain(FUNNEL_DEMO_METRIC_ID);
    HARDCODED_FUNNEL_METRIC.steps.forEach((_, index) => {
      expect(ids).toContain(funnelDemoStepMetricId(index));
    });
  });

  it("omits step ids when they are absent from the map", () => {
    const ids = getAllExpandedMetricIdsFromExperiment({
      exp: { goalMetrics: [FUNNEL_DEMO_METRIC_ID] },
      expandedMetricMap: new Map<string, ExperimentMetricInterface>(),
    });
    expect(ids).toContain(FUNNEL_DEMO_METRIC_ID);
    expect(ids).not.toContain(funnelDemoStepMetricId(0));
  });
});
