import { SDKAttributeSchema } from "../../types/organization";
import {
  GrowthbookClickhouseSettings,
  MaterializedColumn,
} from "../../types/datasource";
import {
  buildManagedWarehouseAttributeAliasClause,
  buildManagedWarehouseEventsFactTableSql,
  buildManagedWarehouseExposureQueries,
  getManagedWarehouseAttributesJsonFields,
  getManagedWarehouseCustomIdentifiers,
  getManagedWarehouseEventsFactTableColumns,
  getManagedWarehouseExposureQueryIdForAttribute,
  getManagedWarehouseIdentifierForAttribute,
  getManagedWarehouseTypedAttributeColumns,
  getManagedWarehouseUserIdTypes,
  getManagedWarehouseUserIdTypeSettings,
  isManagedWarehouse,
  isManagedWarehouseAwaitingJsonMigration,
  isManagedWarehouseMigrating,
  isManagedWarehouseUnavailable,
  isManagedWarehouseNoEventsGuidanceMessage,
  isManagedWarehousePendingQueryError,
  MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE,
  MANAGED_WAREHOUSE_PENDING_ERROR_CODE,
  MANAGED_WAREHOUSE_SENDING_EVENTS_DOC_URL,
} from "../../src/util/managedWarehouse";

describe("isManagedWarehouse", () => {
  it("is true only for the growthbook_clickhouse datasource type", () => {
    expect(isManagedWarehouse({ type: "growthbook_clickhouse" })).toBe(true);
  });

  it("is false for self-hosted ClickHouse and other warehouses", () => {
    expect(isManagedWarehouse({ type: "clickhouse" })).toBe(false);
    expect(isManagedWarehouse({ type: "bigquery" })).toBe(false);
    expect(isManagedWarehouse({ type: "snowflake" })).toBe(false);
  });
});

describe("isManagedWarehouseAwaitingJsonMigration", () => {
  const ds = (settings: Record<string, unknown>) =>
    ({ type: "growthbook_clickhouse", settings }) as Parameters<
      typeof isManagedWarehouseAwaitingJsonMigration
    >[0];

  it("is false for non-managed warehouses", () => {
    expect(
      isManagedWarehouseAwaitingJsonMigration({
        type: "clickhouse",
        settings: {},
      }),
    ).toBe(false);
  });

  it("is true for a legacy warehouse (no useJsonColumns)", () => {
    expect(isManagedWarehouseAwaitingJsonMigration(ds({}))).toBe(true);
    expect(
      isManagedWarehouseAwaitingJsonMigration(ds({ useJsonColumns: false })),
    ).toBe(true);
  });

  it("is true for a partially-migrated warehouse (flag set, matcols not cleared)", () => {
    expect(
      isManagedWarehouseAwaitingJsonMigration(
        ds({
          useJsonColumns: true,
          materializedColumns: [{ columnName: "plan" }],
        }),
      ),
    ).toBe(true);
  });

  it("is false once fully migrated (flag set, matcols cleared/empty/absent)", () => {
    expect(
      isManagedWarehouseAwaitingJsonMigration(ds({ useJsonColumns: true })),
    ).toBe(false);
    expect(
      isManagedWarehouseAwaitingJsonMigration(
        ds({ useJsonColumns: true, materializedColumns: [] }),
      ),
    ).toBe(false);
  });
});

describe("isManagedWarehouseMigrating / isManagedWarehouseUnavailable", () => {
  const ds = (settings: Record<string, unknown>) =>
    ({ type: "growthbook_clickhouse", settings }) as Parameters<
      typeof isManagedWarehouseMigrating
    >[0];

  it("isManagedWarehouseMigrating is true only when migrating === true", () => {
    expect(isManagedWarehouseMigrating(ds({ migrating: true }))).toBe(true);
    expect(isManagedWarehouseMigrating(ds({ migrating: false }))).toBe(false);
    expect(isManagedWarehouseMigrating(ds({}))).toBe(false);
    expect(
      isManagedWarehouseMigrating({
        type: "clickhouse",
        settings: { migrating: true },
      }),
    ).toBe(false);
  });

  it("isManagedWarehouseUnavailable covers both never-provisioned and migrating", () => {
    expect(
      isManagedWarehouseUnavailable(ds({ hasBeenProvisioned: false })),
    ).toBe(true);
    expect(isManagedWarehouseUnavailable(ds({ migrating: true }))).toBe(true);
    expect(
      isManagedWarehouseUnavailable(ds({ hasBeenProvisioned: true })),
    ).toBe(false);
  });
});

describe("isManagedWarehousePendingQueryError", () => {
  it("matches the bare error code", () => {
    expect(
      isManagedWarehousePendingQueryError(MANAGED_WAREHOUSE_PENDING_ERROR_CODE),
    ).toBe(true);
  });

  it("matches when the code is appended (e.g. QueryRunner analysis prefix)", () => {
    expect(
      isManagedWarehousePendingQueryError(
        `Error running analysis: ${MANAGED_WAREHOUSE_PENDING_ERROR_CODE}`,
      ),
    ).toBe(true);
  });

  it("returns false for empty and unrelated messages", () => {
    expect(isManagedWarehousePendingQueryError("")).toBe(false);
    expect(isManagedWarehousePendingQueryError(undefined)).toBe(false);
    expect(isManagedWarehousePendingQueryError(null)).toBe(false);
    expect(isManagedWarehousePendingQueryError("Connection refused")).toBe(
      false,
    );
  });
});

describe("isManagedWarehouseNoEventsGuidanceMessage", () => {
  it("matches pending code and legacy long copy", () => {
    expect(
      isManagedWarehouseNoEventsGuidanceMessage(
        MANAGED_WAREHOUSE_PENDING_ERROR_CODE,
      ),
    ).toBe(true);
    expect(
      isManagedWarehouseNoEventsGuidanceMessage(
        `${MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE} Read our full docs (${MANAGED_WAREHOUSE_SENDING_EVENTS_DOC_URL}) with instructions.`,
      ),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isManagedWarehouseNoEventsGuidanceMessage("")).toBe(false);
    expect(isManagedWarehouseNoEventsGuidanceMessage(undefined)).toBe(false);
    expect(isManagedWarehouseNoEventsGuidanceMessage("No tables found.")).toBe(
      false,
    );
  });
});

// The default org attribute schema: a single `id` identifier (folds into the
// built-in device_id column) plus non-identifier attributes.
const defaultSchema: SDKAttributeSchema = [
  { property: "id", datatype: "string", hashAttribute: true },
  { property: "url", datatype: "string" },
  { property: "browser", datatype: "enum", enum: "chrome,safari" },
];

// Non-identifier dimensions preserved from a legacy migration.
const migratedDims: MaterializedColumn[] = [
  {
    columnName: "plan",
    sourceField: "plan",
    datatype: "string",
    type: "dimension",
  },
  {
    columnName: "revenue",
    sourceField: "revenue",
    datatype: "number",
    type: "dimension",
  },
];

describe("getManagedWarehouseCustomIdentifiers", () => {
  it("returns no custom identifiers for the default schema (id folds into device_id)", () => {
    expect(getManagedWarehouseCustomIdentifiers(defaultSchema)).toEqual([]);
    expect(getManagedWarehouseCustomIdentifiers(undefined)).toEqual([]);
  });

  it("includes custom hashAttributes that live in context_json (sorted)", () => {
    const schema: SDKAttributeSchema = [
      { property: "id", datatype: "string", hashAttribute: true },
      { property: "company_id", datatype: "string", hashAttribute: true },
      { property: "account", datatype: "number", hashAttribute: true },
    ];
    expect(getManagedWarehouseCustomIdentifiers(schema)).toEqual([
      "account",
      "company_id",
    ]);
  });

  it("excludes hashAttributes that collide with a real SELECT * column", () => {
    const schema: SDKAttributeSchema = [
      // These would clash with ingestor/standard columns -> duplicate column in SELECT *
      { property: "geo_country", datatype: "string", hashAttribute: true },
      { property: "event_name", datatype: "string", hashAttribute: true },
      { property: "timestamp", datatype: "string", hashAttribute: true },
      { property: "company_id", datatype: "string", hashAttribute: true },
    ];
    expect(getManagedWarehouseCustomIdentifiers(schema)).toEqual([
      "company_id",
    ]);
  });

  it("excludes array-typed hashAttributes (can't be scalar join keys)", () => {
    const schema: SDKAttributeSchema = [
      { property: "team_ids", datatype: "string[]", hashAttribute: true },
      { property: "scores", datatype: "number[]", hashAttribute: true },
      { property: "company_id", datatype: "string", hashAttribute: true },
    ];
    expect(getManagedWarehouseCustomIdentifiers(schema)).toEqual([
      "company_id",
    ]);
  });

  it("excludes reserved top-level keys, archived, and non-identifier attributes", () => {
    const schema: SDKAttributeSchema = [
      { property: "user_id", datatype: "string", hashAttribute: true },
      { property: "device_id", datatype: "string", hashAttribute: true },
      { property: "utmSource", datatype: "string", hashAttribute: true },
      {
        property: "archived_id",
        datatype: "string",
        hashAttribute: true,
        archived: true,
      },
      { property: "not_an_id", datatype: "string" },
    ];
    expect(getManagedWarehouseCustomIdentifiers(schema)).toEqual([]);
  });

  it("de-dupes repeated properties", () => {
    const schema: SDKAttributeSchema = [
      { property: "company_id", datatype: "string", hashAttribute: true },
      { property: "company_id", datatype: "string", hashAttribute: true },
    ];
    expect(getManagedWarehouseCustomIdentifiers(schema)).toEqual([
      "company_id",
    ]);
  });

  it("merges extraIdentifiers (preserved legacy ids), de-duped and sorted", () => {
    const schema: SDKAttributeSchema = [
      { property: "account", datatype: "string", hashAttribute: true },
    ];
    // company_id is a preserved legacy identifier (not a hashAttribute); account
    // is also passed as extra but already comes from the schema -> de-duped.
    expect(
      getManagedWarehouseCustomIdentifiers(schema, ["company_id", "account"]),
    ).toEqual(["account", "company_id"]);
  });

  it("applies the same exclusions to extraIdentifiers (reserved-collision)", () => {
    expect(
      getManagedWarehouseCustomIdentifiers(undefined, [
        "geo_country", // collides with a real SELECT * column
        "company_id",
      ]),
    ).toEqual(["company_id"]);
  });

  it("extraIdentifiers flow through to userIdTypes", () => {
    expect(getManagedWarehouseUserIdTypes(undefined, ["company_id"])).toEqual([
      "user_id",
      "device_id",
      "company_id",
    ]);
  });
});

describe("getManagedWarehouseUserIdTypes", () => {
  it("always includes the built-in identity columns", () => {
    expect(getManagedWarehouseUserIdTypes(defaultSchema)).toEqual([
      "user_id",
      "device_id",
    ]);
  });

  it("appends custom identifiers", () => {
    const schema: SDKAttributeSchema = [
      { property: "company_id", datatype: "string", hashAttribute: true },
    ];
    expect(getManagedWarehouseUserIdTypes(schema)).toEqual([
      "user_id",
      "device_id",
      "company_id",
    ]);
  });

  it("shapes userIdTypes for settings", () => {
    expect(getManagedWarehouseUserIdTypeSettings(defaultSchema)).toEqual([
      { userIdType: "user_id", description: "" },
      { userIdType: "device_id", description: "" },
    ]);
  });
});

describe("buildManagedWarehouseEventsFactTableSql", () => {
  it("selects all columns with no JSON aliases for the default schema", () => {
    const sql = buildManagedWarehouseEventsFactTableSql(defaultSchema);
    expect(sql).toContain("SELECT *");
    expect(sql).toContain("FROM events");
    expect(sql).toContain(
      "WHERE timestamp BETWEEN '{{startDate}}' AND '{{endDate}}'",
    );
    expect(sql).not.toContain("attributes.");
  });

  it("aliases custom identifiers out of the attributes JSON column", () => {
    const schema: SDKAttributeSchema = [
      { property: "company_id", datatype: "string", hashAttribute: true },
    ];
    const sql = buildManagedWarehouseEventsFactTableSql(schema);
    expect(sql).toContain(
      "attributes.company_id::Nullable(String) AS company_id",
    );
  });

  it("backtick-quotes identifiers that are not safe SQL identifiers", () => {
    const schema: SDKAttributeSchema = [
      { property: "company id", datatype: "string", hashAttribute: true },
    ];
    const sql = buildManagedWarehouseEventsFactTableSql(schema);
    expect(sql).toContain(
      "attributes.`company id`::Nullable(String) AS `company id`",
    );
  });

  it("aliases preserved dimensions out of the attributes JSON column", () => {
    const sql = buildManagedWarehouseEventsFactTableSql(
      defaultSchema,
      [],
      migratedDims,
    );
    // String dimension casts to Nullable(String); numeric coerces via toFloat64OrNull.
    expect(sql).toContain("attributes.plan::Nullable(String) AS plan");
    expect(sql).toContain(
      "toFloat64OrNull(attributes.revenue::Nullable(String)) AS revenue",
    );
  });

  it("drops a migrated dimension whose name collides with a custom identifier", () => {
    const schema: SDKAttributeSchema = [
      { property: "plan", datatype: "string", hashAttribute: true },
    ];
    const sql = buildManagedWarehouseEventsFactTableSql(
      schema,
      [],
      [
        {
          columnName: "plan",
          sourceField: "plan",
          datatype: "string",
          type: "dimension",
        },
      ],
    );
    // `plan` is aliased once (as the identifier), not twice.
    expect(sql.match(/AS plan\b/g)?.length).toBe(1);
  });
});

describe("buildManagedWarehouseExposureQueries", () => {
  it("creates one exposure query per identifier reading from experiment_views", () => {
    const queries = buildManagedWarehouseExposureQueries(defaultSchema);
    expect(queries.map((q) => q.userIdType)).toEqual(["user_id", "device_id"]);
    queries.forEach((q) => {
      expect(q.query).toContain("FROM experiment_views");
      expect(q.query).toContain("experiment_id LIKE '{{ experimentId }}'");
      expect(q.dimensions).toContain("geo_country");
    });
  });

  it("includes the custom identifier alias in every generated query", () => {
    const schema: SDKAttributeSchema = [
      { property: "company_id", datatype: "string", hashAttribute: true },
    ];
    const queries = buildManagedWarehouseExposureQueries(schema);
    expect(queries.map((q) => q.userIdType)).toEqual([
      "user_id",
      "device_id",
      "company_id",
    ]);
    queries.forEach((q) => {
      expect(q.query).toContain(
        "attributes.company_id::Nullable(String) AS company_id",
      );
    });
  });

  it("aliases preserved dimensions and lists them as breakdown dimensions", () => {
    const queries = buildManagedWarehouseExposureQueries(
      defaultSchema,
      [],
      migratedDims,
    );
    queries.forEach((q) => {
      expect(q.query).toContain("attributes.plan::Nullable(String) AS plan");
      expect(q.dimensions).toContain("geo_country"); // defaults still present
      expect(q.dimensions).toContain("plan"); // preserved breakdown
      expect(q.dimensions).toContain("revenue");
    });
  });
});

describe("getManagedWarehouseEventsFactTableColumns", () => {
  it("always includes the attributes/properties JSON columns and standard fields", () => {
    const columns = getManagedWarehouseEventsFactTableColumns(defaultSchema);
    const byName = Object.fromEntries(columns.map((c) => [c.column, c]));
    expect(byName["attributes"].datatype).toBe("json");
    expect(byName["properties"].datatype).toBe("json");
    expect(byName["user_id"].datatype).toBe("string");
    expect(byName["device_id"].datatype).toBe("string");
    expect(byName["event_name"].alwaysInlineFilter).toBe(true);
    expect(byName["company_id"]).toBeUndefined();
  });

  it("appends a string column per custom identifier", () => {
    const schema: SDKAttributeSchema = [
      { property: "company_id", datatype: "string", hashAttribute: true },
    ];
    const columns = getManagedWarehouseEventsFactTableColumns(schema);
    const company = columns.find((c) => c.column === "company_id");
    expect(company).toEqual({ column: "company_id", datatype: "string" });
  });

  it("attaches non-identifier attributes as `attributes` JSON fields", () => {
    const columns = getManagedWarehouseEventsFactTableColumns(defaultSchema);
    const attributes = columns.find((c) => c.column === "attributes");
    // `id` folds into device_id (identifier) and `url` collides with the
    // reserved top-level column, so only `browser` remains.
    expect(attributes?.jsonFields).toEqual({
      browser: { datatype: "string" },
    });
  });

  it("appends a top-level column per preserved dimension", () => {
    const schema: SDKAttributeSchema = [
      { property: "browser", datatype: "enum", enum: "chrome,safari" },
      { property: "plan", datatype: "string" },
      { property: "revenue", datatype: "number" },
    ];
    const columns = getManagedWarehouseEventsFactTableColumns(
      schema,
      [],
      migratedDims,
    );
    expect(columns.find((c) => c.column === "plan")).toEqual({
      column: "plan",
      datatype: "string",
    });
    expect(columns.find((c) => c.column === "revenue")).toEqual({
      column: "revenue",
      datatype: "number",
    });
    // A live attribute stays in `attributes` JSON fields too — the top-level alias and
    // the pseudo-field both resolve to the same data (accepted, data-driven duplication).
    const attributes = columns.find((c) => c.column === "attributes");
    expect(attributes?.jsonFields).toEqual({
      browser: { datatype: "string" },
      plan: { datatype: "string" },
      revenue: { datatype: "number" },
    });
  });
});

describe("getManagedWarehouseAttributesJsonFields", () => {
  it("maps datatypes and excludes identifiers, reserved keys, and collisions", () => {
    const schema: SDKAttributeSchema = [
      { property: "company_id", datatype: "string", hashAttribute: true },
      { property: "plan", datatype: "enum", enum: "free,pro" },
      { property: "age", datatype: "number" },
      { property: "is_admin", datatype: "boolean" },
      { property: "team_ids", datatype: "string[]" },
      { property: "user_id", datatype: "string" }, // reserved top-level key
      { property: "geo_country", datatype: "string" }, // collides with column
      { property: "archived", datatype: "string", archived: true },
    ];
    expect(getManagedWarehouseAttributesJsonFields(schema)).toEqual({
      plan: { datatype: "string" },
      age: { datatype: "number" },
      is_admin: { datatype: "boolean" },
      team_ids: { datatype: "other" },
    });
  });

  it("returns an empty object when there are no JSON attributes", () => {
    expect(getManagedWarehouseAttributesJsonFields(undefined)).toEqual({});
  });
});

describe("getManagedWarehouseTypedAttributeColumns", () => {
  it("includes every attribute stored in the attributes JSON, typed and sorted", () => {
    const schema: SDKAttributeSchema = [
      { property: "plan", datatype: "enum", enum: "free,pro" },
      { property: "company_id", datatype: "string", hashAttribute: true },
      { property: "age", datatype: "number" },
      { property: "is_admin", datatype: "boolean" },
      { property: "team_ids", datatype: "string[]" },
      // Extracted by the SDK to a top-level column; never inside `attributes`.
      { property: "user_id", datatype: "string" },
      { property: "archived", datatype: "string", archived: true },
      // Reserved column-name collisions don't matter for dotted names.
      { property: "geo_country", datatype: "string" },
    ];
    expect(getManagedWarehouseTypedAttributeColumns(schema)).toEqual([
      { property: "age", datatype: "number" },
      { property: "company_id", datatype: "string" },
      { property: "geo_country", datatype: "string" },
      { property: "is_admin", datatype: "string" },
      { property: "plan", datatype: "string" },
      { property: "team_ids", datatype: "string" },
    ]);
  });

  it("includes preserved legacy identifiers without duplicating schema entries", () => {
    const schema: SDKAttributeSchema = [
      { property: "company_id", datatype: "string", hashAttribute: true },
    ];
    expect(
      getManagedWarehouseTypedAttributeColumns(schema, [
        "legacy_id",
        "company_id",
        "user_id", // SDK-extracted; excluded
      ]),
    ).toEqual([
      { property: "company_id", datatype: "string" },
      { property: "legacy_id", datatype: "string" },
    ]);
  });

  it("returns an empty list for an empty schema", () => {
    expect(getManagedWarehouseTypedAttributeColumns(undefined)).toEqual([]);
  });
});

describe("getManagedWarehouseIdentifierForAttribute", () => {
  const jsonSchema: SDKAttributeSchema = [
    { property: "company_id", datatype: "string", hashAttribute: true },
  ];
  const jsonSettings: GrowthbookClickhouseSettings = {
    useJsonColumns: true,
    userIdTypes: getManagedWarehouseUserIdTypeSettings(jsonSchema),
    queries: { exposure: buildManagedWarehouseExposureQueries(jsonSchema) },
  };

  it("folds built-in attributes into user_id/device_id (JSON warehouse)", () => {
    const cases: Array<[string, string]> = [
      ["user_id", "user_id"],
      ["device_id", "device_id"],
      ["anonymous_id", "device_id"],
      ["id", "device_id"],
    ];
    cases.forEach(([attribute, identifier]) => {
      expect(
        getManagedWarehouseIdentifierForAttribute({
          settings: jsonSettings,
          attribute,
        }),
      ).toBe(identifier);
    });
  });

  it("uses the attribute property as the column for JSON custom identifiers", () => {
    expect(
      getManagedWarehouseIdentifierForAttribute({
        settings: jsonSettings,
        attribute: "company_id",
      }),
    ).toBe("company_id");
  });

  it("reads the stored attribute -> column mapping for legacy warehouses", () => {
    const settings: GrowthbookClickhouseSettings = {
      materializedColumns: [
        {
          sourceField: "customerId",
          columnName: "customer_id",
          datatype: "string",
          type: "identifier",
        },
        {
          sourceField: "plan",
          columnName: "plan",
          datatype: "string",
          type: "dimension",
        },
      ],
    };
    // The attribute name differs from the SQL column, so the stored mapping matters.
    expect(
      getManagedWarehouseIdentifierForAttribute({
        settings,
        attribute: "customerId",
      }),
    ).toBe("customer_id");
    // A dimension column is not an identifier.
    expect(
      getManagedWarehouseIdentifierForAttribute({
        settings,
        attribute: "plan",
      }),
    ).toBeNull();
    // An unmapped attribute resolves to no identifier.
    expect(
      getManagedWarehouseIdentifierForAttribute({
        settings,
        attribute: "unknown",
      }),
    ).toBeNull();
  });
});

describe("getManagedWarehouseExposureQueryIdForAttribute", () => {
  it("resolves the exposure query for a built-in attribute (JSON warehouse)", () => {
    const settings: GrowthbookClickhouseSettings = {
      useJsonColumns: true,
      queries: {
        exposure: buildManagedWarehouseExposureQueries(defaultSchema),
      },
    };
    // `id` folds into the device_id exposure query.
    expect(
      getManagedWarehouseExposureQueryIdForAttribute({
        settings,
        attribute: "id",
      }),
    ).toBe("device_id");
    expect(
      getManagedWarehouseExposureQueryIdForAttribute({
        settings,
        attribute: "user_id",
      }),
    ).toBe("user_id");
  });

  it("resolves the exposure query for a JSON custom identifier", () => {
    const schema: SDKAttributeSchema = [
      { property: "company_id", datatype: "string", hashAttribute: true },
    ];
    const settings: GrowthbookClickhouseSettings = {
      useJsonColumns: true,
      queries: { exposure: buildManagedWarehouseExposureQueries(schema) },
    };
    expect(
      getManagedWarehouseExposureQueryIdForAttribute({
        settings,
        attribute: "company_id",
      }),
    ).toBe("company_id");
  });

  it("resolves the exposure query via the legacy stored column mapping", () => {
    const settings: GrowthbookClickhouseSettings = {
      materializedColumns: [
        {
          sourceField: "customerId",
          columnName: "customer_id",
          datatype: "string",
          type: "identifier",
        },
      ],
      queries: {
        exposure: [
          {
            id: "customer_id",
            name: "customer_id",
            userIdType: "customer_id",
            dimensions: [],
            query: "",
          },
        ],
      },
    };
    expect(
      getManagedWarehouseExposureQueryIdForAttribute({
        settings,
        attribute: "customerId",
      }),
    ).toBe("customer_id");
  });

  it("returns an empty string when the attribute maps to no exposure query", () => {
    const settings: GrowthbookClickhouseSettings = {
      useJsonColumns: true,
      queries: {
        exposure: buildManagedWarehouseExposureQueries(defaultSchema),
      },
    };
    expect(
      getManagedWarehouseExposureQueryIdForAttribute({
        settings,
        attribute: "not_an_identifier",
      }),
    ).toBe("");
  });
});

describe("buildManagedWarehouseAttributeAliasClause", () => {
  const migratedSettings: GrowthbookClickhouseSettings = {
    useJsonColumns: true,
    userIdTypes: [
      { userIdType: "user_id", description: "" },
      { userIdType: "device_id", description: "" },
      { userIdType: "company_id", description: "" },
    ],
    migratedColumns: [
      {
        columnName: "plan",
        sourceField: "plan",
        datatype: "string",
        type: "dimension",
      },
      {
        columnName: "revenue",
        sourceField: "revenue",
        datatype: "number",
        type: "dimension",
      },
    ],
  };

  it("aliases custom identifiers and preserved dimensions for a migrated warehouse", () => {
    const clause = buildManagedWarehouseAttributeAliasClause(migratedSettings);
    // custom identifier (not the built-ins)
    expect(clause).toContain(
      "attributes.company_id::Nullable(String) AS company_id",
    );
    expect(clause).not.toContain("AS user_id");
    expect(clause).not.toContain("AS device_id");
    // dimensions (numeric coerces via toFloat64OrNull)
    expect(clause).toContain("attributes.plan::Nullable(String) AS plan");
    expect(clause).toContain(
      "toFloat64OrNull(attributes.revenue::Nullable(String)) AS revenue",
    );
  });

  it("returns empty for a pre-migration warehouse (columns still physical)", () => {
    expect(
      buildManagedWarehouseAttributeAliasClause({
        ...migratedSettings,
        useJsonColumns: false,
      }),
    ).toBe("");
  });

  it("returns empty when there are no custom identifiers or dimensions", () => {
    expect(
      buildManagedWarehouseAttributeAliasClause({
        useJsonColumns: true,
        userIdTypes: [
          { userIdType: "user_id", description: "" },
          { userIdType: "device_id", description: "" },
        ],
      } as GrowthbookClickhouseSettings),
    ).toBe("");
  });

  it("does not alias a dimension that collides with a custom identifier", () => {
    const clause = buildManagedWarehouseAttributeAliasClause({
      useJsonColumns: true,
      userIdTypes: [{ userIdType: "company_id", description: "" }],
      migratedColumns: [
        {
          columnName: "company_id",
          sourceField: "company_id",
          datatype: "string",
          type: "dimension",
        },
      ],
    } as GrowthbookClickhouseSettings);
    expect(clause.match(/AS company_id\b/g)?.length).toBe(1);
  });

  it("drops a preserved dimension whose name collides with a real SELECT * column", () => {
    const clause = buildManagedWarehouseAttributeAliasClause({
      useJsonColumns: true,
      userIdTypes: [{ userIdType: "user_id", description: "" }],
      migratedColumns: [
        {
          columnName: "geo_country",
          sourceField: "country",
          datatype: "string",
          type: "dimension",
        },
      ],
    } as GrowthbookClickhouseSettings);
    // geo_country is a physical column post-migration; aliasing it would duplicate it.
    expect(clause).toBe("");
  });

  it("drops a custom identifier whose name collides with a real SELECT * column", () => {
    const clause = buildManagedWarehouseAttributeAliasClause({
      useJsonColumns: true,
      userIdTypes: [{ userIdType: "session_id", description: "" }],
    } as GrowthbookClickhouseSettings);
    expect(clause).toBe("");
  });
});
