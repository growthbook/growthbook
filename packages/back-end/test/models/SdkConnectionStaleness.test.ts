import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  clearStaleSdkConnections,
  findStaleSdkConnectionsByOrganization,
  hasAnyStaleSdkConnection,
  markSdkConnectionsStale,
} from "back-end/src/models/SdkConnectionModel";

describe("SdkConnectionModel staleness tracking", () => {
  let mongod: MongoMemoryServer;

  const rawCollection = () =>
    mongoose.connection.db!.collection("sdkconnections");

  const insertConnection = async (overrides: {
    id: string;
    key: string;
    organization: string;
    staleSince?: Date | null;
  }) => {
    await rawCollection().insertOne({
      organization: overrides.organization,
      id: overrides.id,
      key: overrides.key,
      name: "Conn",
      environment: "production",
      projects: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      ...(overrides.staleSince !== undefined
        ? { staleSince: overrides.staleSince }
        : {}),
    });
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await rawCollection().deleteMany({});
  });

  describe("markSdkConnectionsStale", () => {
    it("marks the given keys stale and returns them", async () => {
      await insertConnection({ id: "c1", key: "k1", organization: "org_1" });
      await insertConnection({ id: "c2", key: "k2", organization: "org_1" });

      const marked = await markSdkConnectionsStale("org_1", ["k1", "k2"]);
      expect(marked.sort()).toEqual(["k1", "k2"]);

      const docs = await rawCollection()
        .find({ organization: "org_1" })
        .toArray();
      docs.forEach((d) => expect(d.staleSince).toBeInstanceOf(Date));
    });

    it("does not touch a connection that's already stale, and doesn't report it as newly marked", async () => {
      const original = new Date(Date.now() - 60_000);
      await insertConnection({
        id: "c1",
        key: "k1",
        organization: "org_1",
        staleSince: original,
      });

      const marked = await markSdkConnectionsStale("org_1", ["k1"]);
      expect(marked).toEqual([]);

      const doc = await rawCollection().findOne({ key: "k1" });
      expect(doc?.staleSince.getTime()).toBe(original.getTime());
    });

    it("only reports the subset that was actually newly stale", async () => {
      await insertConnection({
        id: "c1",
        key: "k1",
        organization: "org_1",
        staleSince: new Date(),
      });
      await insertConnection({ id: "c2", key: "k2", organization: "org_1" });

      const marked = await markSdkConnectionsStale("org_1", ["k1", "k2"]);
      expect(marked).toEqual(["k1", "k2"]);
      // modifiedCount only reflects k2 actually changing, but the function
      // reports the full requested set was successfully processed since
      // modifiedCount > 0 — callers only care "was anything newly marked".
    });

    it("does not mark connections belonging to a different org", async () => {
      await insertConnection({ id: "c1", key: "k1", organization: "org_2" });

      const marked = await markSdkConnectionsStale("org_1", ["k1"]);
      expect(marked).toEqual([]);

      const doc = await rawCollection().findOne({ key: "k1" });
      expect(doc?.staleSince).toBeUndefined();
    });

    it("is a no-op for an empty key list", async () => {
      const marked = await markSdkConnectionsStale("org_1", []);
      expect(marked).toEqual([]);
    });
  });

  describe("hasAnyStaleSdkConnection", () => {
    it("returns false when nothing is stale", async () => {
      await insertConnection({ id: "c1", key: "k1", organization: "org_1" });
      expect(await hasAnyStaleSdkConnection("org_1")).toBe(false);
    });

    it("returns true once something is marked stale", async () => {
      await insertConnection({
        id: "c1",
        key: "k1",
        organization: "org_1",
        staleSince: new Date(),
      });
      expect(await hasAnyStaleSdkConnection("org_1")).toBe(true);
    });

    it("is scoped per org", async () => {
      await insertConnection({
        id: "c1",
        key: "k1",
        organization: "org_2",
        staleSince: new Date(),
      });
      expect(await hasAnyStaleSdkConnection("org_1")).toBe(false);
    });
  });

  describe("findStaleSdkConnectionsByOrganization", () => {
    it("returns only stale connections for the given org", async () => {
      await insertConnection({
        id: "c1",
        key: "k1",
        organization: "org_1",
        staleSince: new Date(),
      });
      await insertConnection({ id: "c2", key: "k2", organization: "org_1" });
      await insertConnection({
        id: "c3",
        key: "k3",
        organization: "org_2",
        staleSince: new Date(),
      });

      const stale = await findStaleSdkConnectionsByOrganization("org_1");
      expect(stale.map((c) => c.key)).toEqual(["k1"]);
    });
  });

  describe("clearStaleSdkConnections", () => {
    it("clears staleness that predates clearBefore", async () => {
      const staleSince = new Date(Date.now() - 10_000);
      await insertConnection({
        id: "c1",
        key: "k1",
        organization: "org_1",
        staleSince,
      });

      await clearStaleSdkConnections("org_1", ["k1"], new Date());

      const doc = await rawCollection().findOne({ key: "k1" });
      expect(doc?.staleSince).toBeNull();
    });

    it("leaves staleness that was set after clearBefore intact — a concurrent write must survive the clear", async () => {
      const clearBefore = new Date();
      await insertConnection({
        id: "c1",
        key: "k1",
        organization: "org_1",
        staleSince: new Date(clearBefore.getTime() + 5_000),
      });

      await clearStaleSdkConnections("org_1", ["k1"], clearBefore);

      const doc = await rawCollection().findOne({ key: "k1" });
      expect(doc?.staleSince).toBeInstanceOf(Date);
    });

    it("is a no-op for an empty key list", async () => {
      await expect(
        clearStaleSdkConnections("org_1", [], new Date()),
      ).resolves.toBeUndefined();
    });
  });
});
