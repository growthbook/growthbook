import {
  defaultEventForwarderDestination,
  eventDestinationWithConnectionSchema,
  eventForwarderDestinationFromDatasource,
} from "@/components/DataSourceSetup/EventForwarderDestinationFields";

describe("eventDestinationWithConnectionSchema", () => {
  const destination = {
    location: "GROWTHBOOK_EVENTS",
    tablePrefix: "GB",
    zerobusEndpoint: "",
  };

  it("copies a Snowflake schema into an untouched destination", () => {
    expect(
      eventDestinationWithConnectionSchema(destination, "PUBLIC", false),
    ).toEqual({ ...destination, location: "PUBLIC" });
  });

  it("follows the schema as it changes until the destination is edited", () => {
    expect(
      eventDestinationWithConnectionSchema(destination, "OTHER", false),
    ).toEqual({ ...destination, location: "OTHER" });
  });

  it("keeps the destination default when the connection schema is blank", () => {
    expect(eventDestinationWithConnectionSchema(destination, "", false)).toBe(
      destination,
    );
    expect(
      eventDestinationWithConnectionSchema(destination, "   ", false),
    ).toBe(destination);
  });

  it("keeps a user-edited destination when the connection schema changes", () => {
    const edited = { ...destination, location: "MY_EVENTS" };
    expect(eventDestinationWithConnectionSchema(edited, "PUBLIC", true)).toBe(
      edited,
    );
  });

  it("keeps an edited destination even when it matches the default", () => {
    expect(
      eventDestinationWithConnectionSchema(destination, "PUBLIC", true),
    ).toBe(destination);
  });

  it("leaves other warehouses alone", () => {
    expect(eventDestinationWithConnectionSchema(destination, null, false)).toBe(
      destination,
    );
  });
});

describe("defaultEventForwarderDestination", () => {
  it("uses an uppercase schema and prefix for Snowflake", () => {
    expect(defaultEventForwarderDestination("snowflake")).toEqual({
      location: "GROWTHBOOK_EVENTS",
      tablePrefix: "GB",
      zerobusEndpoint: "",
    });
  });

  it("uses a lowercase dataset and prefix for BigQuery", () => {
    expect(defaultEventForwarderDestination("bigquery")).toEqual({
      location: "growthbook_events",
      tablePrefix: "gb",
      zerobusEndpoint: "",
    });
  });

  it("uses a lowercase schema and prefix for Databricks", () => {
    expect(defaultEventForwarderDestination("databricks")).toEqual({
      location: "growthbook_events",
      tablePrefix: "gb",
      zerobusEndpoint: "",
    });
  });
});

describe("eventForwarderDestinationFromDatasource", () => {
  it("reads a saved BigQuery dataset and prefix", () => {
    expect(
      eventForwarderDestinationFromDatasource({
        type: "bigquery",
        eventForwarderConfig: {
          sinkType: "bigquery",
          status: "ready",
          config: {
            projectId: "analytics",
            dataset: "saved_dataset",
            tablePrefix: "evt",
          },
        },
      }),
    ).toEqual({
      location: "saved_dataset",
      tablePrefix: "evt",
      zerobusEndpoint: "",
    });
  });

  it("reads a saved Snowflake schema and prefix", () => {
    expect(
      eventForwarderDestinationFromDatasource({
        type: "snowflake",
        eventForwarderConfig: {
          sinkType: "snowflake",
          status: "ready",
          config: {
            database: "ANALYTICS",
            schema: "SAVED_SCHEMA",
            tablePrefix: "EVT",
          },
        },
      }),
    ).toEqual({
      location: "SAVED_SCHEMA",
      tablePrefix: "EVT",
      zerobusEndpoint: "",
    });
  });

  it("reads a saved Databricks schema, prefix, and Zerobus endpoint", () => {
    expect(
      eventForwarderDestinationFromDatasource({
        type: "databricks",
        eventForwarderConfig: {
          sinkType: "databricks",
          status: "ready",
          config: {
            catalog: "main",
            schema: "saved_schema",
            tablePrefix: "evt",
            zerobusEndpoint:
              "https://adb.zerobus.us-east-1.cloud.databricks.com",
          },
        },
      }),
    ).toEqual({
      location: "saved_schema",
      tablePrefix: "evt",
      zerobusEndpoint: "https://adb.zerobus.us-east-1.cloud.databricks.com",
    });
  });

  it("falls back to the Snowflake default when no configuration exists", () => {
    expect(
      eventForwarderDestinationFromDatasource({
        type: "snowflake",
        eventForwarderConfig: null,
      }),
    ).toEqual(defaultEventForwarderDestination("snowflake"));
  });

  it("falls back to the BigQuery default when the configuration and type are missing", () => {
    expect(eventForwarderDestinationFromDatasource({})).toEqual(
      defaultEventForwarderDestination("bigquery"),
    );
  });
});
