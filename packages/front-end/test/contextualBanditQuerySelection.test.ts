import type {
  DataSourceInterfaceWithParams,
  DataSourceType,
} from "shared/types/datasource";
import { getDefaultContextualBanditQueryId } from "@/services/contextualBandits";

function makeDatasource(
  type: DataSourceType,
  settings: Record<string, unknown> = {},
): DataSourceInterfaceWithParams {
  return {
    id: "ds_1",
    projects: [],
    type,
    settings,
  } as unknown as DataSourceInterfaceWithParams;
}

const managedQueries = [
  { id: "cbq_user", userIdType: "user_id" },
  { id: "cbq_device", userIdType: "device_id" },
  { id: "cbq_company", userIdType: "company_id" },
];

describe("getDefaultContextualBanditQueryId", () => {
  it("returns nothing without a datasource or queries", () => {
    expect(
      getDefaultContextualBanditQueryId({
        datasource: null,
        hashAttribute: "id",
        queries: managedQueries,
      }),
    ).toBe("");
    expect(
      getDefaultContextualBanditQueryId({
        datasource: makeDatasource("growthbook_clickhouse"),
        hashAttribute: "id",
        queries: [],
      }),
    ).toBe("");
  });

  it("falls back to the first query on other data sources", () => {
    expect(
      getDefaultContextualBanditQueryId({
        datasource: makeDatasource("postgres"),
        hashAttribute: "company_id",
        queries: managedQueries,
      }),
    ).toBe("cbq_user");
  });

  it("maps the hash attribute to its identifier's query on a managed warehouse", () => {
    const datasource = makeDatasource("growthbook_clickhouse", {
      useJsonColumns: true,
    });
    expect(
      getDefaultContextualBanditQueryId({
        datasource,
        hashAttribute: "id",
        queries: managedQueries,
      }),
    ).toBe("cbq_device");
    expect(
      getDefaultContextualBanditQueryId({
        datasource,
        hashAttribute: undefined,
        queries: managedQueries,
      }),
    ).toBe("cbq_device");
    expect(
      getDefaultContextualBanditQueryId({
        datasource,
        hashAttribute: "user_id",
        queries: managedQueries,
      }),
    ).toBe("cbq_user");
    expect(
      getDefaultContextualBanditQueryId({
        datasource,
        hashAttribute: "company_id",
        queries: managedQueries,
      }),
    ).toBe("cbq_company");
  });

  it("honors the org's id attribute mapping", () => {
    expect(
      getDefaultContextualBanditQueryId({
        datasource: makeDatasource("growthbook_clickhouse", {
          useJsonColumns: true,
          idAttributeIdentifier: "user_id",
        }),
        hashAttribute: "id",
        queries: managedQueries,
      }),
    ).toBe("cbq_user");
  });

  it("does not fall back to an arbitrary query on a managed warehouse", () => {
    expect(
      getDefaultContextualBanditQueryId({
        datasource: makeDatasource("growthbook_clickhouse", {
          useJsonColumns: true,
        }),
        hashAttribute: "some_non_identifier",
        queries: managedQueries,
      }),
    ).toBe("");
  });
});
