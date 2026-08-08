import mongoose from "mongoose";
import { Collection } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  ackPendingSdkPayloadRefreshRequests,
  appendPendingSdkPayloadRefreshRequest,
  ensureSdkPayloadRefreshPendingIndex,
  getPendingSdkPayloadRefreshAgeMs,
  getPendingSdkPayloadRefreshRequests,
  mergeSdkPayloadRefreshRequests,
  payloadKeyId,
} from "back-end/src/services/sdkPayloadRefreshCoalescer";

describe("sdkPayloadRefreshCoalescer", () => {
  it("merges payload keys and sdk connections without duplicates", () => {
    const conn1 = { key: "sdk-1" } as SDKConnectionInterface;
    const conn2 = { key: "sdk-2" } as SDKConnectionInterface;

    const merged = mergeSdkPayloadRefreshRequests([
      {
        payloadKeys: [{ environment: "production", project: "p1" }],
        sdkConnections: [conn1],
        auditContext: { event: "updated", model: "feature", id: "a" },
        stackTrace: "first",
      },
      {
        payloadKeys: [
          { environment: "production", project: "p1" },
          { environment: "staging", project: "" },
        ],
        sdkConnections: [conn1, conn2],
        treatEmptyProjectAsGlobal: true,
        auditContext: { event: "updated", model: "feature", id: "b" },
        stackTrace: "second",
      },
    ]);

    expect(merged.payloadKeys).toEqual([
      { environment: "production", project: "p1" },
      { environment: "staging", project: "" },
    ]);
    expect(merged.sdkConnections).toEqual([conn1, conn2]);
    expect(merged.treatEmptyProjectAsGlobal).toBe(true);
    expect(merged.auditContext).toEqual({
      event: "updated",
      model: "feature",
      id: "b",
    });
    expect(merged.stackTrace).toBe("second");
  });

  it("drops conflicting skipRefreshForProject values", () => {
    const merged = mergeSdkPayloadRefreshRequests([
      {
        payloadKeys: [{ environment: "production", project: "p1" }],
        skipRefreshForProject: "deleted",
      },
      {
        payloadKeys: [{ environment: "production", project: "p2" }],
        skipRefreshForProject: "other",
      },
    ]);

    expect(merged.skipRefreshForProject).toBeUndefined();
  });

  it("does not restore skipRefreshForProject after a conflict", () => {
    const merged = mergeSdkPayloadRefreshRequests([
      {
        payloadKeys: [{ environment: "production", project: "p1" }],
        skipRefreshForProject: "A",
      },
      {
        payloadKeys: [{ environment: "production", project: "p2" }],
        skipRefreshForProject: "B",
      },
      {
        payloadKeys: [{ environment: "production", project: "p3" }],
        skipRefreshForProject: "A",
      },
    ]);

    expect(merged.skipRefreshForProject).toBeUndefined();
  });

  it("clears skipRefreshForProject when a later request omits it", () => {
    const merged = mergeSdkPayloadRefreshRequests([
      {
        payloadKeys: [{ environment: "production", project: "p1" }],
        skipRefreshForProject: "A",
      },
      {
        payloadKeys: [{ environment: "production", project: "p2" }],
      },
    ]);
    expect(merged.skipRefreshForProject).toBeUndefined();
  });

  it("clears skipRefreshForProject when an earlier request omits it", () => {
    const merged = mergeSdkPayloadRefreshRequests([
      {
        payloadKeys: [{ environment: "production", project: "p1" }],
      },
      {
        payloadKeys: [{ environment: "production", project: "p2" }],
        skipRefreshForProject: "A",
      },
    ]);
    expect(merged.skipRefreshForProject).toBeUndefined();
  });

  it("payloadKeyId is stable for deduplication", () => {
    const key = { environment: "production", project: "p1" };
    expect(payloadKeyId(key)).toBe(payloadKeyId({ ...key }));
    expect(payloadKeyId({ environment: "production", project: "p1" })).toBe(
      payloadKeyId({ project: "p1", environment: "production" }),
    );
  });
});

describe("sdkPayloadRefreshCoalescer (Mongo-backed pending queue)", () => {
  let mongod: MongoMemoryServer;

  const rawCollection = () =>
    mongoose.connection.db!.collection("sdkpayloadrefreshpending");

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await ensureSdkPayloadRefreshPendingIndex();
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await rawCollection().deleteMany({});
  });

  it("creates a pending doc on first append and sets firstQueuedAt", async () => {
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "production", project: "p1" }],
    });

    const doc = await rawCollection().findOne({ organization: "org_1" });
    expect(doc?.requests).toHaveLength(1);
    expect(doc?.firstQueuedAt).toBeInstanceOf(Date);
  });

  it("appends without resetting firstQueuedAt", async () => {
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "production", project: "p1" }],
    });
    const first = await rawCollection().findOne({ organization: "org_1" });

    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "staging", project: "p1" }],
    });
    const second = await rawCollection().findOne({ organization: "org_1" });

    expect(second?.requests).toHaveLength(2);
    expect(second?.firstQueuedAt.getTime()).toBe(
      first?.firstQueuedAt.getTime(),
    );
  });

  it("enforces the unique organization index against concurrent upserts", async () => {
    const indexes = await rawCollection().indexes();
    const orgIndex = indexes.find(
      (i) => JSON.stringify(i.key) === JSON.stringify({ organization: 1 }),
    );
    expect(orgIndex?.unique).toBe(true);
  });

  it("TTLs on dateUpdated, not firstQueuedAt, so an actively-appended doc never expires early", async () => {
    const indexes = await rawCollection().indexes();
    const ttlIndex = indexes.find((i) => i.expireAfterSeconds !== undefined);
    expect(ttlIndex?.key).toEqual({ dateUpdated: 1 });
  });

  it("getPendingSdkPayloadRefreshAgeMs returns null when nothing is pending", async () => {
    expect(await getPendingSdkPayloadRefreshAgeMs("org_missing")).toBeNull();
  });

  it("getPendingSdkPayloadRefreshAgeMs returns a non-negative age once queued", async () => {
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "production", project: "p1" }],
    });
    const ageMs = await getPendingSdkPayloadRefreshAgeMs("org_1");
    expect(ageMs).not.toBeNull();
    expect(ageMs).toBeGreaterThanOrEqual(0);
  });

  it("getPendingSdkPayloadRefreshRequests returns null when nothing is pending", async () => {
    expect(await getPendingSdkPayloadRefreshRequests("org_missing")).toBeNull();
  });

  it("getPendingSdkPayloadRefreshRequests merges pending requests and reports the request count", async () => {
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "production", project: "p1" }],
    });
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "staging", project: "p1" }],
    });

    const pending = await getPendingSdkPayloadRefreshRequests("org_1");
    expect(pending?.requestCount).toBe(2);
    expect(pending?.merged.payloadKeys).toEqual([
      { environment: "production", project: "p1" },
      { environment: "staging", project: "p1" },
    ]);
  });

  it("getPendingSdkPayloadRefreshRequests returns every request's auditContext, not just the merged (last) one", async () => {
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "production", project: "p1" }],
      auditContext: { event: "feature.update", model: "feature", id: "a" },
    });
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "staging", project: "p1" }],
    });
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "dev", project: "p1" }],
      auditContext: { event: "feature.update", model: "feature", id: "b" },
    });

    const pending = await getPendingSdkPayloadRefreshRequests("org_1");
    expect(pending?.merged.auditContext?.id).toBe("b");
    expect(pending?.auditContexts).toEqual([
      { event: "feature.update", model: "feature", id: "a" },
      { event: "feature.update", model: "feature", id: "b" },
    ]);
  });

  it("getPendingSdkPayloadRefreshRequests returns null when the merged result has no work", async () => {
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [],
    });

    expect(await getPendingSdkPayloadRefreshRequests("org_1")).toBeNull();
  });

  it("ackPendingSdkPayloadRefreshRequests is a no-op when nothing is pending", async () => {
    await expect(
      ackPendingSdkPayloadRefreshRequests("org_missing", 1),
    ).resolves.toBeUndefined();
  });

  it("ackPendingSdkPayloadRefreshRequests removes only the processed prefix", async () => {
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "production", project: "p1" }],
    });
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "staging", project: "p1" }],
    });
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "dev", project: "p1" }],
    });

    await ackPendingSdkPayloadRefreshRequests("org_1", 2);

    const doc = await rawCollection().findOne({ organization: "org_1" });
    expect(doc?.requests).toHaveLength(1);
    expect(doc?.requests[0].payloadKeys).toEqual([
      { environment: "dev", project: "p1" },
    ]);
  });

  it("ackPendingSdkPayloadRefreshRequests deletes the doc once every request is processed", async () => {
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "production", project: "p1" }],
    });

    await ackPendingSdkPayloadRefreshRequests("org_1", 1);

    expect(await rawCollection().findOne({ organization: "org_1" })).toBeNull();
  });

  it("ackPendingSdkPayloadRefreshRequests treats an over-count as fully processed", async () => {
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "production", project: "p1" }],
    });

    await ackPendingSdkPayloadRefreshRequests("org_1", 5);

    expect(await rawCollection().findOne({ organization: "org_1" })).toBeNull();
  });

  it("retries when a concurrent append changes the array size between its read and write", async () => {
    await appendPendingSdkPayloadRefreshRequest("org_1", {
      payloadKeys: [{ environment: "production", project: "p1" }],
    });

    // Spy on the prototype: getPendingCollection() returns a fresh wrapper each call.
    const originalFindOne = Collection.prototype.findOne;
    let calls = 0;
    jest
      .spyOn(Collection.prototype, "findOne")
      .mockImplementation(async function (this: Collection, ...args) {
        calls++;
        const result = await originalFindOne.apply(this, args);
        if (calls === 1) {
          await appendPendingSdkPayloadRefreshRequest("org_1", {
            payloadKeys: [{ environment: "staging", project: "p1" }],
          });
        }
        return result;
      });

    try {
      await ackPendingSdkPayloadRefreshRequests("org_1", 1);
    } finally {
      jest.restoreAllMocks();
    }

    const doc = await rawCollection().findOne({ organization: "org_1" });
    expect(doc?.requests).toHaveLength(1);
    expect(doc?.requests[0].payloadKeys).toEqual([
      { environment: "staging", project: "p1" },
    ]);
    expect(calls).toBeGreaterThan(1);
  });
});
