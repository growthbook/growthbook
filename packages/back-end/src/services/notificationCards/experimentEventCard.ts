import type { NotificationEvent } from "shared/types/events/notification-events";
import { experimentCardFormats } from "shared/validators";
import { logger } from "back-end/src/util/logger";
import type { CompactEvent } from "back-end/src/services/notificationCards/cardImages";
import { renderExperimentCard } from "back-end/src/services/notificationCards/experimentCards";
import { buildEventSnapshotCard } from "./eventSnapshotCard";

const CARD_CAPTION: Record<CompactEvent, string> = {
  started: "Experiment started",
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
  format: ExperimentNotificationCardFormat = "compact",
): Promise<RenderedExperimentNotificationCard | null> {
  if (format === "none") return null;
  const card = buildEventSnapshotCard(event);
  if (!card?.event) return null;

  try {
    const png = await renderExperimentCard(
      card,
      format === "detailed" ? "detailed" : "compact",
    );
    return {
      png,
      altText: `${card.name} — experiment results`,
      caption: CARD_CAPTION[card.event],
      experimentId: card.key,
    };
  } catch (error) {
    logger.warn(
      error,
      `Notification card: failed to render experiment ${card.key}`,
    );
    return null;
  }
}
