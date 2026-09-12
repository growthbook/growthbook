import type { NotificationEvent } from "shared/types/events/notification-events";
import type { CardData } from "back-end/src/services/notificationCards/cardImages";

// A producer owns everything object-specific for one event: parsing the
// payload, building the card data, and writing the link + label for the
// message. It returns null when the event has no card (e.g. a warning subtype
// it doesn't cover), and the notification falls back to text.
export interface NotificationCard {
  data: CardData;
  // Plain text: file title / alt text.
  altText: string;
  // Slack mrkdwn: object link + event label, for the message body.
  caption: string;
}

export type NotificationCardProducer = (
  event: NotificationEvent,
) => NotificationCard | null;
