import { randomUUID } from "crypto";
import mongoose from "mongoose";

/**
 * A test helper that will recursively freeze an object using Object.freeze
 * In strict mode, which is enabled during test runs, attempting to mutate a frozen object
 * will result in a runtime exception and cause the test to fail.
 * Ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze
 * @param object
 */
export function deepFreeze(object: Record<string, unknown> | Array<unknown>) {
  // Retrieve the property names defined on object
  const propNames = Reflect.ownKeys(object);

  // Freeze properties before freezing self
  for (const name of propNames) {
    const value = object[name];

    if ((value && typeof value === "object") || typeof value === "function") {
      deepFreeze(value);
    }
  }

  return Object.freeze(object);
}

// A database of its own per suite: the shared mongod is started once in
// globalSetup, and several suites wipe every collection on their connection.
export function testMongoUri(): string {
  const base = process.env.MONGO_TEST_URI;
  if (!base) {
    throw new Error("MONGO_TEST_URI is unset; globalSetup did not run");
  }
  return `${base}/test_${randomUUID().replace(/-/g, "")}`;
}

export async function connectTestMongo(): Promise<void> {
  await mongoose.connect(testMongoUri());
}

export async function disconnectTestMongo(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.connection.close();
}
