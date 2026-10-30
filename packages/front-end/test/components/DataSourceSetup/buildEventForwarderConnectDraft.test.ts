import { DataSourceType } from "shared/types/datasource";
import {
  EventForwarderConfigDraft,
  EventForwarderConfigWithMetadata,
  EventForwarderStatus,
} from "shared/types/event-forwarder";
import {
  buildEventForwarderConnectDraft,
  buildEventForwarderRetryDraft,
} from "@/components/DataSourceSetup/buildEventForwarderConnectDraft";
import { EventForwarderDestination } from "@/components/DataSourceSetup/EventForwarderDestinationFields";

const destination = (
  overrides: Partial<EventForwarderDestination> = {},
): EventForwarderDestination => ({
  location: "events_dest",
  tablePrefix: "gb",
  zerobusEndpoint: "",
  ...overrides,
});

describe("buildEventForwarderConnectDraft", () => {
  it("returns null for an unsupported datasource type", () => {
    expect(
      buildEventForwarderConnectDraft({
        type: "postgres" as DataSourceType,
        params: {},
        destination: destination(),
        region: "us-east-1",
      }),
    ).toBe(null);
  });

  it("omits the region when none is chosen yet", () => {
    const draft = buildEventForwarderConnectDraft({
      type: "bigquery",
      params: {},
      destination: destination(),
      region: null,
    });
    expect(draft).not.toHaveProperty("region");
  });

  describe("bigquery", () => {
    it("prefers defaultProject over projectId and sends the destination as the dataset", () => {
      const draft = buildEventForwarderConnectDraft({
        type: "bigquery",
        params: { projectId: "raw-project", defaultProject: "default-project" },
        destination: destination({ location: "gb_events" }),
        region: "us-east-1",
      });
      expect(draft).toMatchObject({
        sinkType: "bigquery",
        region: "us-east-1",
        config: {
          projectId: "default-project",
          dataset: "gb_events",
          tablePrefix: "gb",
        },
      });
    });

    it("falls back to projectId when there is no default project", () => {
      const draft = buildEventForwarderConnectDraft({
        type: "bigquery",
        params: { projectId: "raw-project" },
        destination: destination(),
        region: "us-east-1",
      });
      expect(draft?.sinkType === "bigquery" && draft.config.projectId).toBe(
        "raw-project",
      );
    });

    it("strips a leading BOM from the service account JSON", () => {
      const draft = buildEventForwarderConnectDraft({
        type: "bigquery",
        params: { serviceAccountJson: '\uFEFF{"ok":true}' },
        destination: destination(),
        region: "us-east-1",
      });
      expect(
        draft?.sinkType === "bigquery" && draft.config.serviceAccountKey,
      ).toBe('{"ok":true}');
    });

    it("omits serviceAccountKey when the form has none", () => {
      const draft = buildEventForwarderConnectDraft({
        type: "bigquery",
        params: {},
        destination: destination(),
        region: "us-east-1",
      });
      expect(draft).not.toHaveProperty("config.serviceAccountKey");
    });
  });

  describe("snowflake", () => {
    it("sends the destination as the schema and keeps role/warehouse from the form", () => {
      const draft = buildEventForwarderConnectDraft({
        type: "snowflake",
        params: {
          database: "DB",
          role: "GROWTHBOOK_ROLE",
          warehouse: "WH",
          accessUrl: "https://org.snowflakecomputing.com",
        },
        destination: destination({ location: "EVENTS" }),
        region: "eu-west-1",
      });
      expect(draft).toMatchObject({
        sinkType: "snowflake",
        region: "eu-west-1",
        config: {
          database: "DB",
          schema: "EVENTS",
          tablePrefix: "gb",
          role: "GROWTHBOOK_ROLE",
          warehouse: "WH",
          accessUrl: "https://org.snowflakecomputing.com",
        },
      });
    });

    it("derives the access URL from the account when none is entered", () => {
      const draft = buildEventForwarderConnectDraft({
        type: "snowflake",
        params: { account: "xy12345.us-east-1" },
        destination: destination(),
        region: "us-east-1",
      });
      expect(
        draft?.sinkType === "snowflake" && draft.config.accessUrl,
      ).toContain("xy12345");
    });

    it("omits role, warehouse, and accessUrl when the form has none of them", () => {
      const draft = buildEventForwarderConnectDraft({
        type: "snowflake",
        params: {},
        destination: destination(),
        region: "us-east-1",
      });
      expect(draft).not.toHaveProperty("config.role");
      expect(draft).not.toHaveProperty("config.warehouse");
      expect(draft).not.toHaveProperty("config.accessUrl");
    });
  });

  describe("databricks", () => {
    it("sends the destination as the schema and keeps the form's catalog", () => {
      const draft = buildEventForwarderConnectDraft({
        type: "databricks",
        params: { catalog: "main" },
        destination: destination({
          location: "gb_events",
          zerobusEndpoint: "https://ws.zerobus.us-east-1.cloud.databricks.com",
        }),
        region: "us-east-1",
      });
      expect(draft).toMatchObject({
        sinkType: "databricks",
        region: "us-east-1",
        config: {
          catalog: "main",
          schema: "gb_events",
          tablePrefix: "gb",
          zerobusEndpoint: "https://ws.zerobus.us-east-1.cloud.databricks.com",
        },
      });
    });
  });
});

function metadata(
  config: EventForwarderConfigDraft,
  status: EventForwarderStatus = "error",
): EventForwarderConfigWithMetadata {
  return {
    ...config,
    status,
    connectorName: "connector-1",
    connectorId: "connector-id-1",
  } as EventForwarderConfigWithMetadata;
}

describe("buildEventForwarderRetryDraft", () => {
  it("behaves like a brand-new connect flow when there is no existing config", () => {
    const draft = buildEventForwarderRetryDraft({
      type: "bigquery",
      params: { defaultProject: "live-project" },
      eventForwarderConfig: null,
      destination: destination({ location: "gb_events" }),
      region: "us-east-1",
    });
    expect(draft).toMatchObject({
      sinkType: "bigquery",
      config: { projectId: "live-project", dataset: "gb_events" },
    });
  });

  it("behaves like a brand-new connect flow when the existing config never got a destination (unconfigured)", () => {
    const existing = metadata(
      {
        sinkType: "bigquery",
        config: { projectId: "", dataset: "", tablePrefix: "" },
      },
      "unconfigured",
    );
    const draft = buildEventForwarderRetryDraft({
      type: "bigquery",
      params: { defaultProject: "live-project" },
      eventForwarderConfig: existing,
      destination: destination({ location: "gb_events" }),
      region: "us-east-1",
    });
    expect(draft).toMatchObject({
      sinkType: "bigquery",
      config: { projectId: "live-project", dataset: "gb_events" },
    });
  });

  it("preserves the saved BigQuery project over the connection's current default project", () => {
    const existing = metadata({
      sinkType: "bigquery",
      config: {
        projectId: "saved-project",
        dataset: "old_dataset",
        tablePrefix: "old",
      },
    });
    const draft = buildEventForwarderRetryDraft({
      type: "bigquery",
      params: { defaultProject: "different-project-now" },
      eventForwarderConfig: existing,
      destination: destination({ location: "gb_events", tablePrefix: "gb" }),
      region: "us-east-1",
    });
    expect(draft).toMatchObject({
      sinkType: "bigquery",
      config: {
        // Preserved from the saved forwarder, not re-derived from params.
        projectId: "saved-project",
        // Destination fields reflect what was just edited on this step.
        dataset: "gb_events",
        tablePrefix: "gb",
      },
    });
  });

  it("preserves the saved Snowflake database, role, and warehouse, and uses the current access URL", () => {
    const existing = metadata({
      sinkType: "snowflake",
      config: {
        database: "SAVED_DB",
        schema: "OLD_SCHEMA",
        tablePrefix: "OLD",
        role: "SAVED_ROLE",
        warehouse: "SAVED_WH",
        accessUrl: "https://saved.snowflakecomputing.com",
      },
    });
    const draft = buildEventForwarderRetryDraft({
      type: "snowflake",
      params: {
        database: "CURRENT_DB",
        role: "CURRENT_ROLE",
        warehouse: "CURRENT_WH",
        accessUrl: "https://current.snowflakecomputing.com",
      },
      eventForwarderConfig: existing,
      destination: destination({ location: "NEW_SCHEMA" }),
      region: "us-east-1",
    });
    expect(draft).toMatchObject({
      sinkType: "snowflake",
      config: {
        database: "SAVED_DB",
        role: "SAVED_ROLE",
        warehouse: "SAVED_WH",
        accessUrl: "https://current.snowflakecomputing.com",
        schema: "NEW_SCHEMA",
      },
    });
  });

  it("replaces a saved Snowflake access URL when the account is corrected", () => {
    const existing = metadata({
      sinkType: "snowflake",
      config: {
        database: "SAVED_DB",
        schema: "OLD_SCHEMA",
        tablePrefix: "OLD",
        accessUrl: "https://saved.snowflakecomputing.com",
      },
    });
    const draft = buildEventForwarderRetryDraft({
      type: "snowflake",
      params: { account: "xy12345.us-east-1", database: "CURRENT_DB" },
      eventForwarderConfig: existing,
      destination: destination({ location: "NEW_SCHEMA" }),
      region: "us-east-1",
    });
    expect(draft).toMatchObject({
      sinkType: "snowflake",
      config: {
        database: "SAVED_DB",
        schema: "NEW_SCHEMA",
        accessUrl: "https://xy12345.us-east-1.snowflakecomputing.com",
      },
    });
  });

  it("preserves the saved Databricks catalog over the connection's current one", () => {
    const existing = metadata({
      sinkType: "databricks",
      config: {
        catalog: "saved_catalog",
        schema: "old_schema",
        tablePrefix: "old",
        zerobusEndpoint: "https://old.zerobus.databricks.com",
      },
    });
    const draft = buildEventForwarderRetryDraft({
      type: "databricks",
      params: { catalog: "different_catalog_now" },
      eventForwarderConfig: existing,
      destination: destination({
        location: "new_schema",
        zerobusEndpoint: "https://new.zerobus.databricks.com",
      }),
      region: "us-east-1",
    });
    expect(draft).toMatchObject({
      sinkType: "databricks",
      config: {
        catalog: "saved_catalog",
        schema: "new_schema",
        zerobusEndpoint: "https://new.zerobus.databricks.com",
      },
    });
  });

  it("derives fresh values when the existing config is for a different sink type", () => {
    const existing = metadata({
      sinkType: "snowflake",
      config: {
        database: "SAVED_DB",
        schema: "SAVED_SCHEMA",
        tablePrefix: "SAVED",
      },
    });
    const draft = buildEventForwarderRetryDraft({
      type: "bigquery",
      params: { defaultProject: "live-project" },
      eventForwarderConfig: existing,
      destination: destination({ location: "gb_events" }),
      region: "us-east-1",
    });
    expect(draft).toMatchObject({
      sinkType: "bigquery",
      config: { projectId: "live-project", dataset: "gb_events" },
    });
  });
});
