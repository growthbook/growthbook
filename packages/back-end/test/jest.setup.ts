// Polyfill web streams for Node.js test environment
import { TransformStream } from "node:stream/web";
import { shutdownFormatWorkerPool } from "../src/util/sql";

global.TransformStream = TransformStream as typeof globalThis.TransformStream;

// Mock snowflake-sdk to prevent open handles from CustomGC
jest.mock("snowflake-sdk", () => ({
  createConnection: jest.fn(),
  configure: jest.fn(),
}));

// Store reference to shutdown for cleanup
const shutdownPromises: Promise<void>[] = [];

// This runs in every test file after its tests complete
afterAll(async () => {
  // Schedule shutdown to happen
  const promise = shutdownFormatWorkerPool();
  shutdownPromises.push(promise);

  // Wait for it
  await promise;
});
