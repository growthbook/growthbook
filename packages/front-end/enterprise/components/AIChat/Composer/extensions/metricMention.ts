import Mention from "@tiptap/extension-mention";
import type { AIChatMentionType } from "shared/ai-chat";

export const METRIC_MENTION_NAME = "metricMention";

/**
 * One selectable row in the @-mention list.
 *
 * Deliberately shaped exactly like the mention node's attributes: the stock
 * Mention `command` spreads the chosen item straight into `attrs`, so keeping
 * them identical avoids a mapping step and keeps the types honest.
 */
export interface MentionItem {
  id: string;
  label: string;
  metricType: AIChatMentionType;
}

/**
 * `@` mentions for metrics.
 *
 * Two things are customised on top of the stock Mention node:
 *
 * - a `metricType` attribute, so a selected mention still knows whether it is a
 *   metric / fact metric / metric group when we collect them at send time;
 * - `storage.items`, holding the list the suggestion popup filters. Extension
 *   options are frozen when the editor is created, but the metric list arrives
 *   asynchronously from `useDefinitions`, so the list has to live somewhere
 *   mutable. Storage is Tiptap's own mechanism for that, and the `items`
 *   callback receives the editor, so it can read the current value.
 */
export const MetricMention = Mention.extend<
  Parameters<typeof Mention.configure>[0],
  { items: MentionItem[] }
>({
  name: METRIC_MENTION_NAME,

  addStorage() {
    return { items: [] };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      metricType: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-metric-type"),
        renderHTML: (attributes) =>
          attributes.metricType
            ? { "data-metric-type": attributes.metricType }
            : {},
      },
    };
  },
});

/**
 * Prefix matches first, then substring matches, each alphabetical. Capped
 * because the popup scrolls rather than pages, and an org can have hundreds of
 * metrics.
 */
export function filterMentionItems(
  items: MentionItem[],
  query: string,
  limit = 20,
): MentionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);

  const prefix: MentionItem[] = [];
  const substring: MentionItem[] = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) prefix.push(item);
    else if (label.includes(q)) substring.push(item);
  }
  return [...prefix, ...substring].slice(0, limit);
}
