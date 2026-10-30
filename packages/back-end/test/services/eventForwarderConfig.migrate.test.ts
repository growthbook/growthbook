import { AES, enc } from "crypto-js";
import { EventForwarderConfigInterface } from "shared/validators";
import { migrateEventForwarderToInHouseConsumer } from "back-end/src/services/eventForwarder/config";
import { ENCRYPTION_KEY } from "back-end/src/util/secrets";

const bqParams = { projectId: "proj", defaultDataset: "ds" } as never;

function encrypt(config: Record<string, unknown>): string {
  return AES.encrypt(JSON.stringify(config), ENCRYPTION_KEY).toString();
}

function decrypt(encrypted: string): Record<string, unknown> {
  return JSON.parse(AES.decrypt(encrypted, ENCRYPTION_KEY).toString(enc.Utf8));
}

function legacyBigQueryConfig(
  overrides: Partial<EventForwarderConfigInterface> = {},
): EventForwarderConfigInterface {
  return {
    id: "ef_1",
    organization: "org1",
    datasourceId: "ds_1",
    projects: [],
    topic: "gb-events-org1-ds_1",
    schemaId: 42,
    sinkType: "bigquery",
    region: "us-east-1",
    // Pre-consumer rows have no `tables`.
    config: encrypt({
      projectId: "proj",
      dataset: "ds",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    }),
    status: "ready",
    connectorName: "lcc-connector",
    connectorId: "lcc-123",
    lastProvisioningError: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  } as EventForwarderConfigInterface;
}

// `stored` is what the CAS re-read sees; defaults to the row passed in.
function mockContext(stored?: EventForwarderConfigInterface) {
  const update = jest
    .fn()
    .mockImplementation(async (id, guardFields, compute) => {
      const fresh = stored ?? legacyBigQueryConfig({ id });
      const changes = await compute(fresh);
      return changes ? { ...fresh, ...changes } : null;
    });
  const auditLog = jest.fn().mockResolvedValue(undefined);
  return {
    context: {
      org: { id: "org1" },
      auditLog,
      models: { eventForwarderConfigs: { updateWithCas: update } },
    } as never,
    update,
    auditLog,
  };
}

describe("migrateEventForwarderToInHouseConsumer", () => {
  it("moves a legacy config onto the shared topic with tables", async () => {
    const { context, update, auditLog } = mockContext();
    const existing = legacyBigQueryConfig();

    const migrated = await migrateEventForwarderToInHouseConsumer(
      context,
      existing,
      bqParams,
    );

    expect(migrated.topic).toBe("event_forwarder_bigquery");
    expect(migrated.status).toBe("pending");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toEqual(["topic"]);
    expect(decrypt(migrated.config)).toMatchObject({
      projectId: "proj",
      dataset: "ds",
      tables: {
        events: "gb_events",
        experiment_viewed: "gb_experiment_viewed",
        feature_usage: "gb_feature_usage",
      },
    });
    // Old Confluent ids are kept for manual teardown.
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "eventForwarderConfig.migrate" }),
    );
    expect(JSON.parse(auditLog.mock.calls[0][0].details)).toEqual({
      datasourceId: "ds_1",
      topic: "gb-events-org1-ds_1",
      connectorName: "lcc-connector",
      connectorId: "lcc-123",
    });
  });

  it("rejects a config already on the in-house consumer", async () => {
    const { context, update } = mockContext();
    await expect(
      migrateEventForwarderToInHouseConsumer(
        context,
        legacyBigQueryConfig({ topic: "event_forwarder_bigquery" }),
        bqParams,
      ),
    ).rejects.toThrow("already on the in-house consumer");
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects when another request already claimed the row", async () => {
    const { context, update, auditLog } = mockContext(
      legacyBigQueryConfig({ topic: "event_forwarder_bigquery" }),
    );
    await expect(
      migrateEventForwarderToInHouseConsumer(
        context,
        legacyBigQueryConfig(),
        bqParams,
      ),
    ).rejects.toThrow("already on the in-house consumer");
    expect(update).toHaveBeenCalledTimes(1);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("rejects a paused config", async () => {
    const { context, update } = mockContext();
    await expect(
      migrateEventForwarderToInHouseConsumer(
        context,
        legacyBigQueryConfig({ status: "paused" }),
        bqParams,
      ),
    ).rejects.toThrow("Resume the event forwarder");
    expect(update).not.toHaveBeenCalled();
  });
});
