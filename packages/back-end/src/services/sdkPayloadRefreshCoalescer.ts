import mongoose from "mongoose";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import { SDK_PAYLOAD_REFRESH_DEBOUNCE_MS } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

export type SdkPayloadRefreshQueueRequest = {
  payloadKeys: SDKPayloadKey[];
  sdkConnections?: SDKConnectionInterface[];
  skipRefreshForProject?: string;
  treatEmptyProjectAsGlobal?: boolean;
  auditContext?: { event: string; model: string; id?: string };
  stackTrace?: string;
};

type PendingRefreshDocument = {
  organization: string;
  requests: SdkPayloadRefreshQueueRequest[];
  firstQueuedAt: Date;
  dateUpdated: Date;
};

const COLLECTION = "sdkpayloadrefreshpending";
// Drop orphaned pending docs if Agenda never drains them.
const PENDING_TTL_SECONDS = 60 * 60;

function getPendingCollection() {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB is not connected");
  }
  return db.collection<PendingRefreshDocument>(COLLECTION);
}

export function payloadKeyId(key: SDKPayloadKey): string {
  return JSON.stringify(
    Object.fromEntries(
      (Object.keys(key) as (keyof SDKPayloadKey)[])
        .sort()
        .map((k) => [k, key[k]]),
    ),
  );
}

export function mergeSdkPayloadRefreshRequests(
  requests: SdkPayloadRefreshQueueRequest[],
): SdkPayloadRefreshQueueRequest {
  const payloadKeyMap = new Map<string, SDKPayloadKey>();
  const connectionMap = new Map<string, SDKConnectionInterface>();
  let treatEmptyProjectAsGlobal = false;
  let skipRefreshForProject: string | undefined;
  let skipRefreshForProjectConflicted = false;
  let auditContext: SdkPayloadRefreshQueueRequest["auditContext"];
  let stackTrace: string | undefined;

  for (const request of requests) {
    for (const key of request.payloadKeys) {
      payloadKeyMap.set(payloadKeyId(key), key);
    }
    for (const connection of request.sdkConnections ?? []) {
      connectionMap.set(connection.key, connection);
    }
    if (request.treatEmptyProjectAsGlobal) {
      treatEmptyProjectAsGlobal = true;
    }
    if (!skipRefreshForProjectConflicted) {
      if (request.skipRefreshForProject === undefined) {
        skipRefreshForProjectConflicted = true;
        skipRefreshForProject = undefined;
      } else if (
        skipRefreshForProject !== undefined &&
        skipRefreshForProject !== request.skipRefreshForProject
      ) {
        skipRefreshForProjectConflicted = true;
        skipRefreshForProject = undefined;
      } else {
        skipRefreshForProject = request.skipRefreshForProject;
      }
    }
    if (request.auditContext) {
      auditContext = request.auditContext;
    }
    if (request.stackTrace) {
      stackTrace = request.stackTrace;
    }
  }

  return {
    payloadKeys: [...payloadKeyMap.values()],
    sdkConnections: [...connectionMap.values()],
    ...(skipRefreshForProject !== undefined ? { skipRefreshForProject } : {}),
    ...(treatEmptyProjectAsGlobal ? { treatEmptyProjectAsGlobal } : {}),
    ...(auditContext ? { auditContext } : {}),
    ...(stackTrace ? { stackTrace } : {}),
  };
}

function hasPendingRefreshWork(merged: SdkPayloadRefreshQueueRequest): boolean {
  return (
    merged.payloadKeys.length > 0 || (merged.sdkConnections?.length ?? 0) > 0
  );
}

export async function appendPendingSdkPayloadRefreshRequest(
  organization: string,
  request: SdkPayloadRefreshQueueRequest,
): Promise<void> {
  const now = new Date();
  const collection = getPendingCollection();
  await collection.updateOne(
    { organization },
    {
      $push: { requests: request },
      $set: { dateUpdated: now },
      $setOnInsert: { organization, firstQueuedAt: now },
    },
    { upsert: true },
  );
}

export async function getPendingSdkPayloadRefreshAgeMs(
  organization: string,
): Promise<number | null> {
  const collection = getPendingCollection();
  const doc = await collection.findOne(
    { organization },
    { projection: { firstQueuedAt: 1 } },
  );
  if (!doc?.firstQueuedAt) return null;
  return Date.now() - doc.firstQueuedAt.getTime();
}

export async function getPendingSdkPayloadRefreshRequests(
  organization: string,
): Promise<{
  merged: SdkPayloadRefreshQueueRequest;
  requestCount: number;
  // mergeSdkPayloadRefreshRequests keeps only the last request's auditContext,
  // so callers that want the full per-write trail (e.g. for logging) need the
  // originals — otherwise a coalesced batch silently loses every earlier
  // write's provenance.
  auditContexts: NonNullable<SdkPayloadRefreshQueueRequest["auditContext"]>[];
} | null> {
  const collection = getPendingCollection();
  const doc = await collection.findOne({ organization });
  if (!doc?.requests?.length) {
    return null;
  }
  const merged = mergeSdkPayloadRefreshRequests(doc.requests);
  if (!hasPendingRefreshWork(merged)) {
    // Merged result has no payload keys and no connections — nothing to refresh.
    // The document will be cleaned up by the TTL index.
    logger.warn(
      { organization, requestCount: doc.requests.length },
      "sdkPayloadRefreshCoalescer: merged request has no work; document will expire via TTL",
    );
    return null;
  }
  return {
    merged,
    requestCount: doc.requests.length,
    auditContexts: doc.requests
      .map((r) => r.auditContext)
      .filter((a): a is NonNullable<typeof a> => !!a),
  };
}

// Compare-and-swap instead of an aggregation-pipeline update: DocumentDB/Cosmos
// reject those. Guards on the exact `requests` array length so a concurrent
// append between our read and write is detected and retried rather than lost.
// Mirrors FeatureRevisionModel.casUpdate / RevisionModel.casUpdate.
export async function ackPendingSdkPayloadRefreshRequests(
  organization: string,
  processedRequestCount: number,
  maxAttempts = 5,
): Promise<void> {
  const collection = getPendingCollection();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = await collection.findOne(
      { organization },
      { projection: { requests: 1 } },
    );
    if (!current?.requests?.length) return;

    const remaining = current.requests.slice(processedRequestCount);
    const result = await collection.updateOne(
      { organization, requests: { $size: current.requests.length } },
      { $set: { requests: remaining, dateUpdated: new Date() } },
    );
    if (result.matchedCount === 0) {
      // A concurrent append landed between our read and write; retry with
      // fresh data rather than overwriting it.
      continue;
    }
    if (remaining.length === 0) {
      await collection.deleteOne({ organization, requests: { $size: 0 } });
    }
    return;
  }
  logger.warn(
    { organization },
    "ackPendingSdkPayloadRefreshRequests: exhausted retries reconciling pending requests",
  );
}

export function isSdkPayloadRefreshCoalescingEnabled(): boolean {
  return SDK_PAYLOAD_REFRESH_DEBOUNCE_MS > 0;
}

export async function ensureSdkPayloadRefreshPendingIndex(): Promise<void> {
  const collection = getPendingCollection();
  // Correctness-critical: appendPendingSdkPayloadRefreshRequest relies on this
  // index to make its upsert atomic. Without it, concurrent upserts for the
  // same org can each insert their own document, silently splitting a batch's
  // requests across duplicates that are never coalesced together.
  try {
    await collection.createIndex({ organization: 1 }, { unique: true });
  } catch (e) {
    logger.error(
      e,
      "Failed to create unique organization index on sdkpayloadrefreshpending; " +
        "concurrent SDK payload refresh coalescing may silently split requests across duplicate documents",
    );
  }
  // Cleanup-only: if this fails, orphaned pending docs just never expire.
  try {
    await collection.createIndex(
      { firstQueuedAt: 1 },
      { expireAfterSeconds: PENDING_TTL_SECONDS },
    );
  } catch (e) {
    logger.warn(e, "Failed to create sdkpayloadrefreshpending TTL index");
  }
}
