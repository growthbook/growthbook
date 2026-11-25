import { Response } from "express";
import {
  SessionReplayInterface,
  SessionReplayRrwebEvent,
} from "shared/validators";
import { parseIntWithDefaultCapped, safeDecodeURIComponent } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { MAX_SESSION_PAGE_SIZE } from "back-end/src/services/clickhouse";
import { parseIdsQuery } from "back-end/src/util/validation";

type SessionResponse =
  | {
      events: SessionReplayRrwebEvent[];
      metadata: SessionReplayInterface;
      chunkCount: number;
    }
  | { status: number; message: string };

type SessionReplayListItem = Pick<
  SessionReplayInterface,
  | "id"
  | "clientKey"
  | "userId"
  | "deviceId"
  | "startedAt"
  | "endedAt"
  | "lastEventAt"
  | "ingestedAt"
  | "durationMs"
  | "eventCount"
  | "keyEventCount"
  | "errorCount"
  | "urlFirst"
  | "urlsVisited"
  | "pageTitle"
  | "viewportWidth"
  | "viewportHeight"
  | "attributes"
  | "featureKeys"
  | "experimentKeys"
  | "userAgent"
  | "country"
  | "device"
  | "browser"
>;
type SessionsResponse = {
  sessions: SessionReplayListItem[];
  hasMore: boolean;
};

export async function listSessions(
  req: AuthRequest<
    unknown,
    unknown,
    {
      userId?: string;
      clientKey?: string;
      url?: string;
      country?: string;
      device?: string;
      durationMinSecs?: string;
      durationMaxSecs?: string;
      eventCountMin?: string;
      eventCountMax?: string;
      featureKey?: string;
      experimentKey?: string;
      dateAfter?: string;
      dateBefore?: string;
      project?: string;
      page?: string;
    }
  >,
  res: Response<SessionsResponse>,
) {
  const context = getContextFromReq(req);
  const page = parseIntWithDefaultCapped(req.query.page, 1, 1_000);
  const pageSize = MAX_SESSION_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const parsePositiveFloat = (s: string | undefined): number | undefined => {
    if (!s) return undefined;
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const parseKeyList = (value: unknown): string[] | undefined =>
    parseIdsQuery(value)?.map(safeDecodeURIComponent);

  const sessions = await context.models.sessionReplays.list({
    userId: req.query.userId,
    clientKey: req.query.clientKey,
    url: req.query.url,
    country: parseKeyList(req.query.country),
    device: parseKeyList(req.query.device),
    minDurationSecs: parsePositiveFloat(req.query.durationMinSecs),
    maxDurationSecs: parsePositiveFloat(req.query.durationMaxSecs),
    minEventCount: parsePositiveFloat(req.query.eventCountMin),
    maxEventCount: parsePositiveFloat(req.query.eventCountMax),
    featureKey: parseKeyList(req.query.featureKey),
    experimentKey: parseKeyList(req.query.experimentKey),
    dateAfter: req.query.dateAfter,
    dateBefore: req.query.dateBefore,
    project: req.query.project,
    // One extra row tells us a next page exists without a second count query
    limit: pageSize + 1,
    offset,
  });
  const hasMore = sessions.length > pageSize;
  res.status(200).json({
    sessions: sessions.slice(0, pageSize).map(toListItem),
    hasMore,
  });
}

function toListItem(session: SessionReplayInterface): SessionReplayListItem {
  return {
    id: session.id,
    clientKey: session.clientKey,
    userId: session.userId,
    deviceId: session.deviceId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastEventAt: session.lastEventAt,
    ingestedAt: session.ingestedAt,
    durationMs: session.durationMs,
    eventCount: session.eventCount,
    keyEventCount: session.keyEventCount,
    errorCount: session.errorCount,
    urlFirst: session.urlFirst,
    urlsVisited: session.urlsVisited,
    pageTitle: session.pageTitle,
    viewportWidth: session.viewportWidth,
    viewportHeight: session.viewportHeight,
    attributes: session.attributes,
    featureKeys: session.featureKeys,
    experimentKeys: session.experimentKeys,
    userAgent: session.userAgent,
    country: session.country,
    device: session.device,
    browser: session.browser,
  };
}

export async function getSession(
  req: AuthRequest<
    unknown,
    { sessionId: string },
    { fromChunk?: string; maxChunks?: string }
  >,
  res: Response<SessionResponse>,
) {
  const context = getContextFromReq(req);
  const { sessionId } = req.params;

  const result =
    await context.models.sessionReplays.getSessionWithChunkKeys(sessionId);
  if (!result) {
    res.status(404).json({ status: 404, message: "Session not found" });
    return;
  }

  const chunkCount = result.chunkKeys.length;

  const fromChunk = Math.max(
    0,
    parseIntWithDefaultCapped(req.query.fromChunk, 0, chunkCount),
  );
  const maxChunks = Math.max(
    0,
    parseIntWithDefaultCapped(req.query.maxChunks, chunkCount, chunkCount),
  );
  const requestedKeys = result.chunkKeys.slice(
    fromChunk,
    fromChunk + maxChunks,
  );

  const events =
    await context.models.sessionReplays.getEventsForChunkKeys(requestedKeys);
  if (!events.length && fromChunk === 0) {
    res.status(404).json({ status: 404, message: "Session data not found" });
    return;
  }

  res.status(200).json({ events, metadata: result.session, chunkCount });
}
