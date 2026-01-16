import express from "express";
import z from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawApprovalFlowController from "./approval-flow.controller";
import { approvalFlowCreateValidator } from "shared/validators";

const router = express.Router();

const approvalFlowController = wrapController(rawApprovalFlowController);

// Get all approval flows for the organization
router.get(
  "/",
  approvalFlowController.getAllApprovalFlows
);

// Create a new approval flow (or update existing one if user has an open draft)
router.post(
  "/",
  validateRequestMiddleware({
    body: approvalFlowCreateValidator.strict(),
  }),
  approvalFlowController.postApprovalFlow
);

// Get approval flows for an entity
router.get(
  "/entity/:entityType/:entityId",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(["experiment", "fact-metric", "fact-table", "metric"]),
        entityId: z.string(),
      })
      .strict(),
  }),
  approvalFlowController.getApprovalFlowsByEntity
);

// Get all approval flows for a specific entity type
router.get(
  "/entity/:entityType",
  validateRequestMiddleware({
    params: z.object({ entityType: z.enum(["experiment", "fact-metric", "fact-table", "metric"]) }).strict(),
  }),
  approvalFlowController.getApprovalFlowsByEntityType
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
  approvalFlowController.getApprovalFlow
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
  approvalFlowController.postReview
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
        proposedChanges: z.record(z.unknown()),
      })
      .strict(),
  }),
  approvalFlowController.putProposedChanges
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
  approvalFlowController.postMerge
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
  approvalFlowController.postClose
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
  approvalFlowController.postReopen
);

// Get revision history for an entity
router.get(
  "/entity/:entityType/:entityId/history",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(["experiment", "fact-metric", "fact-table", "metric"]),
        entityId: z.string(),
      })
      .strict(),
  }),
  approvalFlowController.getRevisionHistory
);

// // Revert to a previous merged approval flow state
// router.post(
//   "/:id/revert",
//   validateRequestMiddleware({
//     params: z
//       .object({
//         id: z.string(),
//       })
//       .strict(),
//     body: z
//       .object({
//         title: z.string().optional(),
//         description: z.string().optional(),
//       })
//       .strict(),
//   }),
//   approvalFlowController.postRevert
// );

// // Check for merge conflicts
// router.get(
//   "/:id/conflicts",
//   validateRequestMiddleware({
//     params: z
//       .object({
//         id: z.string(),
//       })
//       .strict(),
//   }),
//   approvalFlowController.getConflicts
// );

// // Resolve merge conflicts
// router.post(
//   "/:id/resolve-conflicts",
//   validateRequestMiddleware({
//     params: z
//       .object({
//         id: z.string(),
//       })
//       .strict(),
//     body: z
//       .object({
//         resolvedChanges: z.record(z.unknown()),
//       })
//       .strict(),
//   }),
//   approvalFlowController.postResolveConflicts
// );

export { router as approvalFlowRouter };

