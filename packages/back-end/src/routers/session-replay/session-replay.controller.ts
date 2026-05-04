import { Response } from "express";
import {
  SessionReplayInterface,
  SessionReplayRrwebEvent,
} from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

type SessionsResponse = { sessions: SessionReplayInterface[] };
type SessionResponse =
  | { events: SessionReplayRrwebEvent[]; metadata: SessionReplayInterface }
  | { error: string };

export async function listSessions(
  req: AuthRequest,
  res: Response<SessionsResponse>,
) {
  const context = getContextFromReq(req);
  // Permission filtering happens inside the model: rows the caller can't
  // read are dropped before they ever reach the response.
  const sessions = await context.models.sessionReplays.list();
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
