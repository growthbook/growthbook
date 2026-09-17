import { explorationConfigReferencesColumn } from "shared/enterprise";
import { ExplorationConfig } from "shared/validators";

const baseConfig = {
  datasource: "ds1",
  dimensions: [],
  chartType: "bar" as const,
  dateRange: { predefined: "last7Days" as const },
};

function factTableConfig(
  values: Array<{
    valueColumn?: string | null;
    rowFilters?: Array<{
      operator: string;
      column?: string;
      values?: string[];
    }>;
  }>,
  dimensions: unknown[] = [],
): ExplorationConfig {
  return {
    ...baseConfig,
    dimensions,
    type: "fact_table",
    dataset: {
      type: "fact_table",
      factTableId: "ft1",
      values: values.map((v, i) => ({
        type: "fact_table",
        name: `v${i}`,
        valueType: "sum",
        unit: null,
        valueColumn: v.valueColumn ?? null,
        rowFilters: v.rowFilters ?? [],
      })),
    },
  } as ExplorationConfig;
}

describe("explorationConfigReferencesColumn", () => {
  const filters = [{ id: "flt_1", value: "margin_vc > 0" }];

  it("detects a direct valueColumn reference", () => {
    const config = factTableConfig([{ valueColumn: "margin_vc" }]);
    expect(
      explorationConfigReferencesColumn(config, "ft1", "margin_vc", '"', []),
    ).toBe(true);
  });

  it("ignores a config on a different fact table", () => {
    const config = factTableConfig([{ valueColumn: "margin_vc" }]);
    expect(
      explorationConfigReferencesColumn(config, "other", "margin_vc", '"', []),
    ).toBe(false);
  });

  it("detects a sql_expr row filter reference", () => {
    const config = factTableConfig([
      { rowFilters: [{ operator: "sql_expr", values: ["margin_vc > 5"] }] },
    ]);
    expect(
      explorationConfigReferencesColumn(config, "ft1", "margin_vc", '"', []),
    ).toBe(true);
  });

  it("detects a saved_filter reference by resolving the filter SQL", () => {
    const config = factTableConfig([
      { rowFilters: [{ operator: "saved_filter", values: ["flt_1"] }] },
    ]);
    expect(
      explorationConfigReferencesColumn(
        config,
        "ft1",
        "margin_vc",
        '"',
        filters,
      ),
    ).toBe(true);
  });

  it("does not match when the saved filter references a different column", () => {
    const config = factTableConfig([
      { rowFilters: [{ operator: "saved_filter", values: ["flt_1"] }] },
    ]);
    expect(
      explorationConfigReferencesColumn(
        config,
        "ft1",
        "revenue_vc",
        '"',
        filters,
      ),
    ).toBe(false);
  });
});
