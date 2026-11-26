import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import {
  DashboardDraftOp,
  DashboardVersionChange,
  DashboardVersionContent,
} from "../validators/dashboard-version";

export function applyDashboardDraftOp(
  content: DashboardVersionContent,
  op: DashboardDraftOp,
): DashboardVersionContent {
  if (op.op === "set-settings") return { ...content, ...op.settings };

  const blocks = [...content.blocks];
  const id = op.op === "remove-block" ? op.blockId : op.block.id;
  const index = blocks.findIndex((b) => b.id === id);

  if (op.op === "add-block") {
    if (index !== -1) throw new Error("Block already exists in the draft");
    blocks.splice(op.index ?? blocks.length, 0, op.block);
    return { ...content, blocks };
  }

  if (index === -1) throw new Error("Block not found in the draft");
  if (op.op === "update-block") blocks[index] = op.block;
  else blocks.splice(index, 1);
  return { ...content, blocks };
}

export function dashboardDraftChangeFromOp(
  op: DashboardDraftOp,
): Pick<DashboardVersionChange, "type" | "blockId"> {
  switch (op.op) {
    case "add-block":
      return { type: "block-added", blockId: op.block.id };
    case "update-block":
      return { type: "block-edited", blockId: op.block.id };
    case "remove-block":
      return { type: "block-removed", blockId: op.blockId };
    case "set-settings":
      return { type: "settings" };
  }
}

export interface DashboardContentChange {
  type:
    | "block-added"
    | "block-edited"
    | "block-moved"
    | "block-removed"
    | "settings";
  blockId?: string;
  summary: string;
}

// Result ids change on every run, so they say nothing about what a block shows.
const NOT_CONTENT = [
  "layout",
  "snapshotId",
  "explorerAnalysisId",
  "comparisonExplorerAnalysisId",
  "metricAnalysisId",
  "comparisonMetricAnalysisId",
];

// What a reader would notice between two versions, in display order.
export function diffDashboardContent(
  before: DashboardVersionContent,
  after: DashboardVersionContent,
): DashboardContentChange[] {
  const changes: DashboardContentChange[] = [];
  const settings = (changed: boolean, summary: string) => {
    if (changed) changes.push({ type: "settings", summary });
  };
  settings(
    before.title !== after.title,
    `Renamed the dashboard to "${after.title}"`,
  );
  settings(
    !isEqual(before.globalControls ?? {}, after.globalControls ?? {}),
    "Changed the dashboard date range and filters",
  );
  settings(
    !isEqual(before.comparison, after.comparison),
    "Changed the comparison period",
  );

  const removed = new Map(before.blocks.map((b) => [b.id, b]));
  for (const block of after.blocks) {
    const prev = removed.get(block.id);
    removed.delete(block.id);
    const name = `"${block.title || block.type}"`;
    const change = (type: DashboardContentChange["type"], summary: string) =>
      changes.push({ type, blockId: block.id, summary });
    if (!prev) {
      change("block-added", `Added ${name}`);
    } else if (!isEqual(omit(prev, NOT_CONTENT), omit(block, NOT_CONTENT))) {
      change(
        "block-edited",
        prev.title !== block.title
          ? `Renamed "${prev.title}" to ${name}`
          : `Changed ${name}`,
      );
    } else if (!isEqual(prev.layout, block.layout)) {
      change("block-moved", `Moved or resized ${name}`);
    }
  }
  for (const block of removed.values()) {
    changes.push({
      type: "block-removed",
      blockId: block.id,
      summary: `Removed "${block.title || block.type}"`,
    });
  }
  return changes;
}
