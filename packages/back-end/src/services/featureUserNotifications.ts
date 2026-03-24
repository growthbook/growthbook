import { isEqual, omit } from "lodash";
import { FeatureInterface } from "shared/types/feature";
import type { UserNotificationInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import { isInAppNotificationsBackendEnabled } from "back-end/src/util/inAppNotifications";

type FanOutRow = Omit<
  UserNotificationInterface,
  "id" | "organization" | "dateCreated" | "dateUpdated"
>;

const IGNORE_FIELDS = ["dateUpdated", "dateCreated"] as const;

function listChangedKeys(before: FeatureInterface, after: FeatureInterface) {
  const a = omit(before, [...IGNORE_FIELDS]);
  const b = omit(after, [...IGNORE_FIELDS]);
  if (isEqual(a, b)) return null;
  const keys = new Set([
    ...Object.keys(a as object),
    ...Object.keys(b as object),
  ]);
  const changed: string[] = [];
  for (const k of keys) {
    if (
      !isEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    ) {
      changed.push(k);
    }
  }
  return changed;
}

/**
 * After a persisted feature update, notify watchers (excluding the actor) when
 * the in-app notifications gate is on and the user has not muted CHANGE in-app.
 */
export async function notifyFeatureWatchersOnUpdate(
  context: ReqContext | ApiReqContext,
  before: FeatureInterface,
  after: FeatureInterface,
): Promise<void> {
  if (!isInAppNotificationsBackendEnabled()) return;

  const changedKeys = listChangedKeys(before, after);
  if (!changedKeys?.length) return;

  const actorId = context.userId;
  const watchers = await context.models.watch.getFeatureWatchers(after.id);
  const recipients = watchers.filter((uid) => uid && uid !== actorId);
  if (!recipients.length) return;

  const prefsMap =
    await context.models.notificationPreferences.getByUserIds(recipients);

  const rows: FanOutRow[] = [];

  for (const userId of recipients) {
    const prefs = prefsMap.get(userId) ?? null;
    if (
      !context.models.notificationPreferences.isCategoryInAppEnabled(
        "CHANGE",
        prefs,
      )
    ) {
      continue;
    }

    const title = `Feature "${after.id}" was updated`;
    const body =
      changedKeys.length <= 8
        ? `Changes: ${changedKeys.join(", ")}`
        : `${changedKeys.length} fields changed`;

    rows.push({
      userId,
      resourceType: "feature",
      resourceId: after.id,
      projectId: after.project || undefined,
      category: "CHANGE",
      eventType: "feature.updated",
      scope: "user",
      title,
      body,
      payload: {
        changedKeys,
        previousVersion: before.version,
        version: after.version,
      },
      source: "watch",
      seenAt: null,
      readAt: null,
    });
  }

  if (!rows.length) return;

  try {
    await context.models.userNotifications.insertManyFromFanOut(rows);
  } catch (e) {
    logger.error(e, "insertManyFromFanOut for feature watchers");
  }
}
