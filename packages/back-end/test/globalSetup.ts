import { MongoMemoryServer } from "mongodb-memory-server";

// One mongod for the whole run, started before Vitest spawns its workers so the
// launch never competes with them for CPU.
export default async function globalSetup(): Promise<() => Promise<void>> {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  // getUri() appends a generated db name; suites pick their own.
  process.env.MONGO_TEST_URI = uri.slice(0, uri.lastIndexOf("/"));
  return async () => {
    await mongod.stop();
  };
}
