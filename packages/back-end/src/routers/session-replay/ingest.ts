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
import { serverSideScrubEvents } from "back-end/src/services/session-replay-scrub";

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

  // Server-side scrub pass — second line of defense after the SDK's
  // pre-transmission scrubber. Catches things the client missed (or
  // would have missed if it was bypassed). Hits are logged with org
  // context so audits can trace recurring leaks back to a component.
  const { events: scrubbedEvents, hits: scrubHits } = serverSideScrubEvents(
    events,
    // Per-org custom patterns will be plumbed through once admin UI for
    // them lands; for now, built-ins only.
    {},
  );
  if (scrubHits > 0) {
    logger.warn(
      { orgId, sessionId, chunkIndex, scrubHits },
      "session-replay: server-side regex scrubber redacted matches",
    );
  }

  const metadata = deriveSessionReplayMetadata(parsedBody);
  const { prefix: storagePrefix, key: storageKey } =
    buildSessionReplayStorageLocation(orgId, sessionId, chunkIndex);

  try {
    // Persist the SCRUBBED events, never the originals. If a client-side
    // scrubber was bypassed and PII slipped through, redacting before
    // the S3 PUT means the leaked content never lands at rest.
    await uploadSessionReplayChunk(storageKey, scrubbedEvents);
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
