import { Request, Response } from "express";
import { logger } from "back-end/src/util/logger";
import {
  buildSessionReplayStorageLocation,
  deriveSessionReplayMetadata,
  parseSessionReplayIngestRequest,
  resolveOrganizationIdFromClientKey,
  uploadSessionReplayChunk,
  writeSessionReplayMetadataForFirstChunk,
} from "back-end/src/services/session-replay";

export async function ingestSessionReplay(
  req: Request,
  res: Response,
): Promise<void> {
  let parsedBody: ReturnType<typeof parseSessionReplayIngestRequest>;
  try {
    parsedBody = parseSessionReplayIngestRequest(req.body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request body";
    res.status(400).json({ error: message });
    return;
  }

  const { clientKey, sessionId, chunkIndex, events } = parsedBody;

  const orgId = await resolveOrganizationIdFromClientKey(clientKey);
  if (!orgId) {
    res.status(401).json({ error: "Invalid clientKey" });
    return;
  }

  const metadata = deriveSessionReplayMetadata(parsedBody);
  const { prefix: storagePrefix, key: storageKey } =
    buildSessionReplayStorageLocation(orgId, sessionId, chunkIndex);

  try {
    await uploadSessionReplayChunk(storageKey, events);
  } catch (e) {
    logger.error(e, "session-replay: failed to upload events to S3");
    res.status(500).json({ error: "Failed to store session data" });
    return;
  }

  try {
    await writeSessionReplayMetadataForFirstChunk({
      chunkIndex,
      sessionId,
      orgId,
      clientKey,
      storagePrefix,
      eventCount: events.length,
      userAgent:
        typeof req.headers["user-agent"] === "string"
          ? req.headers["user-agent"]
          : "",
      metadata,
    });
  } catch (e) {
    logger.error(e, "session-replay: failed to write metadata to ClickHouse");
    // Object storage upload succeeded; still return 200 so SDK doesn't retry
  }

  res.status(200).json({ ok: true });
}
