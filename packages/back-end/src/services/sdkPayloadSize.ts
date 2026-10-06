import {
  SdkConnectionCacheAuditContext,
  SdkPayloadSize,
  SdkPayloadSizeAlert,
} from "shared/validators";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  describeSdkPayloadSize,
  describeSdkPayloadSizeRecommendation,
  getSdkPayloadSizeRecommendations,
  DEFAULT_SDK_PAYLOAD_SIZE_LIMIT_BYTES,
  getSdkPayloadSizeLevel,
  nextNotifiedSdkPayloadSizeLevel,
  SDK_PAYLOAD_SIZE_WARNING_FRACTION,
  shouldRecordSdkPayloadSize,
} from "shared/health";
import {
  claimSDKConnectionNotifiedPayloadSizeLevel,
  findSDKConnectionsWithPayloadOver,
  setSDKConnectionPayloadSize,
} from "back-end/src/models/SdkConnectionModel";
import { createEvent } from "back-end/src/models/EventModel";
import { getUsersByIds } from "back-end/src/models/UserModel";
import { getFeatureMetaInfoByIds } from "back-end/src/models/FeatureModel";
import {
  isEmailEnabled,
  sendSdkPayloadSizeEmail,
} from "back-end/src/services/email";
import { getSDKPayloadCacheLocation } from "back-end/src/models/SdkConnectionCacheModel";
import { getMaxDocumentSizeBytes } from "back-end/src/util/mongo.util";
import { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";

// Payload size only matters when payloads are cached as Mongo documents
export async function getSdkPayloadSizeLimitBytes(): Promise<number | null> {
  if (getSDKPayloadCacheLocation() !== "mongo") return null;
  return (
    (await getMaxDocumentSizeBytes()) ?? DEFAULT_SDK_PAYLOAD_SIZE_LIMIT_BYTES
  );
}

// Room for the cache document's own fields (id, organization, dates, version)
const CACHE_DOCUMENT_FIELDS_BYTES = 1024;

// The cache stores the payload alongside its audit context, and it's the whole
// document that has to fit under the database's limit
export function estimateCacheDocumentBytes(
  json: string,
  auditContext: SdkConnectionCacheAuditContext | undefined,
): number {
  return (
    Buffer.byteLength(json) +
    (auditContext ? Buffer.byteLength(JSON.stringify(auditContext)) : 0) +
    CACHE_DOCUMENT_FIELDS_BYTES
  );
}

// Never throws: a failure here must not stop the payload from being cached
export async function recordSdkPayloadSize(
  context: ReqContext,
  connection: SDKConnectionInterface,
  payloadSize: SdkPayloadSize,
) {
  try {
    if (
      shouldRecordSdkPayloadSize(connection.payloadSize ?? null, payloadSize)
    ) {
      await setSDKConnectionPayloadSize(context, connection, payloadSize);
    }

    const notified = connection.notifiedPayloadSizeLevel ?? "ok";
    const { level, notify } = nextNotifiedSdkPayloadSizeLevel(
      payloadSize,
      notified,
    );
    if (level === notified) return;
    const claimed = await claimSDKConnectionNotifiedPayloadSizeLevel(
      context,
      connection,
      level,
    );
    if (!claimed || !notify || level === "ok") return;
    const sent = await notifySdkPayloadSize(
      context,
      connection,
      payloadSize,
      level,
    );
    // Hand the level back so the next refresh tries again
    if (!sent) {
      await claimSDKConnectionNotifiedPayloadSizeLevel(
        context,
        { ...connection, notifiedPayloadSizeLevel: level },
        notified,
      );
    }
  } catch (e) {
    logger.error(e, "Error recording SDK payload size");
  }
}

// Returns whether the event was saved. Email is best effort on top of it.
async function notifySdkPayloadSize(
  context: ReqContext,
  connection: SDKConnectionInterface,
  payloadSize: SdkPayloadSize,
  level: "warning" | "danger" | "over-limit",
): Promise<boolean> {
  const message = describeSdkPayloadSize(payloadSize);
  // Without names: subscribers, and even admins, may be denied a Project the
  // connection covers. The SDK Connection's page lists them per viewer.
  const recommendations = getSdkPayloadSizeRecommendations(
    connection,
    payloadSize,
  ).map((r) => ({
    type: r.type,
    message: describeSdkPayloadSizeRecommendation(r, { withNames: false }),
  }));

  const eventId = await createEvent({
    context,
    object: "sdkConnection",
    objectId: connection.id,
    event: "payloadSize.warning",
    data: {
      object: {
        connectionId: connection.id,
        connectionName: connection.name,
        environment: connection.environment,
        projects: connection.projects,
        level,
        bytes: payloadSize.bytes,
        limitBytes: payloadSize.limitBytes,
        message,
        recommendations,
      },
    },
    projects: connection.projects,
    tags: [],
    environments: [connection.environment],
    containsSecrets: false,
  });

  if (!eventId) return false;
  if (!isEmailEnabled()) return true;
  // Not awaited, so a slow mail server doesn't hold up the cache write
  void getAdminEmails(context)
    .then((emails) =>
      sendSdkPayloadSizeEmail({
        emails,
        connectionId: connection.id,
        connectionName: connection.name,
        message,
        recommendations: recommendations.map((r) => r.message),
      }),
    )
    .catch((e) => logger.error(e, "Failed to send SDK payload size email"));
  return true;
}

async function getAdminEmails(context: ReqContext): Promise<string[]> {
  const adminIds = context.org.members
    .filter((m) => m.role === "admin")
    .map((m) => m.id);
  const admins = adminIds.length ? await getUsersByIds(adminIds) : [];
  return [
    ...new Set(
      [context.org.ownerEmail, ...admins.map((u) => u.email)].filter(Boolean),
    ),
  ];
}

// Shown org-wide to the people who can change the connection
export async function getSdkPayloadSizeAlerts(
  context: ReqContext,
): Promise<SdkPayloadSizeAlert[]> {
  const limitBytes = await getSdkPayloadSizeLimitBytes();
  if (limitBytes === null) return [];
  const connections = await withReadablePayloadBreakdowns(
    context,
    await findSDKConnectionsWithPayloadOver(
      context,
      limitBytes * SDK_PAYLOAD_SIZE_WARNING_FRACTION,
    ),
  );
  return connections.flatMap((c) =>
    c.payloadSize && context.permissions.canUpdateSDKConnection(c, {})
      ? [
          {
            connectionId: c.id,
            connectionName: c.name,
            level: getSdkPayloadSizeLevel(c.payloadSize),
            bytes: c.payloadSize.bytes,
            limitBytes: c.payloadSize.limitBytes,
            recommendations: getSdkPayloadSizeRecommendations(c, c.payloadSize),
          },
        ]
      : [],
  );
}

// A breakdown names Feature Flags and Saved Groups from every Project the
// connection covers, so keep only the ones the viewer can read
export async function withReadablePayloadBreakdowns(
  context: ReqContext,
  connections: SDKConnectionInterface[],
): Promise<SDKConnectionInterface[]> {
  const breakdowns = connections.flatMap((c) =>
    c.payloadSize?.breakdown ? [c.payloadSize.breakdown] : [],
  );
  if (!breakdowns.length) return connections;

  const ids = (key: "largestFeatures" | "largestSavedGroups") => [
    ...new Set(breakdowns.flatMap((b) => b[key].map((e) => e.id))),
  ];
  const [features, savedGroups] = await Promise.all([
    getFeatureMetaInfoByIds(context, ids("largestFeatures")),
    context.models.savedGroups.getReadScopesByIds(ids("largestSavedGroups")),
  ]);
  const readableFeatures = new Set(features.map((f) => f.id));
  const readableSavedGroups = new Set(savedGroups.map((g) => g.id));

  return connections.map((c) => {
    const breakdown = c.payloadSize?.breakdown;
    if (!c.payloadSize || !breakdown) return c;
    return {
      ...c,
      payloadSize: {
        ...c.payloadSize,
        breakdown: {
          ...breakdown,
          largestFeatures: breakdown.largestFeatures.filter((e) =>
            readableFeatures.has(e.id),
          ),
          largestSavedGroups: breakdown.largestSavedGroups.filter((e) =>
            readableSavedGroups.has(e.id),
          ),
        },
      },
    };
  });
}
