jest.mock("openai", () => ({
  Configuration: jest.fn(),
  OpenAIApi: jest.fn(() => ({
    createCompletion: jest.fn(),
    createEmbedding: jest.fn(),
  })),
}));
