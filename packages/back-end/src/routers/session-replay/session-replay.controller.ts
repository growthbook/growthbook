import { Response } from "express";
import {
  SessionReplayInterface,
  SessionReplayRrwebEvent,
} from "shared/validators";
import { parseIntWithDefaultCapped } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

type SessionResponse =
  | { events: SessionReplayRrwebEvent[]; metadata: SessionReplayInterface }
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
  | "meaningfulEventCount"
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
type SessionsResponse = { sessions: SessionReplayListItem[] };

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
  const pageSize = 100;
  const offset = (page - 1) * pageSize;

  const parsePositiveFloat = (s: string | undefined): number | undefined => {
    if (!s) return undefined;
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const sessions = await context.models.sessionReplays.list({
    userId: req.query.userId,
    clientKey: req.query.clientKey,
    url: req.query.url,
    country: req.query.country,
    device: req.query.device,
    minDurationSecs: parsePositiveFloat(req.query.durationMinSecs),
    maxDurationSecs: parsePositiveFloat(req.query.durationMaxSecs),
    minEventCount: parsePositiveFloat(req.query.eventCountMin),
    maxEventCount: parsePositiveFloat(req.query.eventCountMax),
    featureKey: req.query.featureKey,
    experimentKey: req.query.experimentKey,
    dateAfter: req.query.dateAfter,
    dateBefore: req.query.dateBefore,
    project: req.query.project,
    limit: pageSize,
    offset,
  });
  res.status(200).json({ sessions: sessions.map(toListItem) });
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
    meaningfulEventCount: session.meaningfulEventCount,
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
  req: AuthRequest<unknown, { sessionId: string }>,
  res: Response<SessionResponse>,
) {
  const context = getContextFromReq(req);
  const { sessionId } = req.params;

  const metadata =
    await context.models.sessionReplays.getBySessionId(sessionId);
  if (!metadata) {
    res.status(404).json({ status: 404, message: "Session not found" });
    return;
  }

  const events = await context.models.sessionReplays.getEventsForS3Key(
    metadata.s3Key,
  );
  if (!events.length) {
    res.status(404).json({ status: 404, message: "Session data not found" });
    return;
  }

  res.status(200).json({ events, metadata });
}
