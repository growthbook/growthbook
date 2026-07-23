import type { DataSourceInterface } from "shared/types/datasource";
import type {
  ExperimentUnitsQueryParams,
  ExperimentUnitsQuerySettings,
} from "shared/types/integrations";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";

const datasource = {
  settings: {},
} as unknown as DataSourceInterface;

const cbExposureQuery = {
  query:
    "SELECT user_id, timestamp, experiment_id, variation_id, leaf_id, bandit_version, variation_weights FROM cb_assignments",
  userIdType: "user_id",
};

function makeUnitsSettings(
  overrides: Partial<ExperimentUnitsQuerySettings> = {},
): ExperimentUnitsQuerySettings {
  return {
    experimentId: "exp_1",
    exposureQuery: cbExposureQuery,
    startDate: new Date("2025-01-01T00:00:00.000Z"),
    endDate: new Date("2025-02-01T00:00:00.000Z"),
    attributionModel: "firstExposure",
    queryFilter: "",
    variations: [
      { id: "var_control", weight: 0.5 },
      { id: "var_treatment", weight: 0.5 },
    ],
    metricSettings: [],
    ...overrides,
  } as unknown as ExperimentUnitsQuerySettings;
}

function makeParams(
  unitsSettings: ExperimentUnitsQuerySettings,
): ExperimentUnitsQueryParams {
  return {
    unitsSettings,
    activationMetric: null,
    factTableMap: new Map(),
    dimensions: [],
    segment: null,
    includeIdJoins: true,
  };
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, "");
}

describe("getExperimentUnitsQuery contextual bandit multiple exposures", () => {
  it("scopes __multiple__ detection to a single bandit_version", () => {
    const sql = getExperimentUnitsQuery(
      postgresDialect,
      datasource,
      makeParams(
        makeUnitsSettings({
          banditSettings: {
            contextualBandit: true,
          },
        } as unknown as Partial<ExperimentUnitsQuerySettings>),
      ),
    );
    const c = compact(sql);

    expect(c).toContain("e.bandit_versionASbandit_version");
    expect(c).toContain("__cbMultipleExposuresByVersionAS");
    expect(c).toContain("COUNT(DISTINCTe.variation)AS__num_variations");
    expect(c).toContain("GROUPBYe.user_id,e.bandit_version");
    expect(c).toContain(
      "MAX(pv.__num_variations)AS__max_variations_per_version",
    );
    expect(c).toContain(
      "LEFTJOIN__cbMultipleExposuresByVersionmultON(mult.user_id=e.user_id)",
    );
    expect(c).toContain("MAX(mult.__max_variations_per_version)>1");

    // The global (un-scoped) multiple-exposure rule must NOT be used for CBs.
    expect(c).not.toContain("count(distincte.variation)>1");
  });

  it("uses the global multiple-exposure rule for standard experiments", () => {
    const sql = getExperimentUnitsQuery(
      postgresDialect,
      datasource,
      makeParams(makeUnitsSettings()),
    );
    const c = compact(sql);

    expect(c).toContain("count(distincte.variation)>1");
    expect(c).not.toContain("__cbMultipleExposuresByVersion");
    expect(c).not.toContain("bandit_versionASbandit_version");
  });

  it("does not detect multiple exposures when the assignment query omits bandit_version", () => {
    const sql = getExperimentUnitsQuery(
      postgresDialect,
      datasource,
      makeParams(
        makeUnitsSettings({
          exposureQuery: {
            query:
              "SELECT user_id, timestamp, experiment_id, variation_id FROM cb_assignments",
            userIdType: "user_id",
          },
          banditSettings: {
            contextualBandit: true,
          },
        } as unknown as Partial<ExperimentUnitsQuerySettings>),
      ),
    );
    const c = compact(sql);

    // Contextual bandits without a bandit_version can't scope multiple-exposure
    // detection to a period, so we must not flag __multiple__ at all.
    expect(c).not.toContain("'__multiple__'");
    expect(c).not.toContain("count(distincte.variation)>1");
    expect(c).not.toContain("__cbMultipleExposuresByVersion");
  });
});
