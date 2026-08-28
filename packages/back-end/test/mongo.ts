import { MongoMemoryServer } from "mongodb-memory-server";

type MongoGlobal = typeof globalThis & { __TEST_MONGOD__?: MongoMemoryServer };

export const setMongod = (m: MongoMemoryServer) => {
  (globalThis as MongoGlobal).__TEST_MONGOD__ = m;
};

export const getMongod = () => (globalThis as MongoGlobal).__TEST_MONGOD__;

// One mongod serves the whole run. Each worker gets its own database, and files
// sharing a worker reuse it so collection indexes are built once, not per file.
export const testMongoUri = () => {
  const base = process.env.MONGO_TEST_BASE_URI;
  if (!base) throw new Error("globalSetup did not start the test mongod");
  return `${base.replace(/\/$/, "")}/gb_test_${process.env.JEST_WORKER_ID ?? "1"}`;
};
