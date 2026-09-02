import {
  CancelQueryOutcome,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { logger } from "back-end/src/util/logger";

export const CANCEL_CONFIRMATION_DELAY_MS = 30_000;

export type CancelExternalQueryTarget = {
  externalId: string;
  metadata?: Record<string, string>;
};

export async function cancelExternalQuery(
  integration: SourceIntegrationInterface,
  { externalId, metadata }: CancelExternalQueryTarget,
  logContext: Record<string, string>,
): Promise<void> {
  if (!integration.cancelQuery) return;

  let outcome: CancelQueryOutcome;
  try {
    outcome = await integration.cancelQuery(externalId, metadata);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(
      { err: e, externalId, ...logContext },
      `Warehouse rejected cancel request for external query: ${msg}`,
    );
    return;
  }

  if (outcome === "cancelled") {
    logger.debug(
      { externalId, ...logContext },
      "Warehouse confirmed external query cancellation",
    );
    return;
  }

  const getStatus = integration.getExternalQueryStatus?.bind(integration);
  if (!getStatus) {
    logger.debug(
      { externalId, ...logContext },
      "Cancel request accepted; confirmation unsupported for this warehouse",
    );
    return;
  }

  const timer = setTimeout(async () => {
    try {
      const status = await getStatus(externalId, metadata);
      switch (status.state) {
        case "running":
          logger.warn(
            {
              externalId,
              ...logContext,
              elapsedMs: CANCEL_CONFIRMATION_DELAY_MS,
            },
            "External query still running after cancel request",
          );
          break;
        case "unknown":
          logger.warn(
            { externalId, reason: status.reason, ...logContext },
            "Could not confirm external query cancellation",
          );
          break;
        case "succeeded":
        case "failed":
          logger.debug(
            { externalId, state: status.state, ...logContext },
            "External query reached a terminal state after cancel request",
          );
          break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(
        { err: e, externalId, ...logContext },
        `Could not confirm external query cancellation: ${msg}`,
      );
    }
  }, CANCEL_CONFIRMATION_DELAY_MS);

  // Confirmation is only a log line, so it must never hold the process open.
  timer.unref();
}
