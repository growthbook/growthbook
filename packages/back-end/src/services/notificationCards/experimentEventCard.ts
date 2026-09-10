import type { NotificationEvent } from "shared/types/events/notification-events";
import { experimentCardFormats } from "shared/validators";
import { logger } from "back-end/src/util/logger";
import type { CompactEvent } from "back-end/src/services/notificationCards/cardImages";
import { renderExperimentCard } from "back-end/src/services/notificationCards/experimentCards";
import { buildEventSnapshotCard } from "./eventSnapshotCard";

const compactEventForNotification = (
  event: NotificationEvent,
): CompactEvent | null => {
  // The generic experiment warning event covers several semantically distinct
  // cases. The current warning card specifically describes SRM, so other
  // warning subtypes must retain their accurate text notification.
  if (event.event !== "experiment.warning") return null;
  const warning = event.data.object as { type?: string };
  return warning.type === "srm" ? "warning" : null;
};

const CARD_CAPTION: Record<CompactEvent, string> = {
  started: "Experiment started",
  significance: "Reached significance",
  won: "Declared a winner",
  lost: "Rolled back",
  stopped: "Experiment stopped",
  warning: "Health alert",
};

export type ExperimentNotificationCardFormat =
  (typeof experimentCardFormats)[number];

export interface RenderedExperimentNotificationCard {
  png: Buffer;
  altText: string;
  caption: string;
  experimentId: string;
}

export async function renderExperimentNotificationCard(
  event: NotificationEvent,
  organizationId: string,
  format: ExperimentNotificationCardFormat = "compact",
): Promise<RenderedExperimentNotificationCard | null> {
  if (format === "none") return null;
  const snapshotCard = buildEventSnapshotCard(event);
  const compactEvent =
    snapshotCard?.event ?? compactEventForNotification(event);
  if (!compactEvent) return null;

  const object = event.data?.object as
    | { id?: string; experimentId?: string }
    | undefined;
  const experimentId = object?.id || object?.experimentId;
  if (!experimentId) return null;

  try {
    const { getContextForAgendaJobByOrgId } = await import(
      "back-end/src/services/organizations"
    );
    const { buildExperimentCardData } = await import(
      "back-end/src/services/notificationCards/experimentCardData"
    );
    const card =
      snapshotCard ??
      (await buildExperimentCardData(
        await getContextForAgendaJobByOrgId(organizationId),
        experimentId,
      ));
    // A delayed warning may now load healthy or stopped results. Preserve the
    // event's text instead of presenting a contradictory current-state card.
    if (!card || (!snapshotCard && card.state !== "warning")) return null;

    card.event = compactEvent;
    const png = await renderExperimentCard(
      card,
      format === "detailed" ? "detailed" : "compact",
    );
    return {
      png,
      altText: `${card.name} — experiment results`,
      caption: CARD_CAPTION[compactEvent],
      experimentId,
    };
  } catch (error) {
    logger.warn(
      error,
      `Notification card: failed to render experiment ${experimentId}`,
    );
    return null;
  }
}
