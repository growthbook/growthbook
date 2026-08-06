import type {
  DataSourceInterfaceWithParams,
  DataSourceSettings,
  DataSourceType,
  ExposureQuery,
  UserIdType,
} from "shared/types/datasource";
import {
  getAutoDatasourceId,
  getAutoExposureQueryId,
} from "@/components/Experiment/SimpleNewExperimentForm";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDatasource(
  id: string,
  projects: string[] = [],
): DataSourceInterfaceWithParams {
  return { id, projects } as DataSourceInterfaceWithParams;
}

function makeExposureQuery(id: string, userIdType: string): ExposureQuery {
  return { id, userIdType } as ExposureQuery;
}

function makeUserIdType(
  userIdType: string,
  attributes: string[] = [],
): UserIdType {
  return { userIdType, attributes };
}

function makeSettings(
  exposure: ExposureQuery[],
  userIdTypes: UserIdType[] = [],
): DataSourceSettings {
  return {
    userIdTypes,
    queries: { exposure },
  } as DataSourceSettings;
}

function makeDatasourceWithSettings(
  settings: DataSourceSettings,
  type: DataSourceType = "postgres",
): DataSourceInterfaceWithParams {
  return {
    id: "ds_1",
    projects: [],
    type,
    settings,
  } as unknown as DataSourceInterfaceWithParams;
}

// ---------------------------------------------------------------------------
// getAutoDatasourceId
// ---------------------------------------------------------------------------

describe("getAutoDatasourceId", () => {
  it("auto-selects the only valid datasource", () => {
    expect(
      getAutoDatasourceId({
        datasources: [makeDatasource("ds_1")],
        demoDataSourceId: null,
        project: "",
      }),
    ).toBe("ds_1");
  });

  it("does not auto-select when multiple valid datasources exist", () => {
    expect(
      getAutoDatasourceId({
        datasources: [makeDatasource("ds_1"), makeDatasource("ds_2")],
        demoDataSourceId: null,
        project: "",
      }),
    ).toBe("");
  });

  it("never auto-selects the demo/sample datasource", () => {
    expect(
      getAutoDatasourceId({
        datasources: [makeDatasource("demo")],
        demoDataSourceId: "demo",
        project: "",
      }),
    ).toBe("");
  });

  it("auto-selects the single real datasource when the demo one is excluded", () => {
    expect(
      getAutoDatasourceId({
        datasources: [makeDatasource("demo"), makeDatasource("ds_1")],
        demoDataSourceId: "demo",
        project: "",
      }),
    ).toBe("ds_1");
  });

  it("filters datasources by project", () => {
    expect(
      getAutoDatasourceId({
        datasources: [
          makeDatasource("ds_1", ["proj_a"]),
          makeDatasource("ds_2", ["proj_b"]),
        ],
        demoDataSourceId: null,
        project: "proj_b",
      }),
    ).toBe("ds_2");
  });

  it("treats a datasource with no project list as valid for any project", () => {
    expect(
      getAutoDatasourceId({
        datasources: [makeDatasource("ds_1", [])],
        demoDataSourceId: null,
        project: "proj_a",
      }),
    ).toBe("ds_1");
  });

  it("prefers the default datasource when there are multiple valid ones", () => {
    expect(
      getAutoDatasourceId({
        datasources: [makeDatasource("ds_1"), makeDatasource("ds_2")],
        demoDataSourceId: null,
        defaultDataSource: "ds_2",
        project: "",
      }),
    ).toBe("ds_2");
  });

  it("ignores the default datasource when it is not valid for the project", () => {
    expect(
      getAutoDatasourceId({
        datasources: [
          makeDatasource("ds_1", ["proj_a"]),
          makeDatasource("ds_2", ["proj_b"]),
        ],
        demoDataSourceId: null,
        defaultDataSource: "ds_1",
        project: "proj_b",
      }),
    ).toBe("ds_2");
  });

  it("uses the template datasource when it is valid", () => {
    expect(
      getAutoDatasourceId({
        datasources: [makeDatasource("ds_1"), makeDatasource("ds_2")],
        demoDataSourceId: null,
        defaultDataSource: "ds_1",
        project: "",
        templateDatasource: "ds_2",
      }),
    ).toBe("ds_2");
  });

  it("falls back to the default datasource when the template datasource is invalid", () => {
    expect(
      getAutoDatasourceId({
        datasources: [makeDatasource("ds_1"), makeDatasource("ds_2")],
        demoDataSourceId: null,
        defaultDataSource: "ds_1",
        project: "",
        templateDatasource: "ds_missing",
      }),
    ).toBe("ds_1");
  });

  it("does not use the template datasource when it is the demo datasource", () => {
    expect(
      getAutoDatasourceId({
        datasources: [makeDatasource("demo"), makeDatasource("ds_1")],
        demoDataSourceId: "demo",
        project: "",
        templateDatasource: "demo",
      }),
    ).toBe("ds_1");
  });
});

// ---------------------------------------------------------------------------
// getAutoExposureQueryId
// ---------------------------------------------------------------------------

describe("getAutoExposureQueryId", () => {
  it("auto-selects the only exposure query", () => {
    expect(
      getAutoExposureQueryId({
        datasource: makeDatasourceWithSettings(
          makeSettings([makeExposureQuery("eq_1", "user_id")]),
        ),
        hashAttribute: "id",
      }),
    ).toBe("eq_1");
  });

  it("does not auto-select when multiple queries are not linked to the hash attribute", () => {
    expect(
      getAutoExposureQueryId({
        datasource: makeDatasourceWithSettings(
          makeSettings([
            makeExposureQuery("eq_1", "user_id"),
            makeExposureQuery("eq_2", "anonymous_id"),
          ]),
        ),
        hashAttribute: "id",
      }),
    ).toBe("");
  });

  it("auto-selects the single query linked to the hash attribute", () => {
    expect(
      getAutoExposureQueryId({
        datasource: makeDatasourceWithSettings(
          makeSettings(
            [
              makeExposureQuery("eq_1", "user_id"),
              makeExposureQuery("eq_2", "anonymous_id"),
            ],
            [
              makeUserIdType("user_id", ["userId"]),
              makeUserIdType("anonymous_id", ["deviceId"]),
            ],
          ),
        ),
        hashAttribute: "userId",
      }),
    ).toBe("eq_1");
  });

  it("does not auto-select when multiple queries are linked to the hash attribute", () => {
    expect(
      getAutoExposureQueryId({
        datasource: makeDatasourceWithSettings(
          makeSettings(
            [
              makeExposureQuery("eq_1", "user_id"),
              makeExposureQuery("eq_2", "logged_in_id"),
            ],
            [
              makeUserIdType("user_id", ["userId"]),
              makeUserIdType("logged_in_id", ["userId"]),
            ],
          ),
        ),
        hashAttribute: "userId",
      }),
    ).toBe("");
  });

  it("uses the template exposure query when it is valid", () => {
    expect(
      getAutoExposureQueryId({
        datasource: makeDatasourceWithSettings(
          makeSettings([
            makeExposureQuery("eq_1", "user_id"),
            makeExposureQuery("eq_2", "anonymous_id"),
          ]),
        ),
        hashAttribute: "id",
        templateExposureQueryId: "eq_2",
      }),
    ).toBe("eq_2");
  });

  it("falls back to auto-selection when the template exposure query is invalid", () => {
    expect(
      getAutoExposureQueryId({
        datasource: makeDatasourceWithSettings(
          makeSettings([makeExposureQuery("eq_1", "user_id")]),
        ),
        hashAttribute: "id",
        templateExposureQueryId: "eq_missing",
      }),
    ).toBe("eq_1");
  });

  it("auto-selects the managed warehouse query the hash attribute folds into", () => {
    // Managed warehouses don't populate userIdType.attributes, but the hash
    // attribute maps to an identifier column (here `id` folds into device_id).
    expect(
      getAutoExposureQueryId({
        datasource: makeDatasourceWithSettings(
          makeSettings([
            makeExposureQuery("user_id", "user_id"),
            makeExposureQuery("device_id", "device_id"),
          ]),
          "growthbook_clickhouse",
        ),
        hashAttribute: "id",
      }),
    ).toBe("device_id");
  });

  it("auto-selects the managed warehouse query for a custom identifier", () => {
    expect(
      getAutoExposureQueryId({
        datasource: makeDatasourceWithSettings(
          makeSettings([
            makeExposureQuery("user_id", "user_id"),
            makeExposureQuery("device_id", "device_id"),
            makeExposureQuery("company_id", "company_id"),
          ]),
          "growthbook_clickhouse",
        ),
        hashAttribute: "company_id",
      }),
    ).toBe("company_id");
  });

  it("does not auto-select a managed warehouse query for an unmapped attribute", () => {
    expect(
      getAutoExposureQueryId({
        datasource: makeDatasourceWithSettings(
          makeSettings([
            makeExposureQuery("user_id", "user_id"),
            makeExposureQuery("device_id", "device_id"),
          ]),
          "growthbook_clickhouse",
        ),
        hashAttribute: "some_non_identifier",
      }),
    ).toBe("");
  });
});
