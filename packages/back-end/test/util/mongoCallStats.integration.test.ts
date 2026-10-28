import type { Request, Response } from "express";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  countMongoCalls,
  getMongoCallSummary,
  installMongoCallCounter,
} from "back-end/src/util/mongoCallStats";

// Runs the same operations through mongoose's driver before and after the
// wrapper is installed, and checks that results and errors are unchanged.
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

async function outcome<T>(fn: () => Promise<T>) {
  try {
    return { ok: await fn() };
  } catch (e) {
    const err = e as { name?: string; code?: unknown; codeName?: unknown };
    return { error: err.name, code: err.code, codeName: err.codeName };
  }
}

async function runOperations(dbName: string) {
  const db = mongoose.connection.useDb(dbName).db;
  const items = db.collection<{ _id: number; n: number; group: string }>(
    "items",
  );
  await items.insertMany(
    [...Array(25).keys()].map((i) => ({
      _id: i,
      n: i,
      group: i % 2 ? "odd" : "even",
    })),
  );

  const results: Record<string, unknown> = {};
  results.find = await outcome(() =>
    items.find({}, { batchSize: 4 }).sort({ _id: 1 }).toArray(),
  );
  results.aggregate = await outcome(() =>
    items
      .aggregate(
        [
          { $group: { _id: "$group", total: { $sum: "$n" } } },
          { $sort: { _id: 1 } },
        ],
        { cursor: { batchSize: 1 } },
      )
      .toArray(),
  );
  results.parallel = await outcome(() =>
    Promise.all([0, 1, 2, 3, 4].map((i) => items.findOne({ _id: i * 5 }))),
  );
  results.bulkWrite = await outcome(async () => {
    const res = await items.bulkWrite([
      { insertOne: { document: { _id: 100, n: 100, group: "bulk" } } },
      { updateMany: { filter: { group: "odd" }, update: { $inc: { n: 1 } } } },
      { deleteOne: { filter: { _id: 0 } } },
    ]);
    return {
      inserted: res.insertedCount,
      modified: res.modifiedCount,
      deleted: res.deletedCount,
    };
  });
  results.duplicateKey = await outcome(() =>
    items.insertOne({ _id: 1, n: 1, group: "dup" }),
  );
  results.commit = await outcome(async () => {
    const session = await mongoose.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await items.insertOne({ _id: 200, n: 0, group: "tx" }, { session });
        await items.updateOne(
          { _id: 1 },
          { $set: { group: "tx" } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    return items.countDocuments({ group: "tx" });
  });
  results.abort = await outcome(async () => {
    const session = await mongoose.connection.startSession();
    try {
      session.startTransaction();
      await items.insertOne({ _id: 300, n: 0, group: "aborted" }, { session });
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }
    return items.countDocuments({ group: "aborted" });
  });
  results.timeout = await outcome(() =>
    items.find({ $where: "sleep(20) || true" }).maxTimeMS(5).toArray(),
  );
  results.final = await outcome(() =>
    items.find({}).sort({ _id: 1 }).toArray(),
  );
  return results;
}

it("returns the same results and errors with the wrapper installed", async () => {
  const unwrapped = await runOperations("unwrapped");
  expect(unwrapped.duplicateKey).toMatchObject({ code: 11000 });
  expect(unwrapped.timeout).toMatchObject({ code: 50 });
  expect(unwrapped.commit).toEqual({ ok: 2 });
  expect(unwrapped.abort).toEqual({ ok: 0 });

  await expect(installMongoCallCounter()).resolves.toBe(true);

  const req = {} as Request;
  let run: Promise<Record<string, unknown>> | undefined;
  countMongoCalls(req, {} as Response, () => {
    run = runOperations("wrapped");
  });
  if (!run) throw new Error("expected the operations to start");
  const wrapped = await run;

  expect(wrapped).toEqual(unwrapped);

  const summary = getMongoCallSummary(req);
  if (!summary) throw new Error("expected a summary");
  // find alone is a find plus 6 getMores at batchSize 4
  expect(summary.calls).toBeGreaterThan(20);
  expect(summary.sequential).toBeLessThan(summary.calls);
  // Nothing is left outstanding: the wall time stops growing
  const settled = summary.wallMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(getMongoCallSummary(req)?.wallMs).toBe(settled);

  // Commands outside a request are not counted
  await mongoose.connection.useDb("wrapped").db.collection("items").findOne();
  expect(getMongoCallSummary(req)?.calls).toBe(summary.calls);
}, 60000);
