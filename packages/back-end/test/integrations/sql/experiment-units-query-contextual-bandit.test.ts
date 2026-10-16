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

describe("getExperimentUnitsQuery contextual bandit first-exposure attribution", () => {
  it("attributes each user to their first exposure (one unit per user, no version splitting)", () => {
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

    // Each user collapses to their earliest exposure's variation.
    expect(c).toContain("SUBSTRING(MIN(CONCAT(");

    // Units are one-per-user: never split by (user, bandit_version) and never
    // bucketed as __multiple__.
    expect(c).not.toContain("e.bandit_versionASbandit_version");
    expect(c).not.toContain("GROUPBYe.user_id,e.bandit_version");
    expect(c).not.toContain("'__multiple__'");
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
    expect(c).toContain("'__multiple__'");
    expect(c).not.toContain("SUBSTRING(MIN(CONCAT(");
    expect(c).not.toContain("e.bandit_versionASbandit_version");
  });

  it("uses first-exposure attribution even when the assignment query omits bandit_version", () => {
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

    // Contextual bandits always attribute to the first exposure, so we never
    // flag __multiple__ regardless of whether bandit_version is present.
    expect(c).toContain("SUBSTRING(MIN(CONCAT(");
    expect(c).not.toContain("'__multiple__'");
    expect(c).not.toContain("count(distincte.variation)>1");
  });
});
