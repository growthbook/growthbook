import { EventForwarderConfigInterface } from "shared/validators";
import { AES } from "crypto-js";
import {
  getEventForwarderForDatasource,
  isEventForwarderDraftUnchanged,
  stripEventForwarderConfigMetadata,
  toEventForwarderConfigDraft,
} from "back-end/src/services/eventForwarder/config";

const ENCRYPTION_KEY = "test-encryption-key-for-event-forwarder!!";

jest.mock("back-end/src/util/secrets", () => ({
  ENCRYPTION_KEY: "test-encryption-key-for-event-forwarder!!",
}));

function encryptConfig(config: Record<string, unknown>): string {
  return AES.encrypt(JSON.stringify(config), ENCRYPTION_KEY).toString();
}

function bqExisting(): EventForwarderConfigInterface {
  return {
    id: "ef_1",
    organization: "org1",
    datasourceId: "ds_1",
    projects: [],
    topic: "gb-events-org1-ds_1",
    schemaId: 100,
    sinkType: "bigquery",
    config: encryptConfig({
      projectId: "my-project",
      dataset: "analytics",
      tablePrefix: "gb",
      serviceAccountKey: "secret-key",
    }),
    status: "ready",
    connectorName: "connector-1",
    connectorId: "lcc-1",
    lastProvisioningError: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
}

describe("isEventForwarderDraftUnchanged", () => {
  it("returns true when incoming draft matches stored config ignoring metadata", () => {
    const existing = bqExisting();
    const draft = toEventForwarderConfigDraft(existing);
    expect(draft).not.toBeNull();

    expect(
      isEventForwarderDraftUnchanged(
        {
          ...draft!,
          status: "ready",
          connectorName: "connector-1",
          connectorId: "lcc-1",
          lastProvisioningError: "",
        },
        existing,
      ),
    ).toBe(true);
  });

  it("returns false when sink destination changes", () => {
    const existing = bqExisting();
    const draft = toEventForwarderConfigDraft(existing);

    expect(
      isEventForwarderDraftUnchanged(
        {
          sinkType: "bigquery",
          config: {
            ...draft!.config,
            dataset: "other_dataset",
            tablePrefix: "other",
          },
        },
        existing,
      ),
    ).toBe(false);
  });

  it("returns false when no stored config exists", () => {
    expect(
      isEventForwarderDraftUnchanged(
        {
          sinkType: "bigquery",
          config: {
            projectId: "my-project",
            dataset: "analytics",
            tablePrefix: "gb",
          },
        },
        null,
      ),
    ).toBe(false);
  });

  it("stripEventForwarderConfigMetadata removes read-only fields", () => {
    expect(
      stripEventForwarderConfigMetadata({
        sinkType: "bigquery",
        config: {
          projectId: "my-project",
          dataset: "analytics",
          tablePrefix: "gb",
        },
        status: "ready",
        connectorName: "c1",
      }),
    ).toEqual({
      sinkType: "bigquery",
      config: {
        projectId: "my-project",
        dataset: "analytics",
        tablePrefix: "gb",
      },
    });
  });
});

describe("event forwarder datasource lookup helpers", () => {
  it("loads one event forwarder by datasource id through the model helper", async () => {
    const existing = bqExisting();
    const getByDatasourceId = jest.fn().mockResolvedValue(existing);
    const context = {
      models: {
        eventForwarderConfigs: {
          getByDatasourceId,
        },
      },
    };

    await expect(
      getEventForwarderForDatasource(context as never, "ds_1"),
    ).resolves.toEqual(existing);
    expect(getByDatasourceId).toHaveBeenCalledWith("ds_1");
  });
});
