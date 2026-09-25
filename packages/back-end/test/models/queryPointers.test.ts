import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Queries } from "shared/types/query";
import { updateQueryPointerStatus } from "back-end/src/models/queryPointers";
import { getCollection } from "back-end/src/util/mongo.util";

const collectionName = "querypointertestmodels";
const identity = { collectionName, organization: "org_1", id: "model_1" };
const original = {
  organization: identity.organization,
  id: identity.id,
  status: "error",
  error: "Warehouse error",
  dateUpdated: new Date("2026-09-01"),
  queries: [
    { query: "qry_a", name: "a", status: "running" },
    { query: "qry_b", name: "b", status: "running" },
    { query: "qry_c", name: "c", status: "running" },
  ] satisfies Queries,
};

describe("updateQueryPointerStatus", () => {
  let mongo: MongoMemoryServer;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });
  beforeEach(async () => {
    await getCollection(collectionName).deleteMany({});
    await getCollection(collectionName).insertOne({ ...original });
  });

  it.each(["succeeded", "failed"] as const)(
    "updates only the matching pointer to %s and preserves model fields",
    async (status) => {
      expect(
        await updateQueryPointerStatus({
          ...identity,
          queryId: "qry_b",
          status,
        }),
      ).toBe(true);
      const expected = {
        ...original,
        queries: original.queries.map((q) =>
          q.query === "qry_b" ? { ...q, status } : q,
        ),
      };
      expect(
        await getCollection(collectionName).findOne({ id: identity.id }),
      ).toMatchObject(expected);
      expect(
        await updateQueryPointerStatus({
          ...identity,
          queryId: "qry_b",
          status,
        }),
      ).toBe(false);
    },
  );

  it("updates a queued pointer", async () => {
    await getCollection(collectionName).updateOne(
      { id: identity.id },
      { $set: { "queries.1.status": "queued" } },
    );
    expect(
      await updateQueryPointerStatus({
        ...identity,
        queryId: "qry_b",
        status: "failed",
      }),
    ).toBe(true);
  });

  it.each(["succeeded", "failed"] as const)(
    "preserves an already %s pointer",
    async (status) => {
      await getCollection(collectionName).updateOne(
        { id: identity.id },
        { $set: { "queries.1.status": status } },
      );
      const before = await getCollection(collectionName).findOne({
        id: identity.id,
      });
      expect(
        await updateQueryPointerStatus({
          ...identity,
          queryId: "qry_b",
          status: status === "failed" ? "succeeded" : "failed",
        }),
      ).toBe(false);
      expect(
        await getCollection(collectionName).findOne({ id: identity.id }),
      ).toEqual(before);
    },
  );

  it.each([
    { organization: "other-org" },
    { id: "missing-model" },
    { queryId: "missing-query" },
  ])("ignores a nonmatching target: %o", async (target) => {
    expect(
      await updateQueryPointerStatus({
        ...identity,
        queryId: "qry_b",
        status: "succeeded",
        ...target,
      }),
    ).toBe(false);
    expect(
      await getCollection(collectionName).findOne({ id: identity.id }),
    ).toMatchObject(original);
  });

  it("does not recreate pointers cleared by cancellation", async () => {
    await getCollection(collectionName).updateOne(
      { id: identity.id },
      { $set: { queries: [] } },
    );
    expect(
      await updateQueryPointerStatus({
        ...identity,
        queryId: "qry_b",
        status: "succeeded",
      }),
    ).toBe(false);
    expect(
      await getCollection(collectionName).findOne({ id: identity.id }),
    ).toMatchObject({ ...original, queries: [] });
  });

  it("does not recreate a deleted model", async () => {
    await getCollection(collectionName).deleteOne({ id: identity.id });
    expect(
      await updateQueryPointerStatus({
        ...identity,
        queryId: "qry_b",
        status: "succeeded",
      }),
    ).toBe(false);
    expect(await getCollection(collectionName).countDocuments()).toBe(0);
  });
});
