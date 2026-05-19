import { Response } from "express";
import {
  SessionReplayInterface,
  SessionReplayRrwebEvent,
} from "shared/validators";
import { parseIntWithDefaultCapped } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

type SessionsResponse = { sessions: SessionReplayInterface[] };
type SessionResponse =
  | { events: SessionReplayRrwebEvent[]; metadata: SessionReplayInterface }
  | { status: number; message: string };

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
    // unauthorized callers. Body includes `status` so the front-end's
    // `apiCall` correctly throws on this response.
    res.status(404).json({ status: 404, message: "Session not found" });
    return;
  }

  const events = await context.models.sessionReplays.getEventsForStoragePrefix(
    metadata.storagePrefix,
  );
  if (!events.length) {
    res
      .status(404)
      .json({ status: 404, message: "Session data not found" });
    return;
  }

  res.status(200).json({ events, metadata });
}
