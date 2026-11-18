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
// `null` means the row is gone.
function mockContext(stored?: EventForwarderConfigInterface | null) {
  const update = jest
    .fn()
    .mockImplementation(async (id, guardFields, compute) => {
      if (stored === null) return null;
      const fresh = stored ?? legacyBigQueryConfig({ id });
      const changes = await compute(fresh);
      return changes ? { ...fresh, ...changes } : null;
    });
  return {
    context: {
      org: { id: "org1" },
      models: { eventForwarderConfigs: { updateWithCas: update } },
    } as never,
    update,
  };
}

describe("migrateEventForwarderToInHouseConsumer", () => {
  it("moves a legacy config onto the shared topic with tables", async () => {
    const { context, update } = mockContext();

    const { migrated } = await migrateEventForwarderToInHouseConsumer(
      context,
      legacyBigQueryConfig(),
      bqParams,
    );

    expect(migrated.topic).toBe("event_forwarder_bigquery");
    expect(migrated.status).toBe("pending");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toEqual(["topic", "status", "config"]);
    expect(decrypt(migrated.config)).toMatchObject({
      projectId: "proj",
      dataset: "ds",
      tables: {
        events: "gb_events",
        experiment_viewed: "gb_experiment_viewed",
        feature_usage: "gb_feature_usage",
      },
    });
  });

  it("returns the row the CAS claimed, not the caller's copy", async () => {
    const stored = legacyBigQueryConfig({ connectorId: "lcc-fresh" });
    const { context } = mockContext(stored);
    const { previous } = await migrateEventForwarderToInHouseConsumer(
      context,
      legacyBigQueryConfig({ connectorId: "lcc-stale" }),
      bqParams,
    );
    expect(previous.connectorId).toBe("lcc-fresh");
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
    const { context } = mockContext(
      legacyBigQueryConfig({ topic: "event_forwarder_bigquery" }),
    );
    await expect(
      migrateEventForwarderToInHouseConsumer(
        context,
        legacyBigQueryConfig(),
        bqParams,
      ),
    ).rejects.toThrow("already on the in-house consumer");
  });

  it("rejects a pause that landed after the caller's read", async () => {
    const { context } = mockContext(legacyBigQueryConfig({ status: "paused" }));
    await expect(
      migrateEventForwarderToInHouseConsumer(
        context,
        legacyBigQueryConfig(),
        bqParams,
      ),
    ).rejects.toThrow("Resume the event forwarder");
  });

  it("reports a missing row distinctly", async () => {
    const { context } = mockContext(null);
    await expect(
      migrateEventForwarderToInHouseConsumer(
        context,
        legacyBigQueryConfig(),
        bqParams,
      ),
    ).rejects.toThrow("Cannot find event forwarder config");
  });
});
