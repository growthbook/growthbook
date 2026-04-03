// Mock kerberos module to avoid native library issues in tests
jest.mock("kerberos", () => ({
  initializeClient: jest.fn(),
  initializeServer: jest.fn(),
}));

// Polyfill web streams for Node.js test environment
import { TransformStream } from "node:stream/web";
global.TransformStream = TransformStream as typeof globalThis.TransformStream;

// Mock snowflake-sdk to prevent open handles from CustomGC
jest.mock("snowflake-sdk", () => ({
  createConnection: jest.fn(),
  configure: jest.fn(),
}));
