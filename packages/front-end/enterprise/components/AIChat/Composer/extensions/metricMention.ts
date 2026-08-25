import Mention from "@tiptap/extension-mention";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { AIChatMentionType } from "shared/ai-chat";

export const METRIC_MENTION_NAME = "metricMention";

export interface MentionItem {
  id: string;
  label: string;
  metricType: AIChatMentionType;
  /** Shown beside the name, e.g. "Proportion". */
  typeLabel: string;
}

/** Heading the item sits under in the `@` menu. */
export function mentionGroupLabel(type: AIChatMentionType): string {
  return type === "dashboard" ? "Dashboards" : "Metrics";
}

const GROUP_ORDER = ["Metrics", "Dashboards"];

const groupRank = (item: MentionItem) =>
  GROUP_ORDER.indexOf(mentionGroupLabel(item.metricType));

/** Group order, then label. For the source list, which has nothing to rank by. */
export function sortMentionItems(items: MentionItem[]): MentionItem[] {
  return [...items].sort(
    (a, b) => groupRank(a) - groupRank(b) || a.label.localeCompare(b.label),
  );
}

/** Stable, so match ranking survives inside each group. */
function byGroup(items: MentionItem[]): MentionItem[] {
  return [...items].sort((a, b) => groupRank(a) - groupRank(b));
}

const STALE_MENTION_PLUGIN = new PluginKey("metricMentionStale");

export interface MentionStorage {
  items: MentionItem[];
  /** False until definitions have loaded. Empty + ready means this Data Source has no metrics. */
  ready: boolean;
}

export function offeredMentionIds(items: MentionItem[]): Set<string> {
  return new Set(items.map((item) => item.id));
}

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
   * Marks mentions no longer on the `@` menu with `data-stale`.
   * A decoration, not an attribute — staleness is a view of the current list.
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
            if (!ready) return null;

            const offered = offeredMentionIds(items);
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== name || offered.has(node.attrs.id)) return;
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  "data-stale": "true",
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

/** Prefix matches first, then substring. Capped so the popup stays short. */
export function filterMentionItems(
  items: MentionItem[],
  query: string,
  limit = 50,
): MentionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return byGroup(items).slice(0, limit);

  const prefix: MentionItem[] = [];
  const substring: MentionItem[] = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) prefix.push(item);
    else if (label.includes(q)) substring.push(item);
  }
  return byGroup([...prefix, ...substring].slice(0, limit));
}
