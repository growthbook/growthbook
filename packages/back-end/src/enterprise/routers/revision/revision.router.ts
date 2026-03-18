import express from "express";
import { z } from "zod";
import { revisionTargetType, revisionCreateValidator } from "shared/enterprise";
import { putSavedGroupBodyValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawRevisionController from "./revision.controller";

const router = express.Router();

const revisionController = wrapController(rawRevisionController);

// Get all revisions for the organization
router.get("/", revisionController.getAllRevisions);

// Create a new revision (or update existing one if user has an open draft)
router.post(
  "/",
  validateRequestMiddleware({
    body: revisionCreateValidator.strict(),
  }),
  revisionController.postRevision,
);

// Lightweight beacon: returns target IDs with open revisions (no full documents)
router.get(
  "/entity/:entityType/beacon",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(revisionTargetType),
      })
      .strict(),
  }),
  revisionController.getRevisionBeacon,
);

// Get revisions for an entity
router.get(
  "/entity/:entityType/:entityId",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(revisionTargetType),
        entityId: z.string(),
      })
      .strict(),
  }),
  revisionController.getRevisionsByEntity,
);

// Get all revisions for a specific entity type
router.get(
  "/entity/:entityType",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(revisionTargetType),
      })
      .strict(),
  }),
  revisionController.getRevisionsByEntityType,
);

// Get a specific revision
router.get(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  revisionController.getRevision,
);

// Add a review to a revision
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
  revisionController.postReview,
);

// Update proposed changes in a revision
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
  revisionController.putProposedChanges,
);

// Update title of a revision
router.patch(
  "/:id/title",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z
      .object({
        title: z.string(),
      })
      .strict(),
  }),
  revisionController.patchTitle,
);

// Merge a revision
router.post(
  "/:id/merge",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  revisionController.postMerge,
);

// Close a revision
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
  revisionController.postClose,
);

// Reopen a closed revision
router.post(
  "/:id/reopen",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  revisionController.postReopen,
);

// Get revision history for an entity
router.get(
  "/entity/:entityType/:entityId/history",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(revisionTargetType),
        entityId: z.string(),
      })
      .strict(),
  }),
  revisionController.getRevisionHistory,
);

// Check current merge conflict status
router.get(
  "/:id/conflicts",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  revisionController.getConflicts,
);

// Rebase a revision on top of current live state
router.post(
  "/:id/rebase",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
    body: z
      .object({
        strategies: z.record(z.string(), z.enum(["discard", "overwrite"])),
        mergeResultSerialized: z.string(),
      })
      .strict(),
  }),
  revisionController.postRebase,
);

export { router as revisionRouter };
