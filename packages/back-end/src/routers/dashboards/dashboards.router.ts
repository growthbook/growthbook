import express from "express";
import { z } from "zod";
import {
  blockComparisonValidator,
  createDashboardBlockInterface,
  dashboardBlockInterface,
  dashboardDraftOpInput,
  dashboardGlobalControlsValidator,
  legacyDashboardBlockInterface,
  dashboardEditLevel,
  dashboardShareLevel,
  dashboardUpdateSchedule,
} from "shared/enterprise";
import { aiChatMentionValidator } from "shared/validators";
import { aiModelValidator } from "back-end/src/routers/ai/ai.validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import {
  cancelChat,
  getChat,
} from "back-end/src/routers/product-analytics/product-analytics.controller";
import * as rawDashboardsController from "./dashboards.controller";

const router = express.Router();
const dashboardsController = wrapController(rawDashboardsController);
// Conversation reads and cancels are the same for every agent.
const chatController = wrapController({ cancelChat, getChat });

const dashboardParams = z.object({ id: z.string() }).strict();
export const createDashboardBody = z
  .object({
    experimentId: z.string().optional(),
    title: z.string(),
    editLevel: dashboardEditLevel,
    shareLevel: dashboardShareLevel,
    enableAutoUpdates: z.boolean(),
    updateSchedule: dashboardUpdateSchedule.optional(),
    globalControls: dashboardGlobalControlsValidator.optional(),
    comparison: blockComparisonValidator.optional(),
    blocks: z.array(createDashboardBlockInterface),
    projects: z.array(z.string()).optional(),
    userId: z.string().optional(),
    isDraft: z.boolean().optional(),
  })
  .strict();

export const updateDashboardBody = z
  .object({
    title: z.string().optional(),
    editLevel: dashboardEditLevel.optional(),
    userId: z.string().optional(),
    shareLevel: dashboardShareLevel.optional(),
    enableAutoUpdates: z.boolean().optional(),
    updateSchedule: dashboardUpdateSchedule.optional(),
    globalControls: dashboardGlobalControlsValidator.optional(),
    // Dashboard-wide period comparison. Declared here because the body is
    // `.strict()` — without it the field is rejected rather than ignored, so
    // the dashboard-level compare toggle can never persist.
    comparison: blockComparisonValidator.optional(),
    projects: z.array(z.string()).optional(),
    blocks: z
      .array(
        z.union([
          createDashboardBlockInterface,
          dashboardBlockInterface,
          legacyDashboardBlockInterface,
        ]),
      )
      .optional(),
  })
  .strict();

export const saveDashboardDraftBody = updateDashboardBody.pick({
  title: true,
  blocks: true,
  globalControls: true,
  comparison: true,
});

export const revertDashboardDraftBody = z
  .object({
    blockId: z.string().optional(),
    setting: z.enum(["title", "globalControls", "comparison"]).optional(),
  })
  .strict();

export const publishDashboardDraftBody = z
  .object({ note: z.string().optional() })
  .strict();

const conversationParams = z
  .object({ conversationId: z.string().min(1) })
  .strict();

// Before the /:id routes so "chat" is never read as a dashboard id.
router.post(
  "/chat",
  validateRequestMiddleware({
    body: z
      .object({
        message: z.string().min(1),
        conversationId: z.string().min(1),
        dashboardId: z.string().min(1),
        datasourceId: z.string(),
        mode: z.enum(["build", "ask"]).optional(),
        model: aiModelValidator,
        mentions: aiChatMentionValidator.array().optional(),
      })
      .strict(),
  }),
  dashboardsController.postDashboardBuilderChat,
);
router.get(
  "/chat/:conversationId",
  validateRequestMiddleware({ params: conversationParams }),
  chatController.getChat,
);
router.post(
  "/chat/:conversationId/cancel",
  validateRequestMiddleware({ params: conversationParams }),
  chatController.cancelChat,
);

router.get(
  "/",
  validateRequestMiddleware({
    query: z
      .object({ includeExperimentDashboards: z.string().optional() })
      .strict(),
  }),
  dashboardsController.getAllDashboards,
);

router.get(
  "/by-experiment/:experimentId",
  validateRequestMiddleware({
    params: z.object({ experimentId: z.string() }).strict(),
  }),
  dashboardsController.getDashboardsForExperiment,
);

router.post(
  "/",
  validateRequestMiddleware({ body: createDashboardBody }),
  dashboardsController.createDashboard,
);

router.get(
  "/:id",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.getDashboard,
);
router.put(
  "/:id",
  validateRequestMiddleware({
    body: updateDashboardBody,
    params: dashboardParams,
  }),
  dashboardsController.updateDashboard,
);

router.delete(
  "/:id",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.deleteDashboard,
);

router.post(
  "/:id/refresh",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.refreshDashboardData,
);

router.get(
  "/:id/snapshots",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.getDashboardSnapshots,
);

router.get(
  "/:id/draft",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.getDashboardDraft,
);
router.put(
  "/:id/draft",
  validateRequestMiddleware({
    body: saveDashboardDraftBody,
    params: dashboardParams,
  }),
  dashboardsController.saveDashboardDraft,
);
router.post(
  "/:id/draft",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.createDashboardDraft,
);
router.post(
  "/:id/draft/ops",
  validateRequestMiddleware({
    body: dashboardDraftOpInput,
    params: dashboardParams,
  }),
  dashboardsController.editDashboardDraft,
);
router.post(
  "/:id/draft/summary",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.summarizeDashboardDraft,
);
router.get(
  "/:id/versions",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.getDashboardVersions,
);
router.post(
  "/:id/draft/restore",
  validateRequestMiddleware({
    body: z.object({ version: z.number().int() }).strict(),
    params: dashboardParams,
  }),
  dashboardsController.restoreDashboardVersion,
);
router.post(
  "/:id/draft/revert",
  validateRequestMiddleware({
    body: revertDashboardDraftBody,
    params: dashboardParams,
  }),
  dashboardsController.revertDashboardDraftChange,
);
router.post(
  "/:id/draft/undo",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.undoDashboardDraft,
);
router.post(
  "/:id/draft/publish",
  validateRequestMiddleware({
    body: publishDashboardDraftBody,
    params: dashboardParams,
  }),
  dashboardsController.publishDashboardDraft,
);
router.delete(
  "/:id/draft",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.discardDashboardDraft,
);

export { router as dashboardsRouter };
