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
