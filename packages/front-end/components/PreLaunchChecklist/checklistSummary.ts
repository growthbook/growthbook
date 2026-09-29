import { PENDING_APPROVAL_ITEM_PREFIX } from "shared/util";
import type { ManualLaunchChecklistItem } from "shared/validators";
import type { CheckListItem } from "./PreLaunchChecklistItems";

export type ChecklistTier = "blocking" | "recommended" | "optional";

export const CHECKLIST_TIERS: readonly ChecklistTier[] = [
  "blocking",
  "recommended",
  "optional",
];

export function getChecklistTier(
  item: Pick<CheckListItem, "hardBlock" | "required">,
): ChecklistTier {
  if (item.hardBlock) return "blocking";
  return item.required ? "recommended" : "optional";
}

export type ChecklistSummary = {
  incomplete: Record<ChecklistTier, CheckListItem[]>;
  // Done, but still warning about something: always shown, never counted.
  flagged: CheckListItem[];
  complete: CheckListItem[];
  // Optional items count too: any of them still asks for the bypass.
  remaining: number;
  blocking: number;
};

export function summarizeChecklist(
  items: CheckListItem[],
  waive?: (item: CheckListItem) => boolean,
): ChecklistSummary {
  const incomplete: ChecklistSummary["incomplete"] = {
    blocking: [],
    recommended: [],
    optional: [],
  };
  const flagged: CheckListItem[] = [];
  const complete: CheckListItem[] = [];
  items.forEach((item) => {
    if (waive?.(item)) return;
    if (item.status === "incomplete") {
      incomplete[getChecklistTier(item)].push(item);
    } else if (item.warning) {
      flagged.push(item);
    } else {
      complete.push(item);
    }
  });
  return {
    incomplete,
    flagged,
    complete,
    remaining: CHECKLIST_TIERS.reduce(
      (n, tier) => n + incomplete[tier].length,
      0,
    ),
    blocking: incomplete.blocking.length,
  };
}

export const STALE_VALUES_ITEM_PREFIX = "staleVariationValues:";

export function isPendingApprovalItem(item: Pick<CheckListItem, "key">) {
  return item.key.startsWith(PENDING_APPROVAL_ITEM_PREFIX);
}

/** What an admin's start bypass waives: the server skips both checks with it. */
export function isBypassableStartItem(item: Pick<CheckListItem, "key">) {
  return (
    isPendingApprovalItem(item) || item.key.startsWith(STALE_VALUES_ITEM_PREFIX)
  );
}

export function nextManualChecklist(
  existing: ManualLaunchChecklistItem[] | undefined,
  key: string,
  checked: boolean,
): ManualLaunchChecklistItem[] {
  const entry: ManualLaunchChecklistItem = {
    key,
    status: checked ? "complete" : "incomplete",
  };
  const list = existing ?? [];
  return list.some((e) => e.key === key)
    ? list.map((e) => (e.key === key ? entry : e))
    : [...list, entry];
}
