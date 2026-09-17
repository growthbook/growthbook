import type { ConversationSummary } from "@/enterprise/hooks/useAIChat";

export type ConversationGroupLabel =
  | "Today"
  | "Yesterday"
  | "Previous 7 days"
  | "Previous 30 days"
  | "Older";

export interface ConversationGroup {
  label: ConversationGroupLabel;
  conversations: ConversationSummary[];
}

const GROUP_ORDER: ConversationGroupLabel[] = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Older",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function getConversationGroupLabel(
  createdAt: number,
  now: number = Date.now(),
): ConversationGroupLabel {
  const todayStart = startOfLocalDay(now);
  if (createdAt >= todayStart) return "Today";
  if (createdAt >= todayStart - DAY_MS) return "Yesterday";
  if (createdAt >= todayStart - 7 * DAY_MS) return "Previous 7 days";
  if (createdAt >= todayStart - 30 * DAY_MS) return "Previous 30 days";
  return "Older";
}

/** Buckets conversations by recency, preserving input order within a bucket
 * and omitting empty buckets. */
export function groupConversationsByRecency(
  conversations: ConversationSummary[],
  now: number = Date.now(),
): ConversationGroup[] {
  const buckets = new Map<ConversationGroupLabel, ConversationSummary[]>();
  for (const conv of conversations) {
    const label = getConversationGroupLabel(conv.createdAt, now);
    const bucket = buckets.get(label);
    if (bucket) {
      bucket.push(conv);
    } else {
      buckets.set(label, [conv]);
    }
  }
  return GROUP_ORDER.flatMap((label) => {
    const bucket = buckets.get(label);
    return bucket ? [{ label, conversations: bucket }] : [];
  });
}
