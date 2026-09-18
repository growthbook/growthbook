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

function startOfLocalDay(ts: number, daysAgo = 0): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

export function getConversationGroupLabel(
  createdAt: number,
  now: number = Date.now(),
): ConversationGroupLabel {
  const todayStart = startOfLocalDay(now);
  if (createdAt >= todayStart) return "Today";
  if (createdAt >= startOfLocalDay(now, 1)) return "Yesterday";
  if (createdAt >= startOfLocalDay(now, 7)) return "Previous 7 days";
  if (createdAt >= startOfLocalDay(now, 30)) return "Previous 30 days";
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
