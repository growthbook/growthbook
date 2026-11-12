// Runner-specific setup for the live evals. Everything the evals change about
// the back-end lives in this file, so a move to Vitest swaps jest.mock for
// vi.mock here and nowhere else.
import { prepareEvalEnv } from "./harness/env";

prepareEvalEnv();

// The org under test is entitled to everything, like the test contexts that
// set hasPremiumFeature to true.
jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  ...jest.requireActual("back-end/src/enterprise/licenseUtil"),
  orgHasPremiumFeature: () => true,
}));

// AI plan, enablement, and usage-cap gates. The rest of the module, including
// the system prompt, stays real.
jest.mock("back-end/src/enterprise/services/ai-access", () => ({
  ...jest.requireActual("back-end/src/enterprise/services/ai-access"),
  assertAIEnabled: jest.fn(),
  assertAIAccess: jest.fn(),
}));

// The agent's token usage goes to the trial instead of GrowthBook's own
// analytics.
jest.mock("back-end/src/services/growthbook", () => ({
  ...jest.requireActual("back-end/src/services/growthbook"),
  trackAIUsage: (event: unknown) =>
    jest.requireActual("./harness/usage").recordAgentUsage(event),
}));
