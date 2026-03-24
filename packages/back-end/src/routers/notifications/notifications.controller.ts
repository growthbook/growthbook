import { Response } from "express";
import { z } from "zod";
import { UserNotificationInterface } from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { isInAppNotificationsBackendEnabled } from "back-end/src/util/inAppNotifications";

function notEnabled(res: Response) {
  return res.status(404).json({ message: "Not found" });
}

function serializeNotification(n: UserNotificationInterface) {
  return {
    ...n,
    dateCreated: n.dateCreated.toISOString(),
    dateUpdated: n.dateUpdated.toISOString(),
    seenAt: n.seenAt?.toISOString() ?? null,
    readAt: n.readAt?.toISOString() ?? null,
    clickedAt: n.clickedAt?.toISOString() ?? null,
    dismissedAt: n.dismissedAt?.toISOString() ?? null,
  };
}

export async function getNotifications(
  req: AuthRequest<
    unknown,
    unknown,
    {
      limit?: string;
      cursor?: string;
      unreadOnly?: string;
      unseenOnly?: string;
      scope?: "user" | "org" | "project";
    }
  >,
  res: Response,
) {
  if (!isInAppNotificationsBackendEnabled()) return notEnabled(res);

  const context = getContextFromReq(req);
  const limit = Math.min(
    Math.max(parseInt(req.query.limit || "20", 10) || 20, 1),
    100,
  );
  const { notifications, hasMore, nextCursor } =
    await context.models.userNotifications.listInboxForCurrentUser({
      limit,
      cursor: req.query.cursor || null,
      unreadOnly:
        req.query.unreadOnly === "1" || req.query.unreadOnly === "true",
      unseenOnly:
        req.query.unseenOnly === "1" || req.query.unseenOnly === "true",
      scope: req.query.scope,
    });

  return res.status(200).json({
    notifications: notifications.map(serializeNotification),
    hasMore,
    nextCursor,
  });
}

export async function getNotificationCounts(req: AuthRequest, res: Response) {
  if (!isInAppNotificationsBackendEnabled()) return notEnabled(res);

  const context = getContextFromReq(req);
  const counts = await context.models.userNotifications.countForCurrentUser();
  return res.status(200).json(counts);
}

const seenBodySchema = z.strictObject({
  ids: z.array(z.string()),
});

export async function postNotificationsSeen(
  req: AuthRequest<z.infer<typeof seenBodySchema>>,
  res: Response,
) {
  if (!isInAppNotificationsBackendEnabled()) return notEnabled(res);

  const body = seenBodySchema.parse(req.body);
  const context = getContextFromReq(req);
  const updated = await context.models.userNotifications.markSeen(body.ids);
  return res.status(200).json({ updated });
}

export async function postNotificationRead(
  req: AuthRequest<unknown, { id: string }>,
  res: Response,
) {
  if (!isInAppNotificationsBackendEnabled()) return notEnabled(res);

  const context = getContextFromReq(req);
  await context.models.userNotifications.markRead(req.params.id);
  return res.status(200).json({ success: true });
}

export async function postNotificationsReadAll(
  req: AuthRequest,
  res: Response,
) {
  if (!isInAppNotificationsBackendEnabled()) return notEnabled(res);

  const context = getContextFromReq(req);
  const updated = await context.models.userNotifications.markAllRead();
  return res.status(200).json({ updated });
}

export async function postNotificationDismiss(
  req: AuthRequest<unknown, { id: string }>,
  res: Response,
) {
  if (!isInAppNotificationsBackendEnabled()) return notEnabled(res);

  const context = getContextFromReq(req);
  await context.models.userNotifications.markDismissed(req.params.id);
  return res.status(200).json({ success: true });
}
