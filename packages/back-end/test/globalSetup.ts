import { MongoMemoryServer } from "mongodb-memory-server";
import { setMongod } from "./mongo";

export default async function globalSetup() {
  const mongod = await MongoMemoryServer.create();
  setMongod(mongod);
  process.env.MONGO_TEST_BASE_URI = mongod.getUri();
}
