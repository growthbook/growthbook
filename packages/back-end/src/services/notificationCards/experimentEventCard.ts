import type { NotificationEvent } from "shared/types/events/notification-events";
import { experimentCardFormats } from "shared/validators";
import { logger } from "back-end/src/util/logger";
import { getExperimentUrlAndNameFormatted } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import type { CompactEvent } from "back-end/src/services/notificationCards/cardImages";
import { renderExperimentCard } from "back-end/src/services/notificationCards/experimentCards";
import { buildEventSnapshotCard } from "./eventSnapshotCard";

const CARD_LABEL: Record<CompactEvent, string> = {
  started: "Experiment started",
  won: "Declared a winner",
  lost: "Rolled back",
  stopped: "Experiment stopped",
  warning: "Health issue",
};

export type ExperimentNotificationCardFormat =
  (typeof experimentCardFormats)[number];

export interface RenderedExperimentNotificationCard {
  png: Buffer;
  // Plain text: file title / alt text.
  altText: string;
  // Slack mrkdwn: experiment link + event label, for the message body.
  caption: string;
  experimentId: string;
}

export async function renderExperimentNotificationCard(
  event: NotificationEvent,
  format: ExperimentNotificationCardFormat = "compact",
): Promise<RenderedExperimentNotificationCard | null> {
  const card = buildEventSnapshotCard(event);
  if (!card?.event) return null;

  try {
    const png = await renderExperimentCard(card, format);
    const label = CARD_LABEL[card.event];
    return {
      png,
      altText: `${card.name} - ${label}`,
      caption: `${getExperimentUrlAndNameFormatted(card.key, card.name)} - ${label}`,
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
