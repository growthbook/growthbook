import {
  ExperimentMetricDefinition,
  resolveMetricsForSnapshot,
  resolveSnapshotMetricIds,
} from "shared/experiments";
import { FactMetricInterface } from "shared/types/fact-table";
import { ExperimentReportResultDimension } from "shared/types/report";

function factMetric(
  id: string,
  replaces?: string[],
): ExperimentMetricDefinition {
  return {
    id,
    name: id,
    metricType: "proportion",
    replaces,
  } as unknown as FactMetricInterface;
}

function legacyMetric(id: string): ExperimentMetricDefinition {
  return { id, name: id } as unknown as ExperimentMetricDefinition;
}

function resultsWith(
  ...metricIdsByVariation: string[][]
): ExperimentReportResultDimension[] {
  return [
    {
      name: "",
      srm: 1,
      variations: metricIdsByVariation.map((metricIds) => ({
        users: 100,
        metrics: Object.fromEntries(
          metricIds.map((id) => [id, { users: 100, value: 10, cr: 0.1 }]),
        ),
      })),
    },
  ];
}

const NEW_ID = "fact__new";
const OLD_ID = "met_old";

const metricsById: Record<string, ExperimentMetricDefinition> = {
  [NEW_ID]: factMetric(NEW_ID, [OLD_ID]),
  [OLD_ID]: legacyMetric(OLD_ID),
};
const getExperimentMetricById = (id: string) => metricsById[id] ?? null;

function resolve(
  metric: ExperimentMetricDefinition,
  snapshotMetricIds: string[],
) {
  return resolveMetricsForSnapshot({
    metric,
    getExperimentMetricById,
    results: resultsWith(snapshotMetricIds),
  });
}

describe("resolveMetricsForSnapshot", () => {
  it("substitutes the replaced metric when only its results are in the snapshot", () => {
    const { metrics, replacedByMetricName } = resolve(metricsById[NEW_ID], [
      OLD_ID,
    ]);
    expect(metrics.map((m) => m.id)).toEqual([OLD_ID]);
    expect(replacedByMetricName).toBe(NEW_ID);
  });

  it("substitutes when only some variations have the replaced metric's stats", () => {
    const { metrics } = resolveMetricsForSnapshot({
      metric: metricsById[NEW_ID],
      getExperimentMetricById,
      results: resultsWith([OLD_ID], []),
    });
    expect(metrics.map((m) => m.id)).toEqual([OLD_ID]);
  });

  it("substitutes every replaced metric a consolidating metric still has results for", () => {
    const oldIds = ["met_a", "met_b", "met_c"];
    oldIds.forEach((id) => {
      metricsById[id] = legacyMetric(id);
    });
    const consolidated = factMetric("fact__consolidated", oldIds);

    // In `replaces` order, regardless of the order the snapshot lists them in
    expect(
      resolve(consolidated, [...oldIds].reverse()).metrics.map((m) => m.id),
    ).toEqual(oldIds);
    // Only the ones the snapshot actually has results for
    expect(
      resolve(consolidated, ["met_c", "met_a"]).metrics.map((m) => m.id),
    ).toEqual(["met_a", "met_c"]);
  });

  it("does not substitute when the metric's own results are in the snapshot", () => {
    const { metrics, replacedByMetricName } = resolve(metricsById[NEW_ID], [
      NEW_ID,
      OLD_ID,
    ]);
    expect(metrics.map((m) => m.id)).toEqual([NEW_ID]);
    expect(replacedByMetricName).toBeUndefined();
  });

  it("does not substitute when no replaced metric is in the snapshot", () => {
    const { metrics, replacedByMetricName } = resolve(metricsById[NEW_ID], [
      "fact__unrelated",
    ]);
    expect(metrics.map((m) => m.id)).toEqual([NEW_ID]);
    expect(replacedByMetricName).toBeUndefined();
  });

  it("skips replaced metrics whose definition no longer exists", () => {
    const deletedId = "met_deleted";
    const metric = factMetric(NEW_ID, [deletedId, OLD_ID]);
    expect(
      resolve(metric, [deletedId, OLD_ID]).metrics.map((m) => m.id),
    ).toEqual([OLD_ID]);
  });

  it("leaves legacy metrics and fact metrics that replace nothing unchanged", () => {
    expect(resolve(legacyMetric(OLD_ID), []).metrics.map((m) => m.id)).toEqual([
      OLD_ID,
    ]);
    expect(resolve(factMetric(NEW_ID), []).metrics.map((m) => m.id)).toEqual([
      NEW_ID,
    ]);
  });
});

describe("resolveSnapshotMetricIds", () => {
  it("maps each goal onto the metric ids the snapshot actually has stats for", () => {
    expect(
      resolveSnapshotMetricIds({
        metricIds: [NEW_ID],
        getExperimentMetricById,
        results: resultsWith([OLD_ID]),
      }),
    ).toEqual([OLD_ID]);
    expect(
      resolveSnapshotMetricIds({
        metricIds: [NEW_ID],
        getExperimentMetricById,
        results: resultsWith([NEW_ID]),
      }),
    ).toEqual([NEW_ID]);
    expect(
      resolveSnapshotMetricIds({
        metricIds: ["missing"],
        getExperimentMetricById,
        results: resultsWith([]),
      }),
    ).toEqual(["missing"]);
  });
});
