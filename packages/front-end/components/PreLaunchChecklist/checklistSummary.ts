import {
  PENDING_APPROVAL_ITEM_PREFIX,
  type ManualLaunchChecklistItem,
} from "shared/validators";
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

export function summarizeChecklist(items: CheckListItem[]): ChecklistSummary {
  const incomplete: ChecklistSummary["incomplete"] = {
    blocking: [],
    recommended: [],
    optional: [],
  };
  const flagged: CheckListItem[] = [];
  const complete: CheckListItem[] = [];
  items.forEach((item) => {
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

/** What an admin's start bypass waives: the server skips the check with it. */
export function isBypassableStartItem(item: Pick<CheckListItem, "key">) {
  return item.key.startsWith(PENDING_APPROVAL_ITEM_PREFIX);
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
