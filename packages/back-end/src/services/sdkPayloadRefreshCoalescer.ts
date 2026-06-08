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
    if (
      !skipRefreshForProjectConflicted &&
      request.skipRefreshForProject !== undefined
    ) {
      if (
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
} | null> {
  const collection = getPendingCollection();
  const doc = await collection.findOne({ organization });
  if (!doc?.requests?.length) {
    return null;
  }
  const merged = mergeSdkPayloadRefreshRequests(doc.requests);
  if (!hasPendingRefreshWork(merged)) {
    return null;
  }
  return { merged, requestCount: doc.requests.length };
}

export async function ackPendingSdkPayloadRefreshRequests(
  organization: string,
  processedRequestCount: number,
): Promise<void> {
  const collection = getPendingCollection();
  const now = new Date();
  const { value: doc } = await collection.findOneAndUpdate(
    { organization },
    [
      {
        $set: {
          requests: {
            $cond: {
              if: {
                $lte: [
                  { $size: { $ifNull: ["$requests", []] } },
                  processedRequestCount,
                ],
              },
              then: [],
              else: {
                $slice: [
                  "$requests",
                  processedRequestCount,
                  {
                    $subtract: [
                      { $size: { $ifNull: ["$requests", []] } },
                      processedRequestCount,
                    ],
                  },
                ],
              },
            },
          },
          dateUpdated: now,
        },
      },
    ],
    { returnDocument: "after" },
  );
  if (!doc?.requests?.length) {
    await collection.deleteOne({ organization, requests: { $size: 0 } });
  }
}

export function isSdkPayloadRefreshCoalescingEnabled(): boolean {
  return SDK_PAYLOAD_REFRESH_DEBOUNCE_MS > 0;
}

export async function ensureSdkPayloadRefreshPendingIndex(): Promise<void> {
  try {
    const collection = getPendingCollection();
    await collection.createIndex({ organization: 1 }, { unique: true });
    await collection.createIndex(
      { dateUpdated: 1 },
      { expireAfterSeconds: PENDING_TTL_SECONDS },
    );
  } catch (e) {
    logger.warn(e, "Failed to create sdkpayloadrefreshpending indexes");
  }
}
