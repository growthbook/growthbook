import { EventForwarderConfigInterface } from "shared/validators";
import { DataSourceType } from "shared/types/datasource";
import {
  BigQueryEventForwarderStoredConfig,
  DatabricksEventForwarderStoredConfig,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import {
  createUnconfiguredEventForwarderConfig,
  decryptEventForwarderConfigModel,
  recordEventForwarderCreateFailure,
} from "back-end/src/services/eventForwarder/config";

jest.mock("back-end/src/util/secrets", () => ({
  ENCRYPTION_KEY: "test-encryption-key-for-event-forwarder!!",
}));

function context(existing: EventForwarderConfigInterface | null = null) {
  const create = jest.fn(async (doc: Record<string, unknown>) => ({
    id: "ef_new",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...doc,
  }));
  const update = jest.fn(
    async (row: EventForwarderConfigInterface, patch: object) => ({
      ...row,
      ...patch,
    }),
  );
  return {
    models: {
      eventForwarderConfigs: {
        getByDatasourceId: jest.fn(async () => existing),
        create,
        update,
      },
    },
    create,
    update,
  };
}

function datasource(type: DataSourceType) {
  return {
    id: "ds_1",
    organization: "org_1",
    projects: ["proj_b", "proj_a"],
    type,
  };
}

describe("createUnconfiguredEventForwarderConfig", () => {
  it("returns null for a datasource type that cannot host an Event Forwarder", async () => {
    const ctx = context();

    const created = await createUnconfiguredEventForwarderConfig({
      context: ctx as never,
      datasource: datasource("postgres"),
      region: "us-east-1",
    });

    expect(created).toBeNull();
    expect(ctx.create).not.toHaveBeenCalled();
  });

  it("returns the existing config without creating another", async () => {
    const existing = {
      id: "ef_existing",
      status: "error",
    } as EventForwarderConfigInterface;
    const ctx = context(existing);

    const created = await createUnconfiguredEventForwarderConfig({
      context: ctx as never,
      datasource: datasource("snowflake"),
      region: "eu-west-1",
    });

    expect(created).toBe(existing);
    expect(ctx.create).not.toHaveBeenCalled();
  });

  it.each(["bigquery", "snowflake", "databricks"] as const)(
    "creates an empty unconfigured %s config",
    async (type) => {
      const ctx = context();

      const created = await createUnconfiguredEventForwarderConfig({
        context: ctx as never,
        datasource: datasource(type),
        region: "eu-west-1",
      });

      expect(ctx.create).toHaveBeenCalledWith(
        expect.objectContaining({
          datasourceId: "ds_1",
          projects: ["proj_a", "proj_b"],
          topic: `event_forwarder_${type}`,
          schemaId: 0,
          sinkType: type,
          region: "eu-west-1",
          status: "unconfigured",
          connectorName: "",
          connectorId: "",
          lastProvisioningError: "",
        }),
      );
      expect(created?.status).toBe("unconfigured");

      const stored = decryptEventForwarderConfigModel(
        created as EventForwarderConfigInterface,
      );
      if (type === "bigquery") {
        const bigquery = stored as BigQueryEventForwarderStoredConfig;
        expect(bigquery.projectId).toBe("");
        expect(bigquery.dataset).toBe("");
        expect(bigquery.serviceAccountKey).toBe("");
      } else if (type === "snowflake") {
        const snowflake = stored as SnowflakeEventForwarderStoredConfig;
        expect(snowflake.database).toBe("");
        expect(snowflake.schema).toBe("");
        expect(snowflake.privateKey).toBe("");
      } else {
        const databricks = stored as DatabricksEventForwarderStoredConfig;
        expect(databricks.catalog).toBe("");
        expect(databricks.schema).toBe("");
        expect(databricks.oauthClientSecret).toBe("");
      }
    },
  );
});

describe("recordEventForwarderCreateFailure", () => {
  it("marks an existing config as failed without creating another", async () => {
    const existing = {
      id: "ef_existing",
      datasourceId: "ds_1",
      sinkType: "bigquery",
      status: "unconfigured",
      config: "encrypted",
    } as EventForwarderConfigInterface;
    const ctx = context(existing);

    await recordEventForwarderCreateFailure({
      context: ctx as never,
      datasource: datasource("bigquery"),
      region: "us-east-1",
      message: "Could not provision the connector",
    });

    expect(ctx.create).not.toHaveBeenCalled();
    expect(ctx.update).toHaveBeenCalledWith(existing, {
      status: "error",
      lastProvisioningError: "Could not provision the connector",
    });
  });

  it("creates an empty config and then marks that row as failed", async () => {
    const ctx = context();

    await recordEventForwarderCreateFailure({
      context: ctx as never,
      datasource: datasource("databricks"),
      region: "eu-west-1",
      message: "License server rejected the request",
    });

    expect(ctx.create).toHaveBeenCalledTimes(1);
    const created = (await ctx.create.mock.results[0]
      .value) as EventForwarderConfigInterface;
    expect(ctx.update).toHaveBeenCalledWith(created, {
      status: "error",
      lastProvisioningError: "License server rejected the request",
    });
    expect(
      decryptEventForwarderConfigModel<DatabricksEventForwarderStoredConfig>(
        created,
      ).catalog,
    ).toBe("");
  });

  it("does nothing when the datasource cannot host an Event Forwarder", async () => {
    const ctx = context();

    await recordEventForwarderCreateFailure({
      context: ctx as never,
      datasource: datasource("postgres"),
      region: "us-east-1",
      message: "unused",
    });

    expect(ctx.create).not.toHaveBeenCalled();
    expect(ctx.update).not.toHaveBeenCalled();
  });
});
