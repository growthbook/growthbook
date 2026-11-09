import type {
  DataSourceInterfaceWithParams,
  DataSourceType,
} from "shared/types/datasource";
import {
  contextualBanditQueryPickerLocked,
  getDefaultContextualBanditQueryId,
  managedWarehouseHashAttributeHint,
  managedWarehouseQueryHelpText,
  resolveContextualBanditQuerySelection,
} from "@/services/contextualBandits";

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
  { id: "cbq_user", userIdType: "user_id", managedBy: "api" as const },
  { id: "cbq_device", userIdType: "device_id", managedBy: "api" as const },
  { id: "cbq_company", userIdType: "company_id", managedBy: "api" as const },
];
const customQuery = { id: "cbq_custom", userIdType: "device_id" };
const jsonWarehouse = makeDatasource("growthbook_clickhouse", {
  useJsonColumns: true,
});
const legacyWarehouse = makeDatasource("growthbook_clickhouse", {
  materializedColumns: [],
});

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

  it("prefers the generated query but falls back to a custom one", () => {
    expect(
      getDefaultContextualBanditQueryId({
        datasource: jsonWarehouse,
        hashAttribute: "id",
        queries: [customQuery, ...managedQueries],
      }),
    ).toBe("cbq_device");
    expect(
      getDefaultContextualBanditQueryId({
        datasource: jsonWarehouse,
        hashAttribute: "id",
        queries: [customQuery],
      }),
    ).toBe("cbq_custom");
  });

  it("treats a legacy managed warehouse like any other data source", () => {
    expect(
      getDefaultContextualBanditQueryId({
        datasource: legacyWarehouse,
        hashAttribute: "company_id",
        queries: [customQuery, ...managedQueries],
      }),
    ).toBe("cbq_custom");
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

describe("resolveContextualBanditQuerySelection", () => {
  it("keeps a custom selection and a matching generated selection", () => {
    expect(
      resolveContextualBanditQuerySelection({
        datasource: jsonWarehouse,
        hashAttribute: "id",
        queries: [customQuery, ...managedQueries],
        selectedQueryId: "cbq_custom",
      }),
    ).toBe("cbq_custom");
    expect(
      resolveContextualBanditQuerySelection({
        datasource: jsonWarehouse,
        hashAttribute: "user_id",
        queries: [customQuery, ...managedQueries],
        selectedQueryId: "cbq_user",
      }),
    ).toBe("cbq_user");
  });

  it("re-points a generated selection that no longer matches the hash attribute", () => {
    expect(
      resolveContextualBanditQuerySelection({
        datasource: jsonWarehouse,
        hashAttribute: "company_id",
        queries: [customQuery, ...managedQueries],
        selectedQueryId: "cbq_device",
      }),
    ).toBe("cbq_company");
  });

  it("falls back to a custom query when no generated query matches", () => {
    expect(
      resolveContextualBanditQuerySelection({
        datasource: jsonWarehouse,
        hashAttribute: "not_an_identifier",
        queries: [customQuery, ...managedQueries],
        selectedQueryId: "cbq_device",
      }),
    ).toBe("cbq_custom");
    expect(
      resolveContextualBanditQuerySelection({
        datasource: jsonWarehouse,
        hashAttribute: "not_an_identifier",
        queries: managedQueries,
        selectedQueryId: "cbq_device",
      }),
    ).toBe("");
  });

  it("defaults when nothing valid is selected", () => {
    expect(
      resolveContextualBanditQuerySelection({
        datasource: jsonWarehouse,
        hashAttribute: "company_id",
        queries: managedQueries,
        selectedQueryId: "",
      }),
    ).toBe("cbq_company");
    expect(
      resolveContextualBanditQuerySelection({
        datasource: makeDatasource("postgres"),
        hashAttribute: "id",
        queries: [customQuery, ...managedQueries],
        selectedQueryId: "cbq_gone",
      }),
    ).toBe("cbq_custom");
    expect(
      resolveContextualBanditQuerySelection({
        datasource: makeDatasource("postgres"),
        hashAttribute: "id",
        queries: [customQuery, ...managedQueries],
        selectedQueryId: "cbq_user",
      }),
    ).toBe("cbq_user");
  });
});

describe("contextualBanditQueryPickerLocked", () => {
  it("locks only when every query on a JSON managed warehouse is generated", () => {
    expect(
      contextualBanditQueryPickerLocked({
        datasource: jsonWarehouse,
        queries: managedQueries,
      }),
    ).toBe(true);
    expect(
      contextualBanditQueryPickerLocked({
        datasource: jsonWarehouse,
        queries: [customQuery, ...managedQueries],
      }),
    ).toBe(false);
    expect(
      contextualBanditQueryPickerLocked({
        datasource: jsonWarehouse,
        queries: [],
      }),
    ).toBe(false);
    expect(
      contextualBanditQueryPickerLocked({
        datasource: legacyWarehouse,
        queries: managedQueries,
      }),
    ).toBe(false);
    expect(
      contextualBanditQueryPickerLocked({
        datasource: makeDatasource("postgres"),
        queries: managedQueries,
      }),
    ).toBe(false);
  });
});

describe("managed warehouse query copy", () => {
  it("points at where the hash attribute lives on each surface", () => {
    expect(managedWarehouseHashAttributeHint("create")).toBe(
      "choose a different hash attribute on the previous step",
    );
    expect(managedWarehouseHashAttributeHint("edit")).toBe(
      "change the hash attribute in Traffic & Targeting",
    );
    expect(managedWarehouseQueryHelpText("edit")).toContain(
      "Traffic & Targeting",
    );
    expect(managedWarehouseQueryHelpText("create")).toContain("previous step");
  });
});
