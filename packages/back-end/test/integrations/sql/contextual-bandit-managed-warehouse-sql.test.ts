import type { DataSourceInterface } from "shared/types/datasource";
import type {
  ExperimentUnitsQueryParams,
  ExperimentUnitsQuerySettings,
} from "shared/types/integrations";
import { SDKAttributeSchema } from "shared/types/organization";
import { clickHouseDialect } from "shared/dialects";
import {
  buildManagedWarehouseContextualBanditQueries,
  getManagedWarehouseUserIdTypeSettings,
} from "shared/util";
import { queryHasContextualBanditSrmColumns } from "shared/validators";
import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";

const schema: SDKAttributeSchema = [
  { property: "id", datatype: "string", hashAttribute: true },
  { property: "company_id", datatype: "string", hashAttribute: true },
  { property: "url", datatype: "string" },
  { property: "country", datatype: "string" },
  { property: "deviceType", datatype: "enum", enum: "desktop,mobile" },
  { property: "utmSource", datatype: "string" },
  { property: "plan", datatype: "number" },
];

const datasource = {
  type: "growthbook_clickhouse",
  settings: {
    useJsonColumns: true,
    userIdTypes: getManagedWarehouseUserIdTypeSettings(schema),
  },
} as unknown as DataSourceInterface;

const cbQueries = buildManagedWarehouseContextualBanditQueries(schema);

function makeParams(
  cbQuery: (typeof cbQueries)[number],
  overrides: Partial<ExperimentUnitsQuerySettings> = {},
): ExperimentUnitsQueryParams {
  const unitsSettings = {
    experimentId: "checkout-layout",
    exposureQuery: { query: cbQuery.query, identifierType: cbQuery.userIdType },
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2026-02-01T00:00:00.000Z"),
    attributionModel: "firstExposure",
    queryFilter: "",
    variations: [
      { id: "var_control", weight: 0.5 },
      { id: "var_treatment", weight: 0.5 },
    ],
    metricSettings: [],
    banditSettings: {
      contextualBandit: true,
      targetingAttributeColumns: cbQuery.targetingAttributeColumns,
    },
    ...overrides,
  } as unknown as ExperimentUnitsQuerySettings;
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

describe("managed warehouse contextual bandit units query (ClickHouse)", () => {
  const userIdQuery = cbQueries.find((q) => q.userIdType === "user_id")!;
  const companyQuery = cbQueries.find((q) => q.userIdType === "company_id")!;

  it("compiles the generated query's template variables", () => {
    const sql = getExperimentUnitsQuery(
      clickHouseDialect,
      datasource,
      makeParams(userIdQuery),
    );
    expect(sql).not.toContain("{{");
    expect(sql).toContain("experiment_id LIKE 'checkout-layout'");
    expect(sql).toContain("FROM experiment_views");
  });

  it("passes every generated targeting column through to the units CTEs", () => {
    const sql = getExperimentUnitsQuery(
      clickHouseDialect,
      datasource,
      makeParams(userIdQuery),
    );
    const c = compact(sql);
    expect(userIdQuery.targetingAttributeColumns).toEqual([
      "country",
      "deviceType",
      "utmSource",
    ]);
    userIdQuery.targetingAttributeColumns.forEach((col) => {
      expect(c).toContain(`,e.${col}`);
      expect(c).toContain(`ASattr_cb_raw_${col}`);
      expect(c).toContain(`ASattr_cb_${col}`);
    });
    expect(c).toContain("attributes.country::Nullable(String)AScountry");
    expect(c).toContain("nullIf(utm_source,'')ASutmSource");
    expect(c).not.toContain("ASplan");
    expect(c).not.toContain("ASurl");
  });

  it("uses ClickHouse functions for the first-exposure attribute values and context bucketing", () => {
    const sql = getExperimentUnitsQuery(
      clickHouseDialect,
      datasource,
      makeParams(userIdQuery),
    );
    const c = compact(sql);
    expect(c).toContain("formatDateTime(e.timestamp,'%Y-%m-%d%H:%i:%S.%f')");
    expect(c).toContain(
      "coalesce(toString(e.country),toString('__NULL_ATTRIBUTE'))",
    );
    expect(c).toContain("ROW_NUMBER()OVER(ORDERBY__attr_cb_user_cntDESC)");
    expect(c).toContain("if(COALESCE(cc.__attr_cb_ctx_rn,999999999)<=");
    expect(c).toContain("toString('Combined'))ASattr_cb_country");
    expect(c).toContain("toDateTime('2026-01-0100:00:00','UTC')");
    expect(c).not.toContain("::text");
    expect(c).not.toContain("CASEWHEN");
  });

  it("reads the identifier the query was generated for and needs no identity join", () => {
    const sql = getExperimentUnitsQuery(
      clickHouseDialect,
      datasource,
      makeParams(companyQuery),
    );
    const c = compact(sql);
    expect(c).toContain("attributes.company_id::Nullable(String)AScompany_id");
    expect(c).toContain("e.company_idAScompany_id");
    expect(c).not.toContain("__identities");
    expect(c).not.toContain("'__multiple__'");
  });

  it("does not select the SRM columns, so SRM is skipped for now", () => {
    expect(
      queryHasContextualBanditSrmColumns(
        userIdQuery.query,
        clickHouseDialect.identifierQuote,
      ),
    ).toBe(false);
  });
});
