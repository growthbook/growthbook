import { z } from "zod";
import { namedSchema } from "../../validators/openapi-helpers";
import { dashboardInterface } from "./dashboard";
import {
  apiCreateDashboardBlockInterface,
  apiDashboardBlockInterface,
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
    undo: z.array(dashboardVersionContent).optional(), // Earlier contents, newest last
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

// A discussion on one block. Resolving it is not versioned.
export const dashboardCommentThreadInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    dashboardId: z.string(),
    blockId: z.string(),
    version: z.number().int().min(1), // The version it was started on
    resolved: z.boolean().optional(),
    comments: z.array(
      z
        .object({
          userId: z.string(),
          content: z.string(),
          date: z.date(),
        })
        .strict(),
    ),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();
export type DashboardCommentThreadInterface = z.infer<
  typeof dashboardCommentThreadInterface
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

// ---- Public REST API shapes

export const apiDashboardDraft = namedSchema(
  "DashboardDraft",
  z.object({
    dashboardId: z.string(),
    version: z
      .number()
      .int()
      .describe("The version this draft becomes when it is published."),
    title: z.string(),
    globalControls: dashboardVersionContent.shape.globalControls,
    blocks: z.array(apiDashboardBlockInterface),
    dateUpdated: z.iso.datetime(),
  }),
);
export type ApiDashboardDraft = z.infer<typeof apiDashboardDraft>;

const draftParams = z.strictObject({ id: z.string() });
const draftBlockParams = z.strictObject({
  id: z.string(),
  blockId: z.string(),
});

export const apiDashboardDraftReturn = z.object({ draft: apiDashboardDraft });
export const apiDashboardDraftBlockReturn = z.object({
  block: apiDashboardBlockInterface,
  draft: apiDashboardDraft,
});

export const apiGetDashboardDraftValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: draftParams,
};
export const apiUpdateDashboardDraftValidator = {
  bodySchema: z.strictObject({
    title: z.string().optional(),
    globalControls: dashboardVersionContent.shape.globalControls,
  }),
  querySchema: z.never(),
  paramsSchema: draftParams,
};
export const apiAddDashboardDraftBlockValidator = {
  bodySchema: apiCreateDashboardBlockInterface,
  querySchema: z.never(),
  paramsSchema: draftParams,
};
export const apiReplaceDashboardDraftBlockValidator = {
  bodySchema: apiCreateDashboardBlockInterface,
  querySchema: z.never(),
  paramsSchema: draftBlockParams,
};
export const apiRemoveDashboardDraftBlockValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: draftBlockParams,
};
export const apiPublishDashboardDraftValidator = {
  bodySchema: z.strictObject({
    note: z.string().optional().describe("Shown in the version history."),
  }),
  querySchema: z.never(),
  paramsSchema: draftParams,
};
