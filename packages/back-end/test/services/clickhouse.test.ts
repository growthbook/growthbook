import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import { GrowthbookClickhouseDataSource } from "shared/types/datasource";
import { SDKAttributeSchema } from "shared/types/organization";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import {
  buildManagedWarehouseEventsFactTableSql,
  getManagedWarehouseEventsFactTableColumns,
  getManagedWarehouseUserIdTypes,
} from "shared/util";
import type { ReqContext } from "back-end/types/request";
import {
  listSessionReplays,
  MAX_SESSION_PAGE_SIZE,
  syncManagedWarehouseIdentifiers,
} from "back-end/src/services/clickhouse";
import {
  dangerouslyGetFactTableByIdBypassPermission,
  dangerouslySyncManagedWarehouseFactTable,
} from "back-end/src/models/FactTableModel";
import {
  getGrowthbookDatasource,
  dangerouslyGetGrowthbookDatasourceBypassPermission,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";

jest.mock("back-end/src/services/licenseServerManagedClickhouse", () => ({
  dangerousRecreateClickhouseTables: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  dangerouslyGetFactTableByIdBypassPermission: jest.fn(),
  dangerouslySyncManagedWarehouseFactTable: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getGrowthbookDatasource: jest.fn(),
  dangerouslyGetGrowthbookDatasourceBypassPermission: jest.fn(),
  updateDataSource: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));

const mockGetGrowthbookDatasource = jest.mocked(getGrowthbookDatasource);
const mockGetSourceIntegrationObject = jest.mocked(getSourceIntegrationObject);
const mockGetFactTableById = jest.mocked(
  dangerouslyGetFactTableByIdBypassPermission,
);
const mockSyncFactTable = jest.mocked(dangerouslySyncManagedWarehouseFactTable);
const mockGetDatasource = jest.mocked(
  dangerouslyGetGrowthbookDatasourceBypassPermission,
);
const mockUpdateDataSource = jest.mocked(updateDataSource);

function makeFactTableColumn(
  column: string,
  overrides: Partial<ColumnInterface> = {},
): ColumnInterface {
  return {
    column,
    name: column,
    datatype: "string",
    dateCreated: new Date("2024-01-01T00:00:00.000Z"),
    dateUpdated: new Date("2024-01-01T00:00:00.000Z"),
    deleted: false,
    description: "",
    numberFormat: "",
    ...overrides,
  };
}

describe("listSessionReplays", () => {
  const context = {
    org: { id: "org_test" },
  } as unknown as ReqContext;

  const datasource = {
    id: "managed_warehouse",
    organization: "org_test",
    type: "growthbook_clickhouse",
    settings: {},
  } as unknown as GrowthbookClickhouseDataSource;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGrowthbookDatasource.mockResolvedValue(datasource);
  });

  const FROZEN_NOW = new Date("2026-11-20T12:00:00.000Z");

  function runQueryMock() {
    const runQuery = jest.fn().mockResolvedValue({ rows: [] });
    mockGetSourceIntegrationObject.mockReturnValue({
      runQuery,
      getSqlDialect: () => ({
        escapeStringLiteral: (v: string) =>
          v.replace(/\\/g, "\\\\").replace(/'/g, "''"),
      }),
    } as never);
    return runQuery;
  }

  it("adds supported session replay filters to the ClickHouse query", async () => {
    const runQuery = runQueryMock();

    await listSessionReplays(
      context,
      {
        userId: "user'1",
        clientKey: "ck_1",
        url: "https://example.com/path",
        country: ["US"],
        device: ["desktop"],
        minDurationSecs: 1.25,
        maxDurationSecs: 10,
        minEventCount: 5,
        maxEventCount: 25,
        featureKey: ["flag'one"],
        experimentKey: ["exp_one"],
        dateAfter: "2026-07-01",
        dateBefore: "2026-07-21",
        limit: 50,
        offset: 100,
      },
      FROZEN_NOW,
    );

    expect(runQuery).toHaveBeenCalledTimes(1);
    const query = runQuery.mock.calls[0][0] as string;

    expect(query).toContain("FROM session_replay_metadata");
    // Aggregated over a deduped subquery aliased m, not the table directly.
    expect(query).toContain(") AS m");
    expect(query).toContain("GROUP BY m.session_replay_id");
    expect(query).toContain("LIMIT 1 BY session_replay_id, chunk_index");
    expect(query).toContain("HAVING max(m.deleted_at) IS NULL");
    expect(query).toContain("ORDER BY min(m.started_at) DESC");

    // Chunk-invariant filters prune before the grouping.
    expect(query).toContain("client_key = 'ck_1'");
    expect(query).toContain(`${"min(m.started_at)"} >= '2026-07-01'`);
    expect(query).toContain(`${"min(m.started_at)"} < '2026-07-22'`);

    // Everything computed across chunks is evaluated after it.
    expect(query).toContain("max(m.user_id = 'user''1') = 1");
    expect(query).toContain("max(m.duration_ms) >= 1250");
    expect(query).toContain("max(m.duration_ms) <= 10000");
    expect(query).toContain("sum(m.event_count) >= 5");
    expect(query).toContain("sum(m.event_count) <= 25");
    expect(query).toContain("max(has(m.feature_keys, 'flag''one')) = 1");
    expect(query).toContain("max(has(m.experiment_keys, 'exp_one')) = 1");
    expect(query).toContain("any(m.country) = 'US'");
    expect(query).toContain("any(m.device) = 'desktop'");
    expect(query).toContain(
      "positionCaseInsensitive(argMin(m.url_first, m.chunk_index), 'https://example.com/path') > 0",
    );

    expect(query).toContain("LIMIT 50");
    expect(query).toContain("OFFSET 100");
  });

  // Filtering below the GROUP BY removes rows from the aggregate state, so a
  // session that loses chunks to a filter reports wrong totals. Only columns
  // that are identical on every chunk may be pushed down.
  it("keeps chunk-varying predicates after the GROUP BY", async () => {
    const runQuery = runQueryMock();

    await listSessionReplays(
      context,
      {
        userId: "u1",
        url: "example.com",
        country: ["US"],
        device: ["desktop"],
        minDurationSecs: 1,
        minEventCount: 1,
        featureKey: ["f1"],
        experimentKey: ["e1"],
        clientKeys: ["ck_1"],
        dateAfter: "2026-07-01",
      },
      FROZEN_NOW,
    );

    const query = runQuery.mock.calls[0][0] as string;
    // These aggregates also appear in the projection, so compare against the
    // clause sections rather than the first occurrence anywhere.
    const whereClause = query.slice(
      query.indexOf("WHERE"),
      query.indexOf("GROUP BY"),
    );
    const havingClause = query.slice(query.indexOf("HAVING"));

    for (const pushedDown of ["client_key IN"]) {
      expect(whereClause).toContain(pushedDown);
    }
    for (const afterGrouping of [
      "max(m.deleted_at)",
      "max(m.duration_ms)",
      "sum(m.event_count)",
      "max(has(m.feature_keys",
      "max(has(m.experiment_keys",
      "max(m.user_id =",
      "any(m.country)",
      "any(m.device)",
      "min(m.started_at) >=",
    ]) {
      expect(havingClause).toContain(afterGrouping);
      expect(whereClause).not.toContain(afterGrouping);
    }
  });

  // Experiment tracking keys have no character validation, so a comma inside
  // one is a real key. It used to be split into two unrelated keys.
  it("keeps a comma inside a single key intact", async () => {
    const runQuery = runQueryMock();

    await listSessionReplays(
      context,
      { experimentKey: ["checkout,v2"] },
      FROZEN_NOW,
    );

    const query = runQuery.mock.calls[0][0] as string;
    expect(query).toContain("max(has(m.experiment_keys, 'checkout,v2')) = 1");
    expect(query).not.toContain("hasAny");
  });

  it("bounds the scan by ingested_at, widened past the requested dates", async () => {
    const runQuery = runQueryMock();

    await listSessionReplays(
      context,
      { dateAfter: "2026-07-01", dateBefore: "2026-07-21" },
      FROZEN_NOW,
    );

    const query = runQuery.mock.calls[0][0] as string;
    // 24h of slack on each end: started_at is a client clock and chunks are
    // ingested after the events they carry.
    expect(query).toContain("ingested_at >= toDateTime('2026-06-30 00:00:00')");
    expect(query).toContain("ingested_at < toDateTime('2026-07-23 00:00:00')");
  });

  it("falls back to a default lookback window when no dates are given", async () => {
    const runQuery = runQueryMock();

    await listSessionReplays(context, {}, FROZEN_NOW);

    const query = runQuery.mock.calls[0][0] as string;
    // 30 days back, plus the same 24h margin.
    expect(query).toContain("ingested_at >= toDateTime('2026-10-20 12:00:00')");
    expect(query).toContain("ingested_at < toDateTime('2026-11-21 12:00:00')");
  });

  it("does not aggregate columns the list neither shows nor filters on", async () => {
    const runQuery = runQueryMock();

    await listSessionReplays(context, {}, FROZEN_NOW);

    const query = runQuery.mock.calls[0][0] as string;
    // The dedup subquery legitimately selects *; the outer projection is what
    // must stay narrow, so check only the part before it.
    const projection = query.slice(0, query.indexOf("FROM ("));
    expect(projection).not.toContain("*");
    expect(query).not.toContain("session_replay_sessions");
    expect(query).not.toContain("attributes");
    expect(query).not.toContain("user_agent");
    expect(query).not.toContain("urls_visited");
    expect(query).not.toContain("feature_evals");
    expect(query).not.toContain("session_events");
    // The old union-of-arrays form; replaced by an incremental dedup.
    expect(query).not.toContain("groupArray(");
    expect(query).not.toContain("arrayFlatten");
  });

  // Both feed SessionReplayModel's permission check. Dropping either returns
  // an empty list to every user with no error at all.
  it("always projects the columns the permission check reads", async () => {
    const runQuery = runQueryMock();

    await listSessionReplays(context, {}, FROZEN_NOW);

    const query = runQuery.mock.calls[0][0] as string;
    expect(query).toContain("any(m.organization) AS organization");
    expect(query).toContain("any(m.client_key) AS client_key");
  });

  // The list endpoint over-fetches one row to detect a next page, so the clamp
  // has to allow page size + 1 rather than the page size itself
  it("allows one row beyond the page size and clamps above it", async () => {
    const runQuery = jest.fn().mockResolvedValue({ rows: [] });
    mockGetSourceIntegrationObject.mockReturnValue({
      runQuery,
      getSqlDialect: () => ({
        escapeStringLiteral: (v: string) => v,
      }),
    } as never);

    await listSessionReplays(context, { limit: MAX_SESSION_PAGE_SIZE + 1 });
    expect(runQuery.mock.calls[0][0]).toContain(
      `LIMIT ${MAX_SESSION_PAGE_SIZE + 1}`,
    );

    await listSessionReplays(context, { limit: 5000 });
    expect(runQuery.mock.calls[1][0]).toContain(
      `LIMIT ${MAX_SESSION_PAGE_SIZE + 1}`,
    );
  });

  it("returns an empty list when there is no datasource", async () => {
    mockGetGrowthbookDatasource.mockResolvedValue(null);
    const runQuery = jest.fn().mockResolvedValue({ rows: [] });
    mockGetSourceIntegrationObject.mockReturnValue({
      runQuery,
    } as never);

    await expect(listSessionReplays(context)).resolves.toEqual([]);
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe("syncManagedWarehouseIdentifiers", () => {
  const context = {
    org: { id: "org_test", settings: {} },
  } as unknown as ReqContext;

  const datasource = {
    id: "managed_warehouse",
    organization: "org_test",
    type: "growthbook_clickhouse",
    settings: { useJsonColumns: true, queries: {} },
  } as unknown as GrowthbookClickhouseDataSource;

  // Build a fact table that already matches the desired state for a schema, so
  // any write is driven solely by the override the test applies on top.
  function makeManagedFactTable(
    schema: SDKAttributeSchema,
    columnOverride?: (cols: ColumnInterface[]) => void,
  ): FactTableInterface {
    const columns = getManagedWarehouseEventsFactTableColumns(schema).map((c) =>
      makeFactTableColumn(c.column, {
        datatype: c.datatype,
        ...(c.alwaysInlineFilter
          ? { alwaysInlineFilter: c.alwaysInlineFilter }
          : {}),
        ...(c.jsonFields ? { jsonFields: c.jsonFields } : {}),
      }),
    );
    columnOverride?.(columns);
    return {
      id: MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
      datasource: "managed_warehouse",
      columns,
      sql: buildManagedWarehouseEventsFactTableSql(schema),
      userIdTypes: getManagedWarehouseUserIdTypes(schema),
    } as unknown as FactTableInterface;
  }

  function getSyncedColumns(): ColumnInterface[] {
    return (
      mockSyncFactTable.mock.calls[0][2] as { columns: ColumnInterface[] }
    ).columns;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDatasource.mockResolvedValue(datasource);
    mockUpdateDataSource.mockResolvedValue(undefined as never);
    mockSyncFactTable.mockResolvedValue(undefined as never);
  });

  it("updates the attributes JSON field type when an attribute datatype changes", async () => {
    const schema: SDKAttributeSchema = [
      { property: "age", datatype: "string" },
    ];
    // Fact table still reflects the old `number` type for `age`.
    const ft = makeManagedFactTable(schema, (cols) => {
      const attrs = cols.find((c) => c.column === "attributes")!;
      attrs.jsonFields = { age: { datatype: "number" } };
    });
    mockGetFactTableById.mockResolvedValue(ft);

    await syncManagedWarehouseIdentifiers(context, schema);

    expect(mockSyncFactTable).toHaveBeenCalledTimes(1);
    const attributes = getSyncedColumns().find(
      (c) => c.column === "attributes",
    );
    expect(attributes?.jsonFields).toEqual({ age: { datatype: "string" } });
    // The sync skips writes equal to its input, so the input must stay untouched.
    expect(
      ft.columns.find((c) => c.column === "attributes")?.jsonFields,
    ).toEqual({ age: { datatype: "number" } });
  });

  it("preserves data-discovered JSON fields not present in the schema", async () => {
    const schema: SDKAttributeSchema = [
      { property: "plan", datatype: "string" },
    ];
    const ft = makeManagedFactTable(schema, (cols) => {
      const attrs = cols.find((c) => c.column === "attributes")!;
      // Field the refresh job discovered from data but not in the schema.
      attrs.jsonFields = { discovered_field: { datatype: "number" } };
    });
    mockGetFactTableById.mockResolvedValue(ft);

    await syncManagedWarehouseIdentifiers(context, schema);

    expect(mockSyncFactTable).toHaveBeenCalledTimes(1);
    const attributes = getSyncedColumns().find(
      (c) => c.column === "attributes",
    );
    expect(attributes?.jsonFields).toEqual({
      discovered_field: { datatype: "number" },
      plan: { datatype: "string" },
    });
  });

  it("deletes removed custom identifiers but keeps real and virtual columns", async () => {
    const schema: SDKAttributeSchema = [
      { property: "plan", datatype: "string" },
    ];
    const ft = makeManagedFactTable(schema, (cols) => {
      // A real `SELECT *` column the refresh job discovered (reserved name).
      cols.push(makeFactTableColumn("session_id"));
      // A former custom identifier no longer in the schema (non-reserved).
      cols.push(makeFactTableColumn("company_id"));
      cols.push(
        makeFactTableColumn("request_source_vc", {
          isVirtual: true,
          sql: "attributes.requestSource::Nullable(String)",
        }),
      );
    });
    mockGetFactTableById.mockResolvedValue(ft);

    await syncManagedWarehouseIdentifiers(context, schema);

    expect(mockSyncFactTable).toHaveBeenCalledTimes(1);
    const synced = getSyncedColumns();
    expect(synced.find((c) => c.column === "session_id")?.deleted).toBe(false);
    expect(synced.find((c) => c.column === "company_id")?.deleted).toBe(true);
    expect(synced.find((c) => c.column === "request_source_vc")?.deleted).toBe(
      false,
    );
  });

  it("does not write the fact table when nothing changed", async () => {
    const schema: SDKAttributeSchema = [
      { property: "plan", datatype: "string" },
    ];
    mockGetFactTableById.mockResolvedValue(makeManagedFactTable(schema));

    await syncManagedWarehouseIdentifiers(context, schema);

    expect(mockSyncFactTable).not.toHaveBeenCalled();
  });

  it("no-ops for legacy (materialized-column) warehouses", async () => {
    mockGetDatasource.mockResolvedValue({
      ...datasource,
      settings: { queries: {} },
    } as unknown as GrowthbookClickhouseDataSource);

    await syncManagedWarehouseIdentifiers(context, []);

    expect(mockUpdateDataSource).not.toHaveBeenCalled();
    expect(mockGetFactTableById).not.toHaveBeenCalled();
    expect(mockSyncFactTable).not.toHaveBeenCalled();
  });
});
