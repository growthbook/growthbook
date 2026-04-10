import type { ExperimentReportResultDimension } from "shared/types/report";
import type { SnapshotMetric } from "shared/types/experiment-snapshot";
import {
  mergeMetricResultRowsToAnalysisResults,
  splitAnalysisResultsToMetricResultRows,
} from "back-end/src/services/experimentSnapshotMetricResults";

function m(_id: string): SnapshotMetric {
  return {
    value: 1,
    cr: 1,
    users: 10,
    stats: { users: 10, mean: 1, count: 10, stddev: 0 },
  };
}

describe("experimentSnapshotMetricResults", () => {
  it("splits and merges round-trip", () => {
    const results: ExperimentReportResultDimension[] = [
      {
        name: "All",
        srm: 1,
        variations: [
          { users: 10, metrics: { a: m("a"), b: m("b") } },
          { users: 10, metrics: { a: m("a"), b: m("b") } },
        ],
      },
      {
        name: "slice:x",
        srm: 1,
        variations: [
          { users: 5, metrics: { a: m("a") } },
          { users: 5, metrics: { a: m("a") } },
        ],
      },
    ];

    const rows = splitAnalysisResultsToMetricResultRows(results, {
      organization: "org",
      snapshotId: "snp",
      analysisIndex: 0,
    });
    expect(rows.length).toBe(3);

    const withIds = rows.map((r, i) => ({
      ...r,
      id: `id_${i}`,
    }));

    const merged = mergeMetricResultRowsToAnalysisResults(withIds);
    expect(merged).toEqual(results);
  });
});
