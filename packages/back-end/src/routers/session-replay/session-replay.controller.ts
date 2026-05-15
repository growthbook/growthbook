import { Response } from "express";
import {
  SessionReplayInterface,
  SessionReplayRrwebEvent,
} from "shared/validators";
import { parseIntWithDefaultCapped } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getSessionReplaySignedReadUrl,
  isSessionReplayStorageConfigured,
  listSessionReplayChunks,
} from "back-end/src/services/files";
import {
  parseChunkIndexFromKey,
  sortReplayChunkKeysByChunkIndex,
} from "back-end/src/services/session-replay";

type SessionsResponse = { sessions: SessionReplayInterface[] };
type SessionResponse =
  | { events: SessionReplayRrwebEvent[]; metadata: SessionReplayInterface }
  | { error: string };

type SessionChunk = {
  index: number;
  signedUrl: string;
  expiresAt: string;
};
type SessionChunksResponse =
  | { chunks: SessionChunk[]; metadata: SessionReplayInterface }
  | { error: string };

export async function listSessions(
  req: AuthRequest<
    unknown,
    unknown,
    {
      userId?: string;
      clientKey?: string;
      state?: "recording" | "finalized" | "deleted";
      url?: string;
      page?: string;
    }
  >,
  res: Response<SessionsResponse>,
) {
  const context = getContextFromReq(req);
  const page = parseIntWithDefaultCapped(req.query.page, 1, 1_000_000);
  const pageSize = 100;
  const offset = (page - 1) * pageSize;
  // Permission filtering happens inside the model: rows the caller can't
  // read are dropped before they ever reach the response.
  const sessions = await context.models.sessionReplays.list({
    userId: req.query.userId,
    clientKey: req.query.clientKey,
    state: req.query.state,
    url: req.query.url,
    limit: pageSize,
    offset,
  });
  res.status(200).json({ sessions });
}

export async function getSession(
  req: AuthRequest<unknown, { sessionId: string }>,
  res: Response<SessionResponse>,
) {
  const context = getContextFromReq(req);
  const { sessionId } = req.params;

  const metadata =
    await context.models.sessionReplays.getBySessionId(sessionId);
  if (!metadata) {
    // Note: returns 404 both for "doesn't exist" and "no permission" — we
    // deliberately don't distinguish, to avoid leaking session existence to
    // unauthorized callers.
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const events = await context.models.sessionReplays.getEventsForStoragePrefix(
    metadata.storagePrefix,
  );
  if (!events.length) {
    res.status(404).json({ error: "Session data not found" });
    return;
  }

  res.status(200).json({ events, metadata });
}

/**
 * Returns signed S3 URLs for each gzip-JSON chunk that makes up the session's
 * payload, plus the session metadata. The browser fetches each URL directly
 * from S3 (cross-origin GET, no credentials) and decompresses with
 * `DecompressionStream('gzip')`. Mirrors the AuthorizedImage pattern: auth is
 * enforced server-side, signed URLs are short-lived (15 min by default)
 * capability tokens.
 */
export async function getSessionChunks(
  req: AuthRequest<unknown, { sessionId: string }>,
  res: Response<SessionChunksResponse>,
) {
  if (!isSessionReplayStorageConfigured()) {
    res.status(503).json({
      status: 503,
      message:
        "Session-replay storage is not configured on this deployment (S3_SESSION_REPLAY_BUCKET).",
    });
    return;
  }

  const context = getContextFromReq(req);
  const { sessionId } = req.params;

  const metadata =
    await context.models.sessionReplays.getBySessionId(sessionId);
  if (!metadata) {
    // Same 404-as-permission-denial pattern as getSession — don't leak
    // session existence to unauthorized callers.
    res.status(404).json({ status: 404, message: "Session not found" });
    return;
  }

  const chunkKeys = await listSessionReplayChunks(metadata.storagePrefix);
  if (!chunkKeys.length) {
    res
      .status(404)
      .json({ status: 404, message: "Session data not found" });
    return;
  }

  const sortedChunkKeys = sortReplayChunkKeysByChunkIndex(chunkKeys);
  const chunks: SessionChunk[] = await Promise.all(
    sortedChunkKeys.map(async (key) => {
      const { signedUrl, expiresAt } = await getSessionReplaySignedReadUrl(key);
      return {
        index: parseChunkIndexFromKey(key),
        signedUrl,
        expiresAt,
      };
    }),
  );

  res.status(200).json({ chunks, metadata });
}
