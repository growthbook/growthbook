// Isolated constants to avoid circular deps when util is loaded via jest.requireActual

export const DEFAULT_ENVIRONMENT_IDS = [
  "production",
  "dev",
  "staging",
  "test",
] as const;
