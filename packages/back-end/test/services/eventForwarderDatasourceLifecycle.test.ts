import type { EventForwarderConfigInterface } from "shared/validators";
import type { DataSourceInterface } from "shared/types/datasource";
import {
  deleteEventForwarderConfigForDatasource,
  syncEventForwarderAfterDatasourceDeleted,
} from "back-end/src/services/eventForwarder/datasourceLifecycle";
import { syncEventForwarderConfigFromDatasource } from "back-end/src/services/eventForwarder/config";
import * as configInit from "back-end/src/init/config";
import * as provisioning from "back-end/src/services/eventForwarder/connector";

jest.mock("back-end/src/init/config");
jest.mock("back-end/src/services/eventForwarder/connector", () => ({
  teardownEventForwarderInfrastructureRemote: jest.fn(),
}));

const mockedUsingFileConfig = configInit.usingFileConfig as jest.MockedFunction<
  typeof configInit.usingFileConfig
>;
const mockedTeardownRemote =
  provisioning.teardownEventForwarderInfrastructureRemote as jest.MockedFunction<
    typeof provisioning.teardownEventForwarderInfrastructureRemote
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
    mockedTeardownRemote.mockResolvedValue(undefined);
  });

  it("tears down Confluent before cascade-deleting the row for BigQuery", async () => {
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

    const callOrder: string[] = [];
    const deleteForDatasourceCascade = jest
      .fn()
      .mockImplementation(async () => {
        callOrder.push("delete");
      });
    mockedTeardownRemote.mockImplementation(async () => {
      callOrder.push("teardown");
    });
    const getByDatasourceIdForDatasourceCascade = jest
      .fn()
      .mockResolvedValue(existing);

    const context = {
      org: { id: "org1" },
      auditLog: jest.fn().mockResolvedValue(undefined),
      models: {
        eventForwarderConfigs: {
          getByDatasourceIdForDatasourceCascade,
          deleteForDatasourceCascade,
        },
      },
    };

    await syncEventForwarderAfterDatasourceDeleted(
      context as never,
      bqDatasource("ds_a"),
    );

    expect(getByDatasourceIdForDatasourceCascade).toHaveBeenCalledWith("ds_a");
    expect(deleteForDatasourceCascade).toHaveBeenCalledWith(existing);
    expect(mockedTeardownRemote).toHaveBeenCalledWith({
      organizationId: "org1",
      datasourceId: "ds_a",
      sinkType: "bigquery",
      topic: "topic-a",
      connectorName: undefined,
      connectorId: undefined,
    });
    expect(callOrder).toEqual(["teardown", "delete"]);
  });

  it("tears down Confluent before cascade-deleting the row for Snowflake", async () => {
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

    const callOrder: string[] = [];
    const deleteForDatasourceCascade = jest
      .fn()
      .mockImplementation(async () => {
        callOrder.push("delete");
      });
    mockedTeardownRemote.mockImplementation(async () => {
      callOrder.push("teardown");
    });
    const getByDatasourceIdForDatasourceCascade = jest
      .fn()
      .mockResolvedValue(existing);

    const context = {
      org: { id: "org1" },
      auditLog: jest.fn(),
      models: {
        eventForwarderConfigs: {
          getByDatasourceIdForDatasourceCascade,
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

    expect(deleteForDatasourceCascade).toHaveBeenCalledWith(existing);
    expect(mockedTeardownRemote).toHaveBeenCalledWith({
      organizationId: "org1",
      datasourceId: "ds_s",
      sinkType: "snowflake",
      topic: "topic-s",
      connectorName: undefined,
      connectorId: undefined,
    });
    expect(callOrder).toEqual(["teardown", "delete"]);
  });

  it("does nothing when no event forwarder exists for that datasource", async () => {
    const getByDatasourceIdForDatasourceCascade = jest
      .fn()
      .mockResolvedValue(null);
    const deleteForDatasourceCascade = jest.fn();

    const context = {
      org: { id: "org1" },
      auditLog: jest.fn(),
      models: {
        eventForwarderConfigs: {
          getByDatasourceIdForDatasourceCascade,
          deleteForDatasourceCascade,
        },
      },
    };

    await syncEventForwarderAfterDatasourceDeleted(
      context as never,
      bqDatasource("ds_missing"),
    );

    expect(mockedTeardownRemote).not.toHaveBeenCalled();
    expect(deleteForDatasourceCascade).not.toHaveBeenCalled();
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

    const getByDatasourceIdForDatasourceCascade = jest
      .fn()
      .mockImplementation((datasourceId: string) => {
        if (datasourceId === "ds_a") return Promise.resolve(existingA);
        if (datasourceId === "ds_b") return Promise.resolve(existingB);
        return Promise.resolve(null);
      });
    const deleteForDatasourceCascade = jest.fn().mockResolvedValue(undefined);

    const context = {
      org: { id: "org1" },
      auditLog: jest.fn().mockResolvedValue(undefined),
      models: {
        eventForwarderConfigs: {
          getByDatasourceIdForDatasourceCascade,
          deleteForDatasourceCascade,
        },
      },
    };

    await syncEventForwarderAfterDatasourceDeleted(
      context as never,
      bqDatasource("ds_a"),
    );
    expect(mockedTeardownRemote).toHaveBeenCalledTimes(1);
    expect(mockedTeardownRemote).toHaveBeenCalledWith({
      organizationId: "org1",
      datasourceId: "ds_a",
      sinkType: "bigquery",
      topic: "topic-a",
      connectorName: undefined,
      connectorId: undefined,
    });
    expect(deleteForDatasourceCascade).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockedUsingFileConfig.mockReturnValue(false);
    mockedTeardownRemote.mockResolvedValue(undefined);

    await syncEventForwarderAfterDatasourceDeleted(
      context as never,
      bqDatasource("ds_b"),
    );
    expect(mockedTeardownRemote).toHaveBeenCalledTimes(1);
    expect(mockedTeardownRemote).toHaveBeenCalledWith({
      organizationId: "org1",
      datasourceId: "ds_b",
      sinkType: "bigquery",
      topic: "topic-b",
      connectorName: undefined,
      connectorId: undefined,
    });
  });

  it("audits and throws when license-server teardown fails without deleting Mongo row", async () => {
    const existing: EventForwarderConfigInterface = {
      id: "efc_err",
      organization: "org1",
      datasourceId: "ds_err",
      projects: ["p1"],
      topic: "topic-err",
      schemaId: 1,
      sinkType: "bigquery",
      config: "{}",
      status: "ready",
      connectorName: "c1",
      connectorId: "lcc-abc",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    const deleteForDatasourceCascade = jest.fn().mockResolvedValue(undefined);
    const getByDatasourceIdForDatasourceCascade = jest
      .fn()
      .mockResolvedValue(existing);
    const auditLog = jest.fn().mockResolvedValue(undefined);
    mockedTeardownRemote.mockRejectedValue(new Error("license server down"));

    const context = {
      org: { id: "org1" },
      auditLog,
      models: {
        eventForwarderConfigs: {
          getByDatasourceIdForDatasourceCascade,
          deleteForDatasourceCascade,
        },
      },
    };

    await expect(
      syncEventForwarderAfterDatasourceDeleted(
        context as never,
        bqDatasource("ds_err"),
      ),
    ).rejects.toThrow(/Event forwarder Confluent teardown failed/);

    expect(deleteForDatasourceCascade).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "eventForwarderConfig.teardownFailure",
        entity: expect.objectContaining({
          object: "eventForwarderConfig",
          id: "efc_err",
        }),
      }),
    );
  });
});

describe("deleteEventForwarderConfigForDatasource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedTeardownRemote.mockResolvedValue(undefined);
  });

  it("tears down Confluent before permission-deleting the row", async () => {
    const existing: EventForwarderConfigInterface = {
      id: "efc_delete",
      organization: "org1",
      datasourceId: "ds_delete",
      projects: ["p1"],
      topic: "topic-delete",
      schemaId: 1,
      sinkType: "bigquery",
      config: "{}",
      status: "ready",
      connectorName: "connector-delete",
      connectorId: "lcc-delete",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    const callOrder: string[] = [];
    const deleteConfig = jest.fn().mockImplementation(async () => {
      callOrder.push("delete");
    });
    mockedTeardownRemote.mockImplementation(async () => {
      callOrder.push("teardown");
    });
    const context = {
      org: { id: "org1" },
      auditLog: jest.fn().mockResolvedValue(undefined),
      models: {
        eventForwarderConfigs: {
          delete: deleteConfig,
        },
      },
    };

    await deleteEventForwarderConfigForDatasource(
      context as never,
      bqDatasource("ds_delete"),
      existing,
    );

    expect(deleteConfig).toHaveBeenCalledWith(existing);
    expect(mockedTeardownRemote).toHaveBeenCalledWith({
      organizationId: "org1",
      datasourceId: "ds_delete",
      sinkType: "bigquery",
      topic: "topic-delete",
      connectorName: "connector-delete",
      connectorId: "lcc-delete",
    });
    expect(callOrder).toEqual(["teardown", "delete"]);
  });

  it("still tears down and deletes when datasource type no longer maps to a sink", async () => {
    const existing: EventForwarderConfigInterface = {
      id: "efc_orphan",
      organization: "org1",
      datasourceId: "ds_orphan",
      projects: ["p1"],
      topic: "topic-orphan",
      schemaId: 1,
      sinkType: "bigquery",
      config: "{}",
      status: "ready",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    const callOrder: string[] = [];
    const deleteConfig = jest.fn().mockImplementation(async () => {
      callOrder.push("delete");
    });
    mockedTeardownRemote.mockImplementation(async () => {
      callOrder.push("teardown");
    });
    const context = {
      org: { id: "org1" },
      auditLog: jest.fn().mockResolvedValue(undefined),
      models: {
        eventForwarderConfigs: {
          delete: deleteConfig,
        },
      },
    };

    await deleteEventForwarderConfigForDatasource(
      context as never,
      {
        ...bqDatasource("ds_orphan"),
        type: "postgres",
      },
      existing,
    );

    expect(deleteConfig).toHaveBeenCalledWith(existing);
    expect(mockedTeardownRemote).toHaveBeenCalledWith({
      organizationId: "org1",
      datasourceId: "ds_orphan",
      sinkType: "bigquery",
      topic: "topic-orphan",
      connectorName: undefined,
      connectorId: undefined,
    });
    expect(callOrder).toEqual(["teardown", "delete"]);
  });
});

describe("syncEventForwarderConfigFromDatasource draft null", () => {
  it("returns null on create when draft is null and no existing config", async () => {
    const getByDatasourceId = jest.fn().mockResolvedValue(null);
    const deleteConfig = jest.fn();
    const context = {
      org: { id: "org1" },
      models: {
        eventForwarderConfigs: {
          getByDatasourceId,
          delete: deleteConfig,
        },
      },
    };

    const result = await syncEventForwarderConfigFromDatasource({
      context: context as never,
      datasource: bqDatasource("ds_new"),
      draft: null,
    });

    expect(result).toBeNull();
    expect(getByDatasourceId).toHaveBeenCalledWith("ds_new");
    expect(deleteConfig).not.toHaveBeenCalled();
  });

  it("throws when draft is null and an existing config would be removed", async () => {
    const existing: EventForwarderConfigInterface = {
      id: "efc_existing",
      organization: "org1",
      datasourceId: "ds_existing",
      projects: ["p1"],
      topic: "topic-existing",
      schemaId: 1,
      sinkType: "bigquery",
      config: "{}",
      status: "ready",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };
    const getByDatasourceId = jest.fn().mockResolvedValue(existing);
    const deleteConfig = jest.fn();
    const context = {
      org: { id: "org1" },
      models: {
        eventForwarderConfigs: {
          getByDatasourceId,
          delete: deleteConfig,
        },
      },
    };

    await expect(
      syncEventForwarderConfigFromDatasource({
        context: context as never,
        datasource: bqDatasource("ds_existing"),
        draft: null,
      }),
    ).rejects.toThrow(/Cannot remove an Event Forwarder via datasource update/);

    expect(getByDatasourceId).toHaveBeenCalledWith("ds_existing");
    expect(deleteConfig).not.toHaveBeenCalled();
  });
});
