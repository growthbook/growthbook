import { shutdownFormatWorkerPool } from "../src/util/sql";

jest.mock("openai", () => ({
  Configuration: jest.fn(),
  OpenAIApi: jest.fn(() => ({
    createCompletion: jest.fn(),
    createEmbedding: jest.fn(),
  })),
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
