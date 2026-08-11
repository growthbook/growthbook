import { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { logger } from "back-end/src/util/logger";
import { captureBackendError } from "back-end/src/services/growthbook";

export type ErrorTestScenario =
  | "uncaught"
  | "async-rejection"
  | "logged"
  | "handled";

function scenarioError(scenario: ErrorTestScenario): Error {
  return new Error(`[Error Tracking Test] Backend "${scenario}" error`);
}

export async function triggerBackendError(
  req: AuthRequest<{ scenario: ErrorTestScenario }>,
  res: Response,
) {
  const { scenario } = req.body;

  switch (scenario) {
    case "handled":
      // Exercises the app's own manual-capture entry point directly.
      captureBackendError(scenarioError(scenario), {
        errorType: `test-backend-${scenario}`,
        transaction: "error-tracking-test-page",
        handled: true,
      });
      return res.status(200).json({ status: 200 });
    case "logged":
      // Exercises logger.error's forwarding to captureBackendError
      // (see back-end/src/util/logger.ts's setErrorTrackingHandler).
      logger.error(
        scenarioError(scenario),
        "[Error Tracking Test] logged backend error",
      );
      return res.status(200).json({ status: 200 });
    case "async-rejection":
      // Exercises the real path: asyncHandler forwards this rejection to
      // Express's global error handler, which calls captureBackendError.
      return Promise.reject(scenarioError(scenario));
    case "uncaught":
    default:
      throw scenarioError(scenario);
  }
}
