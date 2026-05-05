// Polyfill web streams for Node.js test environment
import { TransformStream } from "node:stream/web";
import { webcrypto } from "node:crypto";

global.TransformStream = TransformStream as typeof globalThis.TransformStream;

// uuid@14 expects `crypto` to be a global; Jest's VM context doesn't
// expose Node 20+'s built-in `globalThis.crypto` by default.
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as unknown as Crypto;
}

// Mock snowflake-sdk to prevent open handles from CustomGC
jest.mock("snowflake-sdk", () => ({
  createConnection: jest.fn(),
  configure: jest.fn(),
}));
