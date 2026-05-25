import {
  buildEventForwarderFeatureUsageQuery,
  buildEventForwarderFeatureUsageQuerySql,
  buildEventForwarderFeatureUsageTableReference,
  EVENT_FORWARDER_FEATURE_USAGE_TABLE,
  eventForwarderManagedFeatureUsageQueryExists,
  getActiveFeatureUsageQuery,
  isEventForwarderManagedFeatureUsageQuery,
} from "../../src/util/event-forwarder-feature-usage-queries";
import { EVENT_FORWARDER_AVRO_PARTITION_FIELD } from "../../src/util/event-forwarder-fact-table";

describe("event-forwarder-feature-usage-queries table reference", () => {
  it("builds BigQuery feature_usage table reference", () => {
    expect(
      buildEventForwarderFeatureUsageTableReference({
        sinkType: "bigquery",
        projectId: "my-project",
        dataset: "analytics_123",
      }),
    ).toBe(
      `\`my-project\`.\`analytics_123\`.\`${EVENT_FORWARDER_FEATURE_USAGE_TABLE}\``,
    );
  });

  it("builds Snowflake feature_usage table reference", () => {
    expect(
      buildEventForwarderFeatureUsageTableReference({
        sinkType: "snowflake",
        database: "MY_DB",
        schema: "PUBLIC",
      }),
    ).toBe("MY_DB.PUBLIC.FEATURE_USAGE");
  });
});

describe("buildEventForwarderFeatureUsageQuerySql", () => {
  const tableRef = "`proj`.`ds`.`feature_usage`";

  it("includes received_at partition filter for BigQuery only", () => {
    const sql = buildEventForwarderFeatureUsageQuerySql({
      sinkType: "bigquery",
      tableRef,
    });

    expect(sql).toContain("timestamp AS timestamp");
    expect(sql).toContain("feature_key AS feature_key");
    expect(sql).toContain(`FROM ${tableRef}`);
    expect(sql).toContain(
      `WHERE ${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`,
    );
  });

  it("has no WHERE clause for Snowflake", () => {
    const sql = buildEventForwarderFeatureUsageQuerySql({
      sinkType: "snowflake",
      tableRef: "MY_DB.PUBLIC.FEATURE_USAGE",
    });

    expect(sql).toContain("FROM MY_DB.PUBLIC.FEATURE_USAGE");
    expect(sql).not.toContain("WHERE");
  });
});

describe("buildEventForwarderFeatureUsageQuery", () => {
  it("creates a managed feature usage query", () => {
    const query = buildEventForwarderFeatureUsageQuery({
      sinkType: "bigquery",
      projectId: "proj",
      dataset: "ds",
    });

    expect(query.managedBy).toBe("api");
    expect(query.query).toContain("feature_usage");
    expect(isEventForwarderManagedFeatureUsageQuery(query as never)).toBe(true);
  });
});

describe("getActiveFeatureUsageQuery", () => {
  it("prefers managed queries when multiple exist", () => {
    const active = getActiveFeatureUsageQuery([
      { id: "manual", query: "SELECT 1", managedBy: "" },
      { id: "managed", query: "SELECT 2", managedBy: "api" },
    ]);

    expect(active?.id).toBe("managed");
  });

  it("falls back to the first query when none are managed", () => {
    const active = getActiveFeatureUsageQuery([
      { id: "manual", query: "SELECT 1" },
    ]);

    expect(active?.id).toBe("manual");
  });
});

describe("eventForwarderManagedFeatureUsageQueryExists", () => {
  it("returns true when a managed query exists", () => {
    expect(
      eventForwarderManagedFeatureUsageQueryExists([
        { id: "manual", query: "SELECT 1" },
        { id: "managed", query: "SELECT 2", managedBy: "api" },
      ]),
    ).toBe(true);
  });
});
