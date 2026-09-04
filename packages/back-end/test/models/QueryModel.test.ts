import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  createNewQuery,
  failQueryRunnerRunQueries,
  failStaleQueries,
  findStaleRunningQueries,
  startQueryIfQueued,
} from "back-end/src/models/QueryModel";
import type { ReqContext } from "back-end/types/request";

const context = {
  org: { id: "org_1" },
} as unknown as ReqContext;

const COLLECTION_NAME = "queries";

describe("QueryModel start CAS", () => {
  let mongod: MongoMemoryServer;

  const collection = () => mongoose.connection.db!.collection(COLLECTION_NAME);

  const create = () =>
    createNewQuery({
      organization: "org_1",
      datasource: "ds_1",
      language: "sql",
      query: "SELECT 1",
      dependencies: [],
      queryType: "experimentMetric",
    });

  const getRaw = (id: string) =>
    collection().findOne({ organization: "org_1", id });

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await collection().deleteMany({});
  });

  it("creates every query born queued with no startedAt", async () => {
    const withDeps = await createNewQuery({
      organization: "org_1",
      datasource: "ds_1",
      language: "sql",
      query: "SELECT 1",
      dependencies: ["qry_dep"],
      queryType: "experimentMetric",
    });

    expect(withDeps.status).toBe("queued");
    expect(withDeps.startedAt).toBeUndefined();
  });

  it("starts a queued query and stamps startedAt", async () => {
    const query = await create();

    expect(await startQueryIfQueued(context, query)).toBe(true);

    const raw = await getRaw(query.id);
    expect(raw?.status).toBe("running");
    expect(raw?.startedAt).toBeInstanceOf(Date);
  });

  it("refuses to start the same query twice", async () => {
    const query = await create();

    expect(await startQueryIfQueued(context, query)).toBe(true);
    expect(await startQueryIfQueued(context, query)).toBe(false);
  });

  it("does not resurrect a query a concurrent cancel already failed", async () => {
    const query = await create();
    await collection().updateOne(
      { organization: "org_1", id: query.id },
      { $set: { status: "failed" } },
    );

    expect(await startQueryIfQueued(context, query)).toBe(false);
    expect((await getRaw(query.id))?.status).toBe("failed");
  });

  describe("stale query sweep", () => {
    const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);

    const insert = (id: string, status: string, heartbeat: Date) =>
      collection().insertOne({ organization: "org_1", id, status, heartbeat });

    it("finds only running queries with a stale heartbeat", async () => {
      await insert("qry_stale_running", "running", secondsAgo(100));
      await insert("qry_fresh_running", "running", secondsAgo(10));
      await insert("qry_stale_queued", "queued", secondsAgo(100));
      await insert("qry_stale_succeeded", "succeeded", secondsAgo(100));
      await insert("qry_stale_failed", "failed", secondsAgo(100));

      const stale = await findStaleRunningQueries();

      expect(stale.map((d) => d.id)).toEqual(["qry_stale_running"]);
    });

    it("does not clobber a query that got a fresh heartbeat between find and fail", async () => {
      await insert("qry_cas", "running", secondsAgo(100));
      const stale = await findStaleRunningQueries();
      expect(stale.map((d) => d.id)).toEqual(["qry_cas"]);

      // A live runner's beat lands after the find but before the fail.
      await collection().updateOne(
        { organization: "org_1", id: "qry_cas" },
        { $set: { heartbeat: new Date() } },
      );
      await failStaleQueries(stale);
      expect((await getRaw("qry_cas"))?.status).toBe("running");

      // With the heartbeat left stale, the same call flips it to failed.
      await collection().updateOne(
        { organization: "org_1", id: "qry_cas" },
        { $set: { heartbeat: secondsAgo(100) } },
      );
      await failStaleQueries(stale);
      expect((await getRaw("qry_cas"))?.status).toBe("failed");
    });

    it("fails queued and stale-running queries from a dead run without failing fresh-running queries", async () => {
      await insert("qry_queued", "queued", secondsAgo(100));
      await insert("qry_stale_running", "running", secondsAgo(100));
      await insert("qry_fresh_running", "running", secondsAgo(10));
      await insert("qry_succeeded", "succeeded", secondsAgo(100));

      await failQueryRunnerRunQueries(
        context,
        [
          "qry_queued",
          "qry_stale_running",
          "qry_fresh_running",
          "qry_succeeded",
        ],
        "runner stopped",
      );

      expect((await getRaw("qry_queued"))?.status).toBe("failed");
      expect((await getRaw("qry_stale_running"))?.status).toBe("failed");
      expect((await getRaw("qry_fresh_running"))?.status).toBe("running");
      expect((await getRaw("qry_succeeded"))?.status).toBe("succeeded");
    });
  });
});
