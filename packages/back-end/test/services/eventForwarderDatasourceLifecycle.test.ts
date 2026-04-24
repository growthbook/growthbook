import type { EventForwarderConfigInterface } from "shared/validators";
import type { DataSourceInterface } from "shared/types/datasource";
import { syncEventForwarderAfterDatasourceDeleted } from "back-end/src/services/eventForwarderDatasourceLifecycle";
import * as configInit from "back-end/src/init/config";
import * as provisioning from "back-end/src/services/eventForwarderProvisioning";

jest.mock("back-end/src/init/config");
jest.mock("back-end/src/services/eventForwarderProvisioning");

const mockedUsingFileConfig = configInit.usingFileConfig as jest.MockedFunction<
  typeof configInit.usingFileConfig
>;
const mockedTeardown =
  provisioning.teardownBigQueryEventForwarderInfrastructure as jest.MockedFunction<
    typeof provisioning.teardownBigQueryEventForwarderInfrastructure
  >;

function bqDatasource(id: string): DataSourceInterface {
  return {
    id,
    organization: "org1",
    name: "bq",
    type: "bigquery",
    description: "",
    params: {} as DataSourceInterface["params"],
    settings: {} as DataSourceInterface["settings"],
    projects: ["p1"],
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
}

describe("syncEventForwarderAfterDatasourceDeleted", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUsingFileConfig.mockReturnValue(false);
  });

  it("looks up by datasource id, tears down BigQuery Confluent, and cascade-deletes the row", async () => {
    const existing: EventForwarderConfigInterface = {
      id: "efc_1",
      organization: "org1",
      datasourceId: "ds_a",
      projects: ["p1"],
      topic: "topic-a",
      schemaId: 1,
      sinkType: "bigquery",
      config: "{}",
      status: "ready",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    const deleteForDatasourceCascade = jest.fn().mockResolvedValue(undefined);
    const dangerousGetByDatasourceIdBypassPermission = jest
      .fn()
      .mockResolvedValue(existing);

    const context = {
      org: { id: "org1" },
      models: {
        eventForwarderConfigs: {
          dangerousGetByDatasourceIdBypassPermission,
          deleteForDatasourceCascade,
        },
      },
    };

    await syncEventForwarderAfterDatasourceDeleted(
      context as never,
      bqDatasource("ds_a"),
    );

    expect(dangerousGetByDatasourceIdBypassPermission).toHaveBeenCalledWith(
      "ds_a",
    );
    expect(mockedTeardown).toHaveBeenCalledWith(existing);
    expect(deleteForDatasourceCascade).toHaveBeenCalledWith(existing);
  });

  it("does nothing when no event forwarder exists for that datasource", async () => {
    const dangerousGetByDatasourceIdBypassPermission = jest
      .fn()
      .mockResolvedValue(null);
    const deleteForDatasourceCascade = jest.fn();

    const context = {
      org: { id: "org1" },
      models: {
        eventForwarderConfigs: {
          dangerousGetByDatasourceIdBypassPermission,
          deleteForDatasourceCascade,
        },
      },
    };

    await syncEventForwarderAfterDatasourceDeleted(
      context as never,
      bqDatasource("ds_missing"),
    );

    expect(mockedTeardown).not.toHaveBeenCalled();
    expect(deleteForDatasourceCascade).not.toHaveBeenCalled();
  });

  it("deletes the row without Confluent teardown for non-BigQuery sinks", async () => {
    const existing: EventForwarderConfigInterface = {
      id: "efc_s",
      organization: "org1",
      datasourceId: "ds_s",
      projects: ["p1"],
      topic: "topic-s",
      schemaId: 1,
      sinkType: "snowflake",
      config: "{}",
      status: "ready",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    const deleteForDatasourceCascade = jest.fn().mockResolvedValue(undefined);
    const dangerousGetByDatasourceIdBypassPermission = jest
      .fn()
      .mockResolvedValue(existing);

    const context = {
      org: { id: "org1" },
      models: {
        eventForwarderConfigs: {
          dangerousGetByDatasourceIdBypassPermission,
          deleteForDatasourceCascade,
        },
      },
    };

    const snowflakeDs: DataSourceInterface = {
      ...bqDatasource("ds_s"),
      type: "snowflake",
    };

    await syncEventForwarderAfterDatasourceDeleted(
      context as never,
      snowflakeDs,
    );

    expect(mockedTeardown).not.toHaveBeenCalled();
    expect(deleteForDatasourceCascade).toHaveBeenCalledWith(existing);
  });

  it("invokes teardown only for the forwarder tied to the deleted datasource id", async () => {
    const existingA: EventForwarderConfigInterface = {
      id: "efc_a",
      organization: "org1",
      datasourceId: "ds_a",
      projects: ["p1"],
      topic: "topic-a",
      schemaId: 1,
      sinkType: "bigquery",
      config: "{}",
      status: "ready",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };
    const existingB: EventForwarderConfigInterface = {
      ...existingA,
      id: "efc_b",
      datasourceId: "ds_b",
      topic: "topic-b",
    };

    const dangerousGetByDatasourceIdBypassPermission = jest
      .fn()
      .mockImplementation((datasourceId: string) => {
        if (datasourceId === "ds_a") return Promise.resolve(existingA);
        if (datasourceId === "ds_b") return Promise.resolve(existingB);
        return Promise.resolve(null);
      });
    const deleteForDatasourceCascade = jest.fn().mockResolvedValue(undefined);

    const context = {
      org: { id: "org1" },
      models: {
        eventForwarderConfigs: {
          dangerousGetByDatasourceIdBypassPermission,
          deleteForDatasourceCascade,
        },
      },
    };

    await syncEventForwarderAfterDatasourceDeleted(
      context as never,
      bqDatasource("ds_a"),
    );
    expect(mockedTeardown).toHaveBeenCalledTimes(1);
    expect(mockedTeardown).toHaveBeenCalledWith(existingA);
    expect(deleteForDatasourceCascade).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockedUsingFileConfig.mockReturnValue(false);

    await syncEventForwarderAfterDatasourceDeleted(
      context as never,
      bqDatasource("ds_b"),
    );
    expect(mockedTeardown).toHaveBeenCalledTimes(1);
    expect(mockedTeardown).toHaveBeenCalledWith(existingB);
  });
});
