import express from "express";
import { z } from "zod";
import {
  approvalFlowTargetType,
  approvalFlowCreateValidator,
} from "shared/enterprise";
import { putSavedGroupBodyValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawApprovalFlowController from "./approval-flow.controller";

const router = express.Router();

const approvalFlowController = wrapController(rawApprovalFlowController);

// Get all approval flows for the organization
router.get("/", approvalFlowController.getAllApprovalFlows);

// Create a new approval flow (or update existing one if user has an open draft)
router.post(
  "/",
  validateRequestMiddleware({
    body: approvalFlowCreateValidator.strict(),
  }),
  approvalFlowController.postApprovalFlow,
);

// Lightweight beacon: returns target IDs with open flows (no full documents)
router.get(
  "/entity/:entityType/beacon",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(approvalFlowTargetType),
      })
      .strict(),
  }),
  approvalFlowController.getApprovalFlowBeacon,
);

// Get approval flows for an entity
router.get(
  "/entity/:entityType/:entityId",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(approvalFlowTargetType),
        entityId: z.string(),
      })
      .strict(),
  }),
  approvalFlowController.getApprovalFlowsByEntity,
);

// Get all approval flows for a specific entity type
router.get(
  "/entity/:entityType",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(approvalFlowTargetType),
      })
      .strict(),
  }),
  approvalFlowController.getApprovalFlowsByEntityType,
);

// Get a specific approval flow
router.get(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  approvalFlowController.getApprovalFlow,
);

// Add a review to an approval flow
router.post(
  "/:id/review",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z
      .object({
        decision: z.enum(["approve", "request-changes", "comment"]),
        comment: z.string(),
      })
      .strict(),
  }),
  approvalFlowController.postReview,
);

// Update proposed changes in an approval flow
router.put(
  "/:id/proposed-changes",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z
      .object({
        proposedChanges: putSavedGroupBodyValidator.partial(),
      })
      .strict(),
  }),
  approvalFlowController.putProposedChanges,
);

// Merge an approval flow
router.post(
  "/:id/merge",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  approvalFlowController.postMerge,
);

// Close an approval flow
router.post(
  "/:id/close",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z
      .object({
        reason: z.string().optional(),
      })
      .strict(),
  }),
  approvalFlowController.postClose,
);

// Reopen a closed approval flow
router.post(
  "/:id/reopen",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  approvalFlowController.postReopen,
);

// Get revision history for an entity
router.get(
  "/entity/:entityType/:entityId/history",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(approvalFlowTargetType),
        entityId: z.string(),
      })
      .strict(),
  }),
  approvalFlowController.getRevisionHistory,
);

// Check current merge conflict status
router.get(
  "/:id/conflicts",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  approvalFlowController.getConflicts,
);

export { router as approvalFlowRouter };
