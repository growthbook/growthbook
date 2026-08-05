import type { ExperimentUnitsQuerySettings } from "shared/types/integrations";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { getContextualBanditSrmQuery } from "back-end/src/integrations/sql/queries/contextual-bandit-srm-query";

const defaultExposureQuery = {
  query:
    "SELECT user_id, timestamp, experiment_id, variation_id, leaf_id, bandit_version, variation_weights FROM cb_assignments",
  userIdType: "user_id",
};

function makeSettings(
  overrides: Partial<ExperimentUnitsQuerySettings> = {},
): ExperimentUnitsQuerySettings {
  return {
    experimentId: "exp_1",
    exposureQuery: defaultExposureQuery,
    startDate: new Date("2025-01-01T00:00:00.000Z"),
    endDate: new Date("2025-02-01T00:00:00.000Z"),
    variations: [
      { id: "var_control", weight: 0.5 },
      { id: "var_treatment", weight: 0.5 },
    ],
    ...overrides,
  } as unknown as ExperimentUnitsQuerySettings;
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, "");
}

describe("getContextualBanditSrmQuery", () => {
  it("builds the SRM query with per-variation observed/expected cells", () => {
    const sql = getContextualBanditSrmQuery(postgresDialect, {
      settings: makeSettings(),
    });
    const c = compact(sql);

    expect(c).toContain("__rawExperiment");
    expect(c).toContain("e.experiment_id='exp_1'");
    expect(c).toContain("e.timestamp>=");

    expect(c).toContain("e.variation_weights[1]ASw_0");
    expect(c).toContain("e.variation_weights[2]ASw_1");

    expect(c).toContain(
      "ROW_NUMBER()OVER(PARTITIONBYuid,leaf_id,bandit_versionORDERBYtimestampASC)",
    );
    expect(c).toContain("__rn=1");

    expect(c).toContain(
      "MIN(variation)OVER(PARTITIONBYuid,leaf_id,bandit_version)AS__min_variation",
    );
    expect(c).toContain(
      "MAX(variation)OVER(PARTITIONBYuid,leaf_id,bandit_version)AS__max_variation",
    );
    expect(c).toContain("__min_variation=__max_variation");

    expect(c).toContain("variation='0'");
    expect(c).toContain("variation='1'");
    expect(c).not.toContain("var_control");
    expect(c).not.toContain("var_treatment");
    expect(c).toContain("ASobserved_0");
    expect(c).toContain("ASexpected_0");
    expect(c).toContain("ASobserved_1");
    expect(c).toContain("ASexpected_1");

    expect(c).toContain("UNIONALL");
    expect(c).toContain(
      "SELECTleaf_id,bandit_version,observed_0ASobserved,expected_0ASexpected",
    );

    expect(c).toContain("WHEREexpected>=5");

    expect(c).toContain("HAVINGCOUNT(*)>=2");

    expect(c).toContain("POW(observed-expected,2)/expected");

    expect(c).toContain(
      "COALESCE(SUM(num_valid_cells),0)-COUNT(*)ASdegrees_of_freedom",
    );
    expect(c).toContain("ASdegrees_of_freedom");

    // Latest-period breakdown: a summary row plus one cell row per leaf/variation
    // for the most recent bandit_version, discriminated by row_type. The latest
    // period is chosen by most-recent exposure timestamp, not by ordering the
    // free-form bandit_version column (which could sort '9' after '10').
    expect(c).toContain("MAX(timestamp)ASlatest_ts");
    expect(c).toContain("ROW_NUMBER()OVER(ORDERBYMAX(latest_ts)DESC)AS__vrn");
    expect(c).toContain("__cbLatestVersion");
    expect(c).toContain("__cbLatestBreakdown");
    expect(c).toContain("ASrow_type");
    expect(c).toContain("'summary'");
    expect(c).toContain("'cell'");
    expect(c).toContain(
      "JOIN__cbLatestVersionvON(a.bandit_version=v.bandit_version)",
    );
  });

  it("emits one observed/expected pair and array index per variation", () => {
    const sql = getContextualBanditSrmQuery(postgresDialect, {
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
    expect(c).not.toContain("num_variations");
    // __cbCells (3 SELECTs => 2) + __cbLatestBreakdown (3 SELECTs => 2) +
    // the summary/breakdown union (1) = 5.
    expect(sql.match(/UNION ALL/gi)?.length).toBe(5);
  });

  it("omits the upper time bound when endDate is not set", () => {
    const sql = getContextualBanditSrmQuery(postgresDialect, {
      settings: makeSettings({ endDate: undefined }),
    });
    const c = compact(sql);

    expect(c).toContain("e.timestamp>=");
    expect(c).not.toContain("e.timestamp<=");
  });

  it("throws when there are no variations", () => {
    expect(() =>
      getContextualBanditSrmQuery(postgresDialect, {
        settings: makeSettings({ variations: [] }),
      }),
    ).toThrow(/at least one variation/);
  });

  it("uses the resolved exposure query for the assignment query SQL + identifier type", () => {
    const sql = getContextualBanditSrmQuery(postgresDialect, {
      settings: makeSettings({
        exposureQuery: {
          query: "SELECT * FROM my_cb_assignments",
          userIdType: "anonymous_id",
        },
      }),
    });
    const c = compact(sql);

    expect(c).toContain("SELECT*FROMmy_cb_assignments");
    expect(c).toContain("e.anonymous_idASuid");
  });
});
