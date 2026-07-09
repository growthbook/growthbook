import { z } from "zod";

// Deliberately a standalone definition rather than a reference to
// startChecklistItemStatusValidator: keeping the error contract decoupled from
// the checklist endpoints' response shape prevents unintentional drift in the
// API surface. Keep the fields aligned with StartChecklistItemStatus.
const checklistItemSchema = z.object({
  key: z.string(),
  required: z.boolean(),
  status: z.enum(["complete", "incomplete"]),
  manual: z.boolean(),
  reason: z.string(),
});

const pendingDraftFailureSchema = z.object({
  featureId: z.string(),
  revisionVersion: z.number(),
  reason: z.enum([
    "merge-conflict",
    "needs-rebase",
    "needs-approval",
    "publish-error",
  ]),
});

export const apiErrorRegistry = {
  conflict: {
    status: 409,
    description: "Conflict",
    detailsSchema: z.object({ conflicts: z.array(z.unknown()) }),
  },
  checklist_incomplete: {
    status: 409,
    description: "Required checklist items are incomplete",
    detailsSchema: z.object({
      remainingChecklistItems: z.array(checklistItemSchema),
    }),
  },
  pending_draft_publish_failed: {
    status: 409,
    description: "One or more linked feature drafts could not be published",
    detailsSchema: z.object({
      failedFeatureDrafts: z.array(pendingDraftFailureSchema),
    }),
  },
  invalid_status: {
    status: 409,
    description: "Resource is not in a valid status for this operation",
    detailsSchema: z.object({
      currentStatus: z.string(),
      expectedStatuses: z.array(z.string()),
    }),
  },
} satisfies Record<
  string,
  { status: number; description: string; detailsSchema: z.ZodTypeAny }
>;

export type ApiErrorCode = keyof typeof apiErrorRegistry;

export type ApiErrorDetails<C extends ApiErrorCode> = z.infer<
  (typeof apiErrorRegistry)[C]["detailsSchema"]
>;
