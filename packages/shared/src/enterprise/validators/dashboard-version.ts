import { z } from "zod";
import { dashboardInterface } from "./dashboard";
import {
  createDashboardBlockInterface,
  dashboardBlockInterface,
} from "./dashboard-block";

export const dashboardVersionContent = dashboardInterface.pick({
  title: true,
  blocks: true,
  globalControls: true,
  comparison: true,
  grid: true,
});
export type DashboardVersionContent = z.infer<typeof dashboardVersionContent>;

export const dashboardVersionChange = z
  .object({
    type: z.enum(["block-added", "block-edited", "block-removed", "settings"]),
    blockId: z.string().optional(),
    userId: z.string(),
    byAI: z.boolean().optional(),
    date: z.date(),
  })
  .strict();
export type DashboardVersionChange = z.infer<typeof dashboardVersionChange>;

export const dashboardVersionInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    dashboardId: z.string(),
    version: z.number().int().min(1), // The draft is always one above the published version
    status: z.enum(["draft", "published"]),
    content: dashboardVersionContent,
    changes: z.array(dashboardVersionChange),
    note: z.string().optional(),
    publishedBy: z.string().optional(),
    datePublished: z.date().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();
export type DashboardVersionInterface = z.infer<
  typeof dashboardVersionInterface
>;

const removeBlockOp = z.strictObject({
  op: z.literal("remove-block"),
  blockId: z.string(),
});
const setSettingsOp = z.strictObject({
  op: z.literal("set-settings"),
  settings: dashboardVersionContent.omit({ blocks: true }).partial(),
});
const blockIndex = z.number().int().min(0).optional();

export const dashboardDraftOp = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("add-block"),
    block: dashboardBlockInterface,
    index: blockIndex,
  }),
  z.strictObject({
    op: z.literal("update-block"),
    block: dashboardBlockInterface,
  }),
  removeBlockOp,
  setSettingsOp,
]);
export type DashboardDraftOp = z.infer<typeof dashboardDraftOp>;

// What a client sends: a new block has no server-generated ids yet.
export const dashboardDraftOpInput = z.union([
  z.strictObject({
    op: z.literal("add-block"),
    block: createDashboardBlockInterface,
    index: blockIndex,
  }),
  dashboardDraftOp,
]);
export type DashboardDraftOpInput = z.infer<typeof dashboardDraftOpInput>;
