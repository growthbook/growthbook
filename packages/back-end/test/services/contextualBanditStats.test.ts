import { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import { contextualBanditAttrCol } from "shared/experiments";
import {
  buildContextualBanditObservations,
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

describe("buildContextualBanditObservations", () => {
  const varIds = ["v0", "v1"];

  it("maps numeric variation keys to variation indexes", () => {
    const result = buildContextualBanditObservations(
      rows([
        { variation: "0", count: 10 },
        { variation: "1", count: 20 },
      ]),
      { varIds, attributes: [] },
    );
    expect(result.map((o) => o.variationIndex)).toEqual([0, 1]);
  });

  it("maps variation ids to variation indexes", () => {
    const result = buildContextualBanditObservations(
      rows([{ variation: "v1", count: 5 }]),
      { varIds, attributes: [] },
    );
    expect(result[0].variationIndex).toBe(1);
  });

  it("drops rows with an unknown / out-of-range variation", () => {
    const result = buildContextualBanditObservations(
      rows([
        { variation: "xyz", count: 1 },
        { variation: "5", count: 2 },
      ]),
      { varIds, attributes: [] },
    );
    expect(result).toEqual([]);
  });

  it("keys the context by the configured attribute name when the warehouse folded the column's case", () => {
    // The attribute is configured as "Country", but we emit the alias unquoted,
    // so warehouses that fold identifiers return it as `attr_cb_country`. The
    // context must still resolve, and under the configured name.
    const result = buildContextualBanditObservations(
      rows([
        {
          variation: "0",
          count: 10,
          [contextualBanditAttrCol("country")]: "US",
        },
      ]),
      { varIds, attributes: ["Country"] },
    );
    expect(result[0].context).toEqual({ Country: "US" });
  });

  it("falls back to the bare attribute column", () => {
    const result = buildContextualBanditObservations(
      rows([{ variation: "0", count: 10, country: "US" }]),
      { varIds, attributes: ["country"] },
    );
    expect(result[0].context).toEqual({ country: "US" });
  });

  it("stringifies numeric attribute values", () => {
    const result = buildContextualBanditObservations(
      rows([
        { variation: "0", count: 10, [contextualBanditAttrCol("age")]: 30 },
      ]),
      { varIds, attributes: ["age"] },
    );
    expect(result[0].context).toEqual({ age: "30" });
  });

  it("omits attributes the row has no value for", () => {
    const result = buildContextualBanditObservations(
      rows([
        {
          variation: "0",
          count: 10,
          [contextualBanditAttrCol("country")]: "US",
        },
      ]),
      { varIds, attributes: ["country", "device"] },
    );
    expect(result[0].context).toEqual({ country: "US" });
  });

  it("reads the metric moments, preferring count over users for units", () => {
    const result = buildContextualBanditObservations(
      rows([
        {
          variation: "0",
          count: 10,
          users: 99,
          main_sum: 5,
          main_sum_squares: 7,
        },
      ]),
      { varIds, attributes: [] },
    );
    expect(result[0].arm).toEqual({
      n: 10,
      main_sum: 5,
      main_sum_squares: 7,
      denominator_sum: 0,
      denominator_sum_squares: 0,
      main_denominator_sum_product: 0,
      covariate_sum: 0,
      covariate_sum_squares: 0,
      main_covariate_sum_product: 0,
    });
  });

  it("falls back to users when the row has no count", () => {
    const result = buildContextualBanditObservations(
      rows([{ variation: "0", users: 42, main_sum: 1 }]),
      { varIds, attributes: [] },
    );
    expect(result[0].arm.n).toBe(42);
  });

  it("strips the metric column prefix off fact-metric rows", () => {
    const result = buildContextualBanditObservations(
      rows([
        {
          variation: "0",
          users: 10,
          m0_id: "met_1",
          m0_main_sum: 5,
          m1_main_sum: 99,
        },
      ]),
      { varIds, attributes: [] },
    );
    expect(result[0].arm.main_sum).toBe(5);
  });

  it("handles an empty row set", () => {
    expect(
      buildContextualBanditObservations(rows([]), { varIds, attributes: [] }),
    ).toEqual([]);
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
