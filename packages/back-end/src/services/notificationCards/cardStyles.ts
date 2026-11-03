import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationCardFormat,
} from "shared/validators";
import {
  renderDarkCard,
  renderLightCard,
} from "back-end/src/services/notificationCards/cardImages";
import type { CardData } from "back-end/src/services/notificationCards/types";

// One card layout in two themes. The data model is theme-agnostic, so a new
// theme is a renderer plus a registry entry.
const RENDERERS: Record<
  NotificationCardFormat,
  (card: CardData) => Promise<Buffer>
> = {
  light: renderLightCard,
  dark: renderDarkCard,
};

// Falls back to the default theme when the stored format is unknown.
export function renderCard(
  card: CardData,
  format: NotificationCardFormat = DEFAULT_NOTIFICATION_SETTINGS.cardFormat,
): Promise<Buffer> {
  const render =
    RENDERERS[format] ?? RENDERERS[DEFAULT_NOTIFICATION_SETTINGS.cardFormat];
  return render(card);
}
