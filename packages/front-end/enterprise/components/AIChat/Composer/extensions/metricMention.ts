import Mention from "@tiptap/extension-mention";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { AIChatMentionType } from "shared/ai-chat";

export const METRIC_MENTION_NAME = "metricMention";

/**
 * One selectable row in the @-mention list.
 *
 * `id` / `label` / `metricType` are the mention node's attributes, so the stock
 * Mention `command` can spread a chosen item straight into `attrs` with no
 * mapping step. `typeLabel` is display-only and is dropped on insert, since
 * ProseMirror builds attrs from the node's declared spec and ignores the rest.
 */
export interface MentionItem {
  id: string;
  label: string;
  metricType: AIChatMentionType;
  /** The statistical type, e.g. "Proportion" — shown beside the name. */
  typeLabel: string;
}

const STALE_MENTION_PLUGIN = new PluginKey("metricMentionStale");

/**
 * What the `@` menu is currently working from.
 *
 * `ready` is carried separately rather than inferred from `items.length`: a
 * Data Source with no metrics of its own is a legitimately empty list, and
 * conflating it with "still loading" is the difference between marking every
 * mention stale (correct there) and marking none (what an emptiness check
 * does).
 */
export interface MentionStorage {
  items: MentionItem[];
  /** False until the metric definitions have loaded. */
  ready: boolean;
}

/** The ids the `@` menu currently offers. */
export function offeredMentionIds(items: MentionItem[]): Set<string> {
  return new Set(items.map((item) => item.id));
}

/**
 * `@` mentions for metrics.
 *
 * Three things are customised on top of the stock Mention node:
 *
 * - a `metricType` attribute, so a selected mention still knows whether it is a
 *   metric / fact metric / metric group when we collect them at send time;
 * - `storage.items`, holding the list the suggestion popup filters. Extension
 *   options are frozen when the editor is created, but the metric list arrives
 *   asynchronously from `useDefinitions`, so the list has to live somewhere
 *   mutable. Storage is Tiptap's own mechanism for that, and the `items`
 *   callback receives the editor, so it can read the current value.
 * - a decoration marking mentions the menu no longer offers (see below).
 */
export const MetricMention = Mention.extend<
  Parameters<typeof Mention.configure>[0],
  MentionStorage
>({
  name: METRIC_MENTION_NAME,

  addStorage() {
    return { items: [], ready: false };
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

  /**
   * Flags mentions the `@` menu no longer offers with `data-stale`, which the
   * stylesheet turns into a gray chip with a red "!".
   *
   * The PA chat scopes its menu to the active Data Source, so switching Data
   * Sources strands mentions that were valid when they were inserted — the
   * agent would receive a metric id it cannot run against. Marking them leaves
   * the user's own text intact and shows which one to remove.
   *
   * A decoration rather than an attribute update: staleness is a view of the
   * current metric list, not something the document knows about itself, so it
   * should not enter the doc (or the undo history). Storage isn't reactive, so
   * the composer nudges the view when the list changes.
   */
  addProseMirrorPlugins() {
    const { editor, name } = this;

    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: STALE_MENTION_PLUGIN,
        props: {
          decorations(state) {
            const { items, ready } = editor.storage[name] as MentionStorage;
            // Nothing to judge against until the metrics have loaded — marking
            // every mention stale on mount would be a warning about nothing.
            if (!ready) return null;

            const offered = offeredMentionIds(items);
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== name || offered.has(node.attrs.id)) return;
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  "data-stale": "true",
                  // The red "!" is a CSS pseudo-element and the explanation is
                  // in a hover card, so neither reaches assistive tech. The
                  // label carries the name too, since it replaces the node's
                  // own "@Name" text rather than adding to it.
                  "aria-label": `@${node.attrs.label}, not available in the selected Data Source`,
                }),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
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
