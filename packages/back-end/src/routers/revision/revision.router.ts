import express from "express";
import { z } from "zod";
import {
  revisionTargetType,
  revisionStatus,
  revisionCreateValidator,
  jsonPatchOperationValidator,
} from "shared/enterprise";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawRevisionController from "./revision.controller";

const router = express.Router();

const revisionController = wrapController(rawRevisionController);

// Allowed `status` query values: any individual revision status, or the alias
// "open" for non-merged/non-discarded. Validated server-side so a typo
// (e.g. "?status=garabge") returns a 400 instead of silently matching nothing.
const revisionStatusQueryValues = [...revisionStatus, "open"] as const;

// Shared pagination/filtering query schema for revision list endpoints.
// `status` can be a single value or a comma-separated list of values from
// `revisionStatusQueryValues`.
const revisionListQuery = z
  .object({
    status: z
      .string()
      .optional()
      .refine(
        (val) => {
          if (!val) return true;
          const parts = val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          return parts.every((p) =>
            (revisionStatusQueryValues as readonly string[]).includes(p),
          );
        },
        {
          message: `status must be a comma-separated list of: ${revisionStatusQueryValues.join(
            ", ",
          )}`,
        },
      ),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

// Get all revisions for the organization (paginated; status filter optional)
router.get(
  "/",
  validateRequestMiddleware({ query: revisionListQuery }),
  revisionController.getAllRevisions,
);

// Lightweight count of open revisions across the org (optionally scoped to a type).
// Used by the top-nav badge.
router.get(
  "/count",
  validateRequestMiddleware({
    query: z
      .object({
        entityType: z.enum(revisionTargetType).optional(),
      })
      .strict(),
  }),
  revisionController.getOpenRevisionCount,
);

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

// Get all revisions for a specific entity type (paginated; status filter optional)
router.get(
  "/entity/:entityType",
  validateRequestMiddleware({
    params: z
      .object({
        entityType: z.enum(revisionTargetType),
      })
      .strict(),
    query: revisionListQuery,
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

// Submit a draft for review (changes status from "draft" to "pending-review")
router.post(
  "/:id/submit",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  revisionController.postSubmit,
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
        proposedChanges: z.array(jsonPatchOperationValidator),
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
    body: z.object({
      strategies: z.record(
        z.string(),
        z.enum(["discard", "overwrite", "union"]),
      ),
      mergeResultSerialized: z.string(),
      customValues: z.record(z.string(), z.array(z.unknown())).optional(),
    }),
  }),
  revisionController.postRebase,
);

export { router as revisionRouter };
