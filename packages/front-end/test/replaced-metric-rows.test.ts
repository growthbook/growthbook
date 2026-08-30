import { ExperimentMetricDefinition } from "shared/experiments";
import { FactMetricInterface } from "shared/types/fact-table";
import { ExperimentReportResultDimension } from "shared/types/report";
import { generateRowsForMetricGroup } from "@/hooks/useExperimentTableRows";

const NEW_ID = "fact__new";
const OLD_ID = "met_old";

const newMetric = {
  id: NEW_ID,
  name: "Revenue (v2)",
  metricType: "mean",
  numerator: { factTableId: "ft", column: "amount", rowFilters: [] },
  denominator: null,
  replaces: [OLD_ID],
} as unknown as FactMetricInterface;

const oldMetric = {
  id: OLD_ID,
  name: "Revenue",
} as unknown as ExperimentMetricDefinition;

const metricsById: Record<string, ExperimentMetricDefinition> = {
  [NEW_ID]: newMetric,
  [OLD_ID]: oldMetric,
};

function resultsFor(...metricIds: string[]): ExperimentReportResultDimension {
  return {
    name: "",
    srm: 1,
    variations: [0, 1].map((i) => ({
      users: 1000 + i,
      metrics: Object.fromEntries(
        metricIds.map((metricId) => [
          metricId,
          { users: 1000 + i, value: 100 + i, cr: 0.1 },
        ]),
      ),
    })),
  };
}

function rowsFor(
  results: ExperimentReportResultDimension,
  ...metricIds: string[]
) {
  return generateRowsForMetricGroup({
    metricIds: metricIds.length ? metricIds : [NEW_ID],
    resultGroup: "goal",
    results,
    metricOverrides: [],
    shouldShowMetricSlices: false,
    getExperimentMetricById: (id) => metricsById[id] ?? null,
    getFactTableById: () => null,
  });
}

describe("generateRowsForMetricGroup with a replaced metric", () => {
  it("falls back to the replaced metric's results when the snapshot predates the swap", () => {
    const results = resultsFor(OLD_ID);
    const [row] = rowsFor(results);

    expect(row.metric.id).toBe(OLD_ID);
    expect(row.replacedByMetricName).toBe("Revenue (v2)");
    results.variations.forEach((v, i) => {
      expect(row.variations[i]).toEqual(v.metrics[OLD_ID]);
    });
  });

  it("uses the metric's own results when the snapshot has them", () => {
    const results = resultsFor(NEW_ID);
    const [row] = rowsFor(results);

    expect(row.metric.id).toBe(NEW_ID);
    expect(row.replacedByMetricName).toBeUndefined();
  });

  it("renders a row per replaced metric when one metric consolidates several", () => {
    const oldIds = ["met_a", "met_b", "met_c"];
    oldIds.forEach((id) => {
      metricsById[id] = { id, name: id } as ExperimentMetricDefinition;
    });
    const consolidatedId = "fact__consolidated";
    metricsById[consolidatedId] = {
      ...newMetric,
      id: consolidatedId,
      name: "Consolidated",
      replaces: oldIds,
    } as unknown as FactMetricInterface;

    const rows = rowsFor(resultsFor(...oldIds), consolidatedId);

    expect(rows.map((r) => r.metric.id)).toEqual(oldIds);
    rows.forEach((row) => {
      expect(row.replacedByMetricName).toBe("Consolidated");
    });
  });

  it("renders a replaced metric once when two metrics both replace it", () => {
    const otherId = "fact__other";
    metricsById[otherId] = {
      ...newMetric,
      id: otherId,
      name: "Revenue (v3)",
    } as unknown as FactMetricInterface;

    const rows = rowsFor(resultsFor(OLD_ID), NEW_ID, otherId);

    expect(rows.map((r) => r.metric.id)).toEqual([OLD_ID]);
    expect(rows[0].replacedByMetricName).toBe("Revenue (v2)");
  });

  it("does not substitute in reverse when only the replacement is in the snapshot", () => {
    const [row] = rowsFor(resultsFor(NEW_ID), OLD_ID);

    expect(row.metric.id).toBe(OLD_ID);
    expect(row.replacedByMetricName).toBeUndefined();
    expect(row.variations[0].errorMessage).toBe("No data");
  });
});
