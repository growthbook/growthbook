import { QueryInterface } from "shared/types/query";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ExternalQueryStatus,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { promiseAllChunks } from "back-end/src/util/promise";

export const QUERY_STATUS_TIMEOUT_MS = 30_000;

// A status check must never stall a reaper tick or reject into promiseAllChunks
// (which aborts a chunk on the first rejection), so the timeout and any rejection
// both resolve to "unreachable" — the caller then behaves exactly as today.
function withStatusTimeout(
  status: Promise<ExternalQueryStatus>,
): Promise<ExternalQueryStatus> {
  const unreachable: ExternalQueryStatus = {
    state: "unknown",
    reason: "unreachable",
  };
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<ExternalQueryStatus>((resolve) => {
    timer = setTimeout(() => resolve(unreachable), QUERY_STATUS_TIMEOUT_MS);
  });
  return Promise.race([status.catch(() => unreachable), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

export async function getExternalQueryStatusForDoc(
  context: ReqContext | ApiReqContext,
  doc: Pick<
    QueryInterface,
    "id" | "datasource" | "externalId" | "externalIdMetadata"
  >,
  integrationCache: Map<string, SourceIntegrationInterface | null>,
): Promise<ExternalQueryStatus> {
  if (!doc.externalId) {
    return { state: "unknown", reason: "unsupported" };
  }

  let integration = integrationCache.get(doc.datasource);
  if (integration === undefined) {
    try {
      integration = await getIntegrationFromDatasourceId(
        context,
        doc.datasource,
        true,
      );
    } catch (e) {
      // Cache the null so a broken datasource is not retried per-doc.
      integration = null;
    }
    integrationCache.set(doc.datasource, integration);
  }

  if (integration === null) {
    return { state: "unknown", reason: "unreachable" };
  }

  if (!integration.getExternalQueryStatus) {
    return { state: "unknown", reason: "unsupported" };
  }

  return withStatusTimeout(
    integration.getExternalQueryStatus(doc.externalId, doc.externalIdMetadata),
  );
}

export async function getExternalQueryStatuses(
  context: ReqContext | ApiReqContext,
  docs: Array<
    Pick<
      QueryInterface,
      "id" | "datasource" | "externalId" | "externalIdMetadata"
    >
  >,
): Promise<Map<string, ExternalQueryStatus>> {
  const integrationCache = new Map<string, SourceIntegrationInterface | null>();
  const results = await promiseAllChunks(
    docs.map((doc) => async () => ({
      id: doc.id,
      status: await getExternalQueryStatusForDoc(
        context,
        doc,
        integrationCache,
      ),
    })),
    5,
  );
  return new Map(results.map(({ id, status }) => [id, status]));
}
