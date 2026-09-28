import { getQueriesByIds } from "back-end/src/models/QueryModel";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { getErrorMessage } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

export const CANCEL_CONFIRMATION_DELAY_MS = 30_000;

export type CancelExternalQueryTarget = {
  externalId: string;
  metadata?: Record<string, string>;
};

export async function cancelQueryAndConfirm(
  integration: SourceIntegrationInterface,
  { externalId, metadata }: CancelExternalQueryTarget,
  logContext: Record<string, string>,
): Promise<void> {
  if (!integration.cancelQuery) return;

  try {
    await integration.cancelQuery(externalId, metadata);
  } catch (e) {
    logger.warn(
      { err: e, externalId, ...logContext },
      `Warehouse rejected cancel request for external query: ${getErrorMessage(e)}`,
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
      logger.warn(
        { err: e, externalId, ...logContext },
        `Could not confirm external query cancellation: ${getErrorMessage(e)}`,
      );
    }
  }, CANCEL_CONFIRMATION_DELAY_MS);

  // Confirmation is only a log line, so it must never hold the process open.
  timer.unref();
}

/**
 * Warehouse half of a cancel. Precondition: the caller already ran
 * markPendingQueriesAsFailed on these ids, so no runner can promote a queued
 * query into a fresh external job while these cancels are in flight.
 */
export async function cancelExternalJobsForQueries(
  context: ReqContext | ApiReqContext,
  integration: SourceIntegrationInterface,
  queryIds: string[],
  logContext: { modelId: string },
): Promise<void> {
  if (!queryIds.length) return;

  const queryDocs = await getQueriesByIds(context, queryIds, false);

  // Cached copies (createNewQueryFromCached) share their upstream's
  // externalId via cachedQueryUsed; chase one hop to find it.
  const cachedSourceIds = Array.from(
    new Set(
      queryDocs
        .map((q) => q.cachedQueryUsed)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const cachedSourceDocs = cachedSourceIds.length
    ? await getQueriesByIds(context, cachedSourceIds, false)
    : [];
  const cachedSourceById = new Map(cachedSourceDocs.map((q) => [q.id, q]));

  // Dedupe by externalId so cached copies don't trigger duplicate cancels.
  type ExternalJob = { id: string; metadata?: Record<string, string> };
  const externalJobsById = new Map<string, ExternalJob>();
  for (const q of queryDocs) {
    if (q.externalId) {
      if (!externalJobsById.has(q.externalId)) {
        externalJobsById.set(q.externalId, {
          id: q.externalId,
          metadata: q.externalIdMetadata,
        });
      }
      continue;
    }
    if (q.cachedQueryUsed) {
      const source = cachedSourceById.get(q.cachedQueryUsed);
      if (source?.externalId && !externalJobsById.has(source.externalId)) {
        externalJobsById.set(source.externalId, {
          id: source.externalId,
          metadata: source.externalIdMetadata,
        });
      }
    }
  }
  const externalJobs = [...externalJobsById.values()];
  logger.debug(
    {
      datasourceId: integration.datasource.id,
      modelId: logContext.modelId,
      externalJobs: externalJobs.map((j) => ({
        id: j.id,
        metadataKeys: j.metadata ? Object.keys(j.metadata) : [],
      })),
    },
    `Cancelling ${externalJobs.length} external jobs`,
  );

  if (externalJobs.length) {
    await promiseAllChunks(
      externalJobs.map(({ id, metadata }) => {
        return () =>
          cancelQueryAndConfirm(
            integration,
            { externalId: id, metadata },
            {
              datasourceId: integration.datasource.id,
              modelId: logContext.modelId,
            },
          );
      }),
      5,
    );
  }
}
