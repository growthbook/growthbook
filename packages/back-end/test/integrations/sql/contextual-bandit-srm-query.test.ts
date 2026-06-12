import type { DataSourceInterface } from "shared/types/datasource";
import type { SnapshotMetricRequest } from "shared/types/experiment-snapshot";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { getContextualBanditSrmQuery } from "back-end/src/integrations/sql/queries/contextual-bandit-srm-query";

function makeDatasource(): DataSourceInterface {
  return {
    settings: {
      queries: {
        exposure: [
          {
            id: "eq1",
            name: "EAQ",
            userIdType: "user_id",
            query:
              "SELECT user_id, timestamp, experiment_id, variation_id, leaf_id, snapshot_update_count, variation_weights FROM exposures",
            dimensions: [],
            contextualBandit: true,
            targetingAttributeColumns: ["country"],
          },
        ],
      },
    },
  } as unknown as DataSourceInterface;
}

function makeSettings(
  overrides: Partial<SnapshotMetricRequest> = {},
): SnapshotMetricRequest {
  return {
    experimentId: "exp_1",
    exposureQueryId: "eq1",
    startDate: new Date("2025-01-01T00:00:00.000Z"),
    endDate: new Date("2025-02-01T00:00:00.000Z"),
    variations: [
      { id: "var_control", weight: 0.5 },
      { id: "var_treatment", weight: 0.5 },
    ],
    ...overrides,
  } as unknown as SnapshotMetricRequest;
}

/** Whitespace-insensitive view of the formatted SQL for stable substring assertions. */
function compact(sql: string): string {
  return sql.replace(/\s+/g, "");
}

describe("getContextualBanditSrmQuery", () => {
  it("builds the SRM query with per-variation observed/expected cells", () => {
    const sql = getContextualBanditSrmQuery(postgresDialect, makeDatasource(), {
      settings: makeSettings(),
    });
    const c = compact(sql);

    // Exposure CTE + experiment/window filter
    expect(c).toContain("__rawExperiment");
    expect(c).toContain("e.experiment_id='exp_1'");
    expect(c).toContain("e.timestamp>=");

    // Per-variation weight extraction via dialect.arrayElement (postgres: 1-based)
    expect(c).toContain("e.variation_weights[1]ASw_0");
    expect(c).toContain("e.variation_weights[2]ASw_1");

    // First-exposure-per-cell selection
    expect(c).toContain(
      "ROW_NUMBER()OVER(PARTITIONBYuid,leaf_id,snapshot_update_countORDERBYtimestampASC)",
    );
    expect(c).toContain("__rn=1");

    // observed/expected matched on 0-based variation index, NOT the var_ id
    expect(c).toContain("variation='0'");
    expect(c).toContain("variation='1'");
    expect(c).not.toContain("var_control");
    expect(c).not.toContain("var_treatment");
    expect(c).toContain("ASobserved_0");
    expect(c).toContain("ASexpected_0");
    expect(c).toContain("ASobserved_1");
    expect(c).toContain("ASexpected_1");

    // Cells unpivoted, then chi-square statistic + dof inputs
    expect(c).toContain("UNIONALL");
    expect(c).toContain("POW(observed-expected,2)/expected");
    expect(c).toContain("expected>0");
    expect(c).toContain("COUNT(DISTINCTleaf_id)ASnum_leaves");
    expect(c).toContain("COUNT(DISTINCTsnapshot_update_count)ASnum_updates");
    expect(c).toContain("2ASnum_variations");
    expect(c).not.toContain("num_cells");
  });

  it("emits one observed/expected pair and array index per variation", () => {
    const sql = getContextualBanditSrmQuery(postgresDialect, makeDatasource(), {
      settings: makeSettings({
        variations: [
          { id: "var_a", weight: 0.34 },
          { id: "var_b", weight: 0.33 },
          { id: "var_c", weight: 0.33 },
        ],
      }),
    });
    const c = compact(sql);

    expect(c).toContain("e.variation_weights[3]ASw_2");
    expect(c).toContain("ASobserved_2");
    expect(c).toContain("ASexpected_2");
    expect(c).toContain("3ASnum_variations");
    // 3 variations => 3 UNION ALL'd cell rows (2 separators)
    expect(sql.match(/UNION ALL/gi)?.length).toBe(2);
  });

  it("omits the upper time bound when endDate is not set", () => {
    const sql = getContextualBanditSrmQuery(postgresDialect, makeDatasource(), {
      settings: makeSettings({ endDate: undefined }),
    });
    const c = compact(sql);

    expect(c).toContain("e.timestamp>=");
    expect(c).not.toContain("e.timestamp<=");
  });

  it("throws when there are no variations", () => {
    expect(() =>
      getContextualBanditSrmQuery(postgresDialect, makeDatasource(), {
        settings: makeSettings({ variations: [] }),
      }),
    ).toThrow(/at least one variation/);
  });
});
