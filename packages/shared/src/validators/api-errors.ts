import { z } from "zod";

const startChecklistItemStatusSchema = z.object({
  key: z.string(),
  required: z.boolean(),
  status: z.enum(["complete", "incomplete"]),
  reason: z.string(),
});

const pendingDraftFailureSchema = z.object({
  featureId: z.string(),
  revisionVersion: z.number(),
  reason: z.enum(["merge-conflict", "needs-approval", "publish-error"]),
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
      remainingChecklistItems: z.array(startChecklistItemStatusSchema),
    }),
  },
  pending_draft_publish_failed: {
    status: 409,
    description: "One or more linked feature drafts could not be published",
    detailsSchema: z.object({
      failedFeatureDrafts: z.array(pendingDraftFailureSchema),
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
