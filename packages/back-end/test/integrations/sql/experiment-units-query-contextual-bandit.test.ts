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

describe("getExperimentUnitsQuery contextual bandit bandit_version splitting", () => {
  it("splits units by (user, bandit_version) and scopes __multiple__ within a version", () => {
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

    // bandit_version is carried through and becomes part of the unit grain.
    expect(c).toContain("e.bandit_versionASbandit_version");
    expect(c).toContain("GROUPBYe.user_id,e.bandit_version");

    // Within a single (user, bandit_version) group, >1 distinct variation
    // flags the unit as __multiple__.
    expect(c).toContain("count(distincte.variation)>1");
    expect(c).toContain("'__multiple__'");

    // The old per-user pre-aggregation used to scope multiple exposures is
    // no longer needed now that units are grouped by (user, bandit_version).
    expect(c).not.toContain("__cbMultipleExposuresByVersion");
    expect(c).not.toContain("__max_variations_per_version");
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
