import { MongoMemoryServer } from "mongodb-memory-server";

export default async function globalTeardown(): Promise<void> {
  await (globalThis as { __MONGOD__?: MongoMemoryServer }).__MONGOD__?.stop();
}
