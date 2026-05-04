import zlib from "zlib";
import {
  sessionReplayIngestBodySchema,
  SessionReplayIngestBody,
  SessionReplayRrwebEvent,
} from "shared/validators";
import { logger } from "back-end/src/util/logger";
import { findSDKConnectionByKey } from "back-end/src/models/SdkConnectionModel";
import { getFileBuffer, listFilesByPrefix, uploadFile } from "./files";
import {
  createSessionReplayTable,
  insertSessionReplayMetadata,
} from "./clickhouse";

export type { SessionReplayIngestBody, SessionReplayRrwebEvent };

/**
 * Result of parsing the ingest body. Same shape as the validator output but
 * with `context` non-optional and its sub-fields defaulted, so downstream
 * callers don't have to re-check.
 */
export type ParsedSessionReplayIngestRequest = SessionReplayIngestBody & {
  context: {
    attributes: Record<string, unknown>;
    experiments: Record<string, number>;
    flags: Record<string, unknown>;
  };
};

type SessionReplayDerivedMetadata = {
  userId: string;
  urlFirst: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  attributes: Record<string, string>;
  experiments: [string, string][];
  flags: Record<string, string>;
};

export function parseSessionReplayIngestRequest(
  body: unknown,
): ParsedSessionReplayIngestRequest {
  const result = sessionReplayIngestBodySchema.safeParse(body);
  if (!result.success) {
    // Surface the first issue's message to keep the existing 400-response
    // shape ({ error: <string> }) intact for the SDK.
    const firstIssue = result.error.issues[0];
    throw new Error(
      firstIssue?.message ?? "Invalid session-replay ingest body",
    );
  }

  const parsed = result.data;
  return {
    ...parsed,
    context: {
      attributes: parsed.context?.attributes ?? {},
      experiments: parsed.context?.experiments ?? {},
      flags: parsed.context?.flags ?? {},
    },
  };
}

export async function resolveOrganizationIdFromClientKey(
  clientKey: string,
): Promise<string | null> {
  logger.info("session-replay: resolving clientKey");
  const connection = await findSDKConnectionByKey(clientKey);
  if (!connection) {
    return null;
  }
  logger.info(
    { orgId: connection.organization },
    "session-replay: clientKey resolved",
  );
  return connection.organization;
}

export function buildSessionReplayStorageLocation(
  orgId: string,
  sessionId: string,
  chunkIndex: number,
): { prefix: string; key: string } {
  const prefix = `session-replays/${orgId}/${sessionId}`;
  return {
    prefix,
    key: `${prefix}/${chunkIndex}.json.gz`,
  };
}

export async function uploadSessionReplayChunk(
  key: string,
  events: SessionReplayRrwebEvent[],
): Promise<void> {
  const eventsJson = JSON.stringify(events);
  const gzippedEvents = zlib.gzipSync(Buffer.from(eventsJson, "utf-8"));

  logger.info({ s3Key: key }, "session-replay: uploading to object storage");
  await uploadFile(key, "application/gzip", gzippedEvents);
  logger.info({ s3Key: key }, "session-replay: upload complete");
}

export function deriveSessionReplayMetadata(
  parsedRequest: ParsedSessionReplayIngestRequest,
): SessionReplayDerivedMetadata {
  const { events, context } = parsedRequest;

  const eventTimestamps = events
    .map((event) => event.timestamp)
    .filter((timestamp) => typeof timestamp === "number");

  const startedAt = new Date(Math.min(...eventTimestamps));
  const endedAt = new Date(Math.max(...eventTimestamps));

  const attributes = flattenUnknownMapToStringMap(context.attributes);
  const flags = flattenUnknownMapToStringMap(context.flags);

  const userId = getUserIdFromAttributes(context.attributes);
  const urlFirst = getUrlFromAttributes(context.attributes);
  const experiments = Object.entries(context.experiments).map(
    ([experimentId, variationId]) =>
      [experimentId, String(variationId)] as [string, string],
  );

  return {
    userId,
    urlFirst,
    startedAt,
    endedAt,
    durationMs: endedAt.getTime() - startedAt.getTime(),
    attributes,
    experiments,
    flags,
  };
}

export async function writeSessionReplayMetadataForFirstChunk({
  chunkIndex,
  sessionId,
  orgId,
  clientKey,
  storagePrefix,
  eventCount,
  userAgent,
  metadata,
}: {
  chunkIndex: number;
  sessionId: string;
  orgId: string;
  clientKey: string;
  storagePrefix: string;
  eventCount: number;
  userAgent: string;
  metadata: SessionReplayDerivedMetadata;
}): Promise<void> {
  if (chunkIndex !== 0) {
    return;
  }

  await createSessionReplayTable();
  await insertSessionReplayMetadata({
    session_id: sessionId,
    org_id: orgId,
    client_key: clientKey,
    user_id: metadata.userId,
    s3_key: storagePrefix,
    started_at: metadata.startedAt,
    ended_at: metadata.endedAt,
    duration_ms: metadata.durationMs,
    event_count: eventCount,
    url_first: metadata.urlFirst,
    urls_visited: metadata.urlFirst ? [metadata.urlFirst] : [],
    attributes: metadata.attributes,
    experiments: metadata.experiments,
    flags: metadata.flags,
    user_agent: userAgent,
  });
}

export async function getSessionReplayEventsByStoragePrefix(
  storagePrefix: string,
): Promise<unknown[]> {
  const chunkKeys = await listFilesByPrefix(storagePrefix);
  const sortedChunkKeys = sortReplayChunkKeysByChunkIndex(chunkKeys);

  if (!sortedChunkKeys.length) {
    return [];
  }

  const eventsByChunk = await Promise.all(
    sortedChunkKeys.map(async (chunkKey) => {
      const gzippedChunk = await getFileBuffer(chunkKey);
      return JSON.parse(zlib.gunzipSync(gzippedChunk).toString("utf-8"));
    }),
  );

  return eventsByChunk.flat();
}

function getUserIdFromAttributes(attributes: Record<string, unknown>): string {
  if (typeof attributes.id === "string") return attributes.id;
  if (typeof attributes.userId === "string") return attributes.userId;
  return "";
}

function getUrlFromAttributes(attributes: Record<string, unknown>): string {
  return typeof attributes.url === "string" ? attributes.url : "";
}

function flattenUnknownMapToStringMap(
  source: Record<string, unknown>,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    output[key] = value == null ? "" : String(value);
  }
  return output;
}

function sortReplayChunkKeysByChunkIndex(chunkKeys: string[]): string[] {
  return [...chunkKeys].sort((a, b) => {
    const chunkIndexA = parseChunkIndexFromKey(a);
    const chunkIndexB = parseChunkIndexFromKey(b);
    return chunkIndexA - chunkIndexB;
  });
}

function parseChunkIndexFromKey(storageKey: string): number {
  const fileName = storageKey.split("/").pop() ?? "";
  const numericText = fileName.replace(".json.gz", "");
  const parsedNumber = parseInt(numericText, 10);
  return Number.isFinite(parsedNumber) ? parsedNumber : 0;
}
