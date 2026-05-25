import {
  buildEventForwarderColumnProbeSql,
  eventForwarderWarehouseResultColumnAlias,
  eventForwarderWarehouseSourceColumn,
} from "../../src/util/event-forwarder-warehouse-columns";
import { EVENT_FORWARDER_AVRO_PARTITION_FIELD } from "../../src/util/event-forwarder-fact-table";

describe("eventForwarderWarehouseSourceColumn", () => {
  it("backticks column names for BigQuery", () => {
    expect(eventForwarderWarehouseSourceColumn("bigquery", "user_id")).toBe(
      "`user_id`",
    );
  });

  it("uppercases column names for Snowflake", () => {
    expect(
      eventForwarderWarehouseSourceColumn("snowflake", "feature_key"),
    ).toBe("FEATURE_KEY");
  });
});

describe("buildEventForwarderColumnProbeSql", () => {
  const tableRef = "`proj`.`ds`.`gb_events`";

  it("aliases columns for BigQuery with partition filter", () => {
    const sql = buildEventForwarderColumnProbeSql({
      sinkType: "bigquery",
      tableRef,
      columnNames: ["user_id", "country"],
      partitionFilter: true,
    });

    expect(sql).toContain("`user_id` AS `user_id`");
    expect(sql).toContain("`country` AS `country`");
    expect(sql).toContain(`FROM ${tableRef}`);
    expect(sql).toContain(
      `WHERE ${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`,
    );
  });

  it("aliases columns for Snowflake without partition filter", () => {
    const sql = buildEventForwarderColumnProbeSql({
      sinkType: "snowflake",
      tableRef: "MY_DB.PUBLIC.GB_EVENTS",
      columnNames: ["user_id", "plan"],
    });

    expect(sql).toContain("USER_ID AS user_id");
    expect(sql).toContain("PLAN AS plan");
    expect(sql).toContain("FROM MY_DB.PUBLIC.GB_EVENTS");
    expect(sql).not.toContain("WHERE");
  });
});

describe("eventForwarderWarehouseResultColumnAlias", () => {
  it("uses backticks for BigQuery result aliases", () => {
    expect(
      eventForwarderWarehouseResultColumnAlias("bigquery", "country"),
    ).toBe("`country`");
  });

  it("uses lowercase aliases for Snowflake results", () => {
    expect(
      eventForwarderWarehouseResultColumnAlias("snowflake", "country"),
    ).toBe("country");
  });
});
