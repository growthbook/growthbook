import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  QueryRunnerRunModel,
  COLLECTION_NAME,
  QUERY_RUNNER_LOCK_STALE_MS,
} from "back-end/src/models/QueryRunnerRunModel";
import { waitForIndexes, type Context } from "back-end/src/models/BaseModel";

const makeContext = (orgId: string) =>
  ({
    org: { id: orgId },
    populateForeignRefs: jest.fn().mockResolvedValue(undefined),
    models: {},
  }) as unknown as Context;

const context = makeContext("org_1");

describe("QueryRunnerRunModel", () => {
  let mongod: MongoMemoryServer;
  let model: QueryRunnerRunModel;

  const collection = () => mongoose.connection.db!.collection(COLLECTION_NAME);

  const createForRun = (token: string) =>
    model.createForRun({
      parentType: "experimentSnapshot",
      parentId: "snp_1",
      datasourceId: "ds_1",
      token,
    });

  const setLockHeartbeatAt = (id: string, lockHeartbeatAt: Date | null) =>
    collection().updateOne(
      { organization: "org_1", id },
      { $set: { lockHeartbeatAt } },
    );

  const getRaw = (id: string) =>
    collection().findOne({ organization: "org_1", id });

  const staleDate = () =>
    new Date(Date.now() - QUERY_RUNNER_LOCK_STALE_MS - 1000);

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    model = new QueryRunnerRunModel(context);
    await waitForIndexes();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await collection().deleteMany({});
  });

  it("createForRun writes an owned run document", async () => {
    const run = await createForRun("tok_a");

    expect(run.id).toMatch(/^qrr_/);
    expect(run.organization).toBe("org_1");
    expect(run.parentType).toBe("experimentSnapshot");
    expect(run.parentId).toBe("snp_1");
    expect(run.datasourceId).toBe("ds_1");
    expect(run.queryIds).toEqual([]);
    expect(run.lockToken).toBe("tok_a");
    expect(run.lockHeartbeatAt).toBeInstanceOf(Date);
  });

  it("acquires a free lock", async () => {
    const run = await createForRun("tok_a");
    await collection().updateOne(
      { organization: "org_1", id: run.id },
      { $set: { lockToken: null, lockHeartbeatAt: null } },
    );

    expect(await model.acquireLock(run.id, "tok_b")).toBe(true);
    expect((await getRaw(run.id))?.lockToken).toBe("tok_b");
  });

  it("reclaims a stale lock held by another token", async () => {
    const run = await createForRun("tok_a");
    await setLockHeartbeatAt(run.id, staleDate());

    expect(await model.acquireLock(run.id, "tok_b")).toBe(true);
    expect((await getRaw(run.id))?.lockToken).toBe("tok_b");
  });

  it("re-acquires with the same token and bumps the heartbeat", async () => {
    const run = await createForRun("tok_a");
    const before = staleDate();
    await setLockHeartbeatAt(run.id, before);

    expect(await model.acquireLock(run.id, "tok_a")).toBe(true);
    const after = (await getRaw(run.id))?.lockHeartbeatAt as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it("refuses to acquire a live lock held by another token", async () => {
    const run = await createForRun("tok_a");

    expect(await model.acquireLock(run.id, "tok_b")).toBe(false);
    expect((await getRaw(run.id))?.lockToken).toBe("tok_a");
  });

  it("advances the heartbeat for the holder", async () => {
    const run = await createForRun("tok_a");
    const before = staleDate();
    await setLockHeartbeatAt(run.id, before);

    expect(await model.touchLockHeartbeat(run.id, "tok_a")).toBe(true);
    const after = (await getRaw(run.id))?.lockHeartbeatAt as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it("records the query ids while the caller holds the lease", async () => {
    const run = await createForRun("tok_a");

    expect(
      await model.setQueryIds(run.id, "tok_a", ["qry_1", "qry_2", "qry_1"]),
    ).toBe(true);
    expect((await getRaw(run.id))?.queryIds).toEqual(["qry_1", "qry_2"]);
    expect(await model.setQueryIds(run.id, "tok_other", ["qry_3"])).toBe(false);
    expect((await getRaw(run.id))?.queryIds).toEqual(["qry_1", "qry_2"]);
  });

  it("does not overwrite query ids after they are recorded", async () => {
    const run = await createForRun("tok_a");

    expect(await model.setQueryIds(run.id, "tok_a", ["qry_1"])).toBe(true);
    expect(await model.setQueryIds(run.id, "tok_a", ["qry_2"])).toBe(false);
    expect((await getRaw(run.id))?.queryIds).toEqual(["qry_1"]);
  });

  it("accepts the identical query roster after it is recorded", async () => {
    const run = await createForRun("tok_a");
    const queryIds = ["qry_1", "qry_2"];

    expect(await model.setQueryIds(run.id, "tok_a", queryIds)).toBe(true);
    expect(await model.setQueryIds(run.id, "tok_a", queryIds)).toBe(true);
    expect((await getRaw(run.id))?.queryIds).toEqual(queryIds);
  });

  it("reports a lost heartbeat after another token reclaims", async () => {
    const run = await createForRun("tok_a");
    await setLockHeartbeatAt(run.id, staleDate());
    expect(await model.acquireLock(run.id, "tok_b")).toBe(true);

    expect(await model.touchLockHeartbeat(run.id, "tok_a")).toBe(false);
  });

  it("does not release a lease held by a different token", async () => {
    const run = await createForRun("tok_a");
    await setLockHeartbeatAt(run.id, staleDate());
    expect(await model.acquireLock(run.id, "tok_b")).toBe(true);

    await model.releaseLock(run.id, "tok_a");
    expect((await getRaw(run.id))?.lockToken).toBe("tok_b");
  });

  describe("getActiveRun", () => {
    it("returns the run while its lock is held", async () => {
      const run = await createForRun("tok_a");

      const active = await model.getActiveRun("experimentSnapshot", "snp_1");
      expect(active?.id).toBe(run.id);
    });

    it("returns null once the lock is released", async () => {
      const run = await createForRun("tok_a");
      await model.releaseLock(run.id, "tok_a");

      expect(await model.getActiveRun("experimentSnapshot", "snp_1")).toBe(
        null,
      );
    });

    it("returns null once the held lease is stale", async () => {
      const run = await createForRun("tok_a");
      await setLockHeartbeatAt(run.id, staleDate());

      expect(await model.getActiveRun("experimentSnapshot", "snp_1")).toBe(
        null,
      );
    });

    it("returns null for a different parentId or parentType", async () => {
      await createForRun("tok_a");

      expect(await model.getActiveRun("experimentSnapshot", "snp_2")).toBe(
        null,
      );
      expect(await model.getActiveRun("report", "snp_1")).toBe(null);
    });

    it("is org-scoped", async () => {
      const otherModel = new QueryRunnerRunModel(makeContext("org_2"));
      await otherModel.createForRun({
        parentType: "experimentSnapshot",
        parentId: "snp_1",
        datasourceId: "ds_1",
        token: "tok_other",
      });

      expect(await model.getActiveRun("experimentSnapshot", "snp_1")).toBe(
        null,
      );
    });
  });

  describe("dangerouslyFindActiveRuns", () => {
    it("returns only fresh held leases for the requested documents", async () => {
      const fresh = await createForRun("tok_fresh");

      const otherModel = new QueryRunnerRunModel(makeContext("org_2"));
      const otherFresh = await otherModel.createForRun({
        parentType: "experimentSnapshot",
        parentId: "snp_2",
        datasourceId: "ds_1",
        token: "tok_other",
      });

      const stale = await createForRun("tok_stale");
      await setLockHeartbeatAt(stale.id, staleDate());

      const released = await createForRun("tok_released");
      await model.releaseLock(released.id, "tok_released");

      await model.createForRun({
        parentType: "report",
        parentId: "rep_unrequested",
        datasourceId: "ds_1",
        token: "tok_unrequested",
      });

      const leases = await QueryRunnerRunModel.dangerouslyFindActiveRuns(
        "experimentSnapshot",
        [
          { organization: "org_1", id: "snp_1" },
          { organization: "org_2", id: "snp_2" },
        ],
      );

      expect(leases.map((lease) => lease.id).sort()).toEqual(
        [fresh.id, otherFresh.id].sort(),
      );
    });

    it("returns no leases when there are no documents", async () => {
      expect(
        await QueryRunnerRunModel.dangerouslyFindActiveRuns(
          "experimentSnapshot",
          [],
        ),
      ).toEqual([]);
    });
  });

  describe("dangerouslyFindStaleQueryRunnerRuns", () => {
    it("returns stale held leases across orgs, excluding fresh and released ones", async () => {
      const stale1 = await createForRun("tok_1");
      await setLockHeartbeatAt(stale1.id, staleDate());

      const otherModel = new QueryRunnerRunModel(makeContext("org_2"));
      const stale2 = await otherModel.createForRun({
        parentType: "report",
        parentId: "rep_1",
        datasourceId: "ds_1",
        token: "tok_2",
      });
      await collection().updateOne(
        { organization: "org_2", id: stale2.id },
        { $set: { lockHeartbeatAt: staleDate() } },
      );

      // Fresh held lease is excluded.
      await createForRun("tok_fresh");

      // Released lease with an old heartbeat is excluded.
      const released = await createForRun("tok_released");
      await collection().updateOne(
        { organization: "org_1", id: released.id },
        { $set: { lockToken: null, lockHeartbeatAt: staleDate() } },
      );

      const leases =
        await QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns(20);
      expect(leases.map((l) => l.id).sort()).toEqual(
        [stale1.id, stale2.id].sort(),
      );
    });

    it("respects the limit", async () => {
      const a = await createForRun("tok_a");
      const b = await createForRun("tok_b");
      await setLockHeartbeatAt(a.id, staleDate());
      await setLockHeartbeatAt(b.id, staleDate());

      const leases =
        await QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns(1);
      expect(leases).toHaveLength(1);
    });
  });
});
