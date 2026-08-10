import { Response } from "express";
import { GrowthBookClient } from "@growthbook/growthbook";
import { growthbookTrackingPlugin } from "@growthbook/growthbook/plugins";
import { captureError } from "shared/error-tracking";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getIngestorHost } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

export type ErrorTestScenario =
  | "uncaught"
  | "async-rejection"
  | "logged"
  | "handled";

/**
 * A throwaway client per call (not the app's own internal telemetry
 * singleton in services/growthbook.ts) so test events land in the target
 * SDK connection's own error tracking, not GrowthBook's internal one.
 */
function buildTestClient(clientKey: string): GrowthBookClient {
  return new GrowthBookClient({
    clientKey,
    plugins: [growthbookTrackingPlugin({ ingestorHost: getIngestorHost() })],
  });
}

function scenarioError(scenario: ErrorTestScenario): Error {
  return new Error(`[Error Tracking Test] Backend "${scenario}" error`);
}

export async function getConfig(req: AuthRequest, res: Response) {
  return res.status(200).json({ status: 200, ingestorHost: getIngestorHost() });
}

export async function triggerBackendError(
  req: AuthRequest<{ clientKey: string; scenario: ErrorTestScenario }>,
  res: Response,
) {
  const { clientKey, scenario } = req.body;
  if (!clientKey) {
    return res
      .status(400)
      .json({ status: 400, message: "clientKey is required" });
  }

  const client = buildTestClient(clientKey);
  const error = scenarioError(scenario);
  const props = {
    errorType: `test-backend-${scenario}`,
    transaction: "error-tracking-test-page",
    handled: scenario === "logged" || scenario === "handled",
  };

  switch (scenario) {
    case "logged":
      // Exercises the same reporting path as a real logger.error call
      // (see back-end/src/util/logger.ts), just targeted at the chosen
      // SDK connection instead of GrowthBook's own internal tracking.
      logger.error(error, "[Error Tracking Test] logged backend error");
      await captureError({ gb: client, error, userContext: {}, props });
      return res.status(200).json({ status: 200 });
    case "handled":
      await captureError({ gb: client, error, userContext: {}, props });
      return res.status(200).json({ status: 200 });
    case "async-rejection":
      await captureError({ gb: client, error, userContext: {}, props });
      // Now actually reject, so the request itself fails like a real
      // unhandled backend error would.
      return Promise.reject(error);
    case "uncaught":
    default:
      await captureError({ gb: client, error, userContext: {}, props });
      // Now actually throw, so the request itself fails like a real
      // uncaught backend error would (caught by asyncHandler, reported
      // again via the global error handler's captureBackendError).
      throw error;
  }
}
