import { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import {
  canonicalizeVariationIdsInRows,
  filterMetricQueryRowsForStatsEngine,
  prepareRowsForContextualStats,
} from "back-end/src/enterprise/services/contextualBanditStats";

jest.mock("back-end/src/services/stats", () => ({
  getAnalysisSettingsForStatsEngine: jest.fn(),
  getMetricSettingsForStatsEngine: jest.fn(),
  runStatsEngine: jest.fn(),
}));

function rows(
  data: Record<string, string | number>[],
): ExperimentMetricQueryResponseRows {
  return data as unknown as ExperimentMetricQueryResponseRows;
}

describe("canonicalizeVariationIdsInRows", () => {
  const varIds = ["v0", "v1"];

  it("maps numeric variation keys to variation ids", () => {
    const result = canonicalizeVariationIdsInRows(
      rows([
        { variation: "0", users: 10 },
        { variation: "1", users: 20 },
      ]),
      varIds,
    );
    expect(result.map((r) => r.variation)).toEqual(["v0", "v1"]);
  });

  it("leaves rows that already use variation ids unchanged", () => {
    const result = canonicalizeVariationIdsInRows(
      rows([{ variation: "v1", users: 5 }]),
      varIds,
    );
    expect(result[0].variation).toBe("v1");
  });

  it("leaves rows with an unknown / out-of-range variation untouched", () => {
    const result = canonicalizeVariationIdsInRows(
      rows([
        { variation: "xyz", users: 1 },
        { variation: "5", users: 2 },
      ]),
      varIds,
    );
    expect(result.map((r) => r.variation)).toEqual(["xyz", "5"]);
  });

  it("does not mutate the input rows", () => {
    const input = rows([{ variation: "0", users: 10 }]);
    canonicalizeVariationIdsInRows(input, varIds);
    expect(input[0].variation).toBe("0");
  });
});

describe("filterMetricQueryRowsForStatsEngine", () => {
  it("strips the target metric prefix and drops other metric columns", () => {
    const result = filterMetricQueryRowsForStatsEngine(
      rows([
        {
          variation: "0",
          users: 100,
          m0_sum: 5,
          m0_count: 100,
          m1_sum: 9,
        },
      ]),
      0,
    );
    expect(result[0]).toEqual({
      variation: "0",
      users: 100,
      sum: 5,
      count: 100,
    });
    expect(result[0]).not.toHaveProperty("m1_sum");
  });

  it("respects a non-zero metric index", () => {
    const result = filterMetricQueryRowsForStatsEngine(
      rows([{ variation: "0", m0_sum: 1, m1_sum: 2 }]),
      1,
    );
    expect(result[0]).toEqual({ variation: "0", sum: 2 });
  });
});

describe("prepareRowsForContextualStats", () => {
  it("filters fact-metric rows (m0_id present) down to bare metric columns", () => {
    const result = prepareRowsForContextualStats(
      rows([
        {
          variation: "0",
          users: 10,
          m0_id: "met_1",
          m0_sum: 4,
          m1_sum: 8,
        },
      ]),
    );
    expect(result[0]).toEqual({
      variation: "0",
      users: 10,
      sum: 4,
      id: "met_1",
    });
  });

  it("passes non-fact rows through unchanged", () => {
    const result = prepareRowsForContextualStats(
      rows([{ variation: "0", users: 10, main_sum: 2 }]),
    );
    expect(result[0]).toEqual({ variation: "0", users: 10, main_sum: 2 });
  });

  it("handles an empty row set", () => {
    expect(prepareRowsForContextualStats(rows([]))).toEqual([]);
  });
});
