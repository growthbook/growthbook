// Live agent evals: `pnpm --filter back-end eval <suite>`. Same setup as the
// unit tests, except the AI SDK is real and only *.eval.ts files run.
import base from "./jest.config.js";

const AI_SDK = /^\^(ai|@ai-sdk\/[^$]+)\$$/;

export default {
  ...base,
  testMatch: ["**/test/evals/**/*.eval.ts"],
  moduleNameMapper: Object.fromEntries(
    Object.entries(base.moduleNameMapper).filter(
      ([pattern]) => !AI_SDK.test(pattern),
    ),
  ),
  setupFilesAfterEnv: [
    ...base.setupFilesAfterEnv,
    "<rootDir>/test/evals/setup.ts",
  ],
  // A suite is many multi-turn conversations; the harness, not Jest, decides
  // pass or fail.
  testTimeout: 3 * 60 * 60 * 1000,
};
