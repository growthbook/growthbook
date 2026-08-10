import { Response } from "express";
import { GrowthBookClient } from "@growthbook/growthbook";
import { growthbookTrackingPlugin } from "@growthbook/growthbook/plugins";
import { captureError } from "shared/error-tracking";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getIngestorHost } from "back-end/src/util/secrets";

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
  const handled = scenario === "logged" || scenario === "handled";

  // Report only through this throwaway client, explicitly scoped to the
  // chosen SDK connection. Do NOT also throw/reject or call logger.error:
  // those route through Express's global error handler / logger, which
  // always reports via the app's own internal telemetry client (a fixed
  // connection unrelated to the one selected here) — routing through both
  // would double-report the same error under two different `errorType`
  // tags, which the ingestor's fingerprint hash treats as separate issues.
  await captureError({
    gb: client,
    error,
    userContext: {},
    props: {
      errorType: `test-backend-${scenario}`,
      transaction: "error-tracking-test-page",
      handled,
    },
  });

  // "uncaught"/"async-rejection" simulate a failed request; "logged"/"handled"
  // simulate an error that was caught and handled without failing the request.
  if (handled) {
    return res.status(200).json({ status: 200 });
  }
  return res.status(500).json({ status: 500, message: error.message });
}
