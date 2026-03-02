import { z } from "zod";
import {
  savedGroupValidator,
  putSavedGroupBodyValidator,
} from "../../validators/saved-group";

export const approvalFlowStatus = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
  "merged",
  "closed",
] as const;
export type ApprovalFlowStatus = (typeof approvalFlowStatus)[number];

export const reviewDecision = [
  "approve",
  "request-changes",
  "comment",
] as const;
export type ReviewDecision = (typeof reviewDecision)[number];

export const reviewValidator = z.object({
  id: z.string(),
  userId: z.string(),
  decision: z.enum(reviewDecision),
  dateCreated: z.date(),
});
export type Review = z.infer<typeof reviewValidator>;

// Activity log entry (for timeline/history)
export const activityLogEntryValidator = z.object({
  id: z.string(),
  userId: z.string(),
  action: z.enum([
    "created",
    "updated",
    "reviewed",
    "approved",
    "requested-changes",
    "commented",
    "merged",
    "closed",
    "reopened",
  ]),
  description: z.string().optional(),
  dateCreated: z.date(),
});
export type ActivityLogEntry = z.infer<typeof activityLogEntryValidator>;

export const approvalFlowTargetType = ["saved-group"] as const;
export type ApprovalFlowTargetType = (typeof approvalFlowTargetType)[number];

export const approvalFlowSavedGroupTargetValidator = z.object({
  type: z.literal("saved-group"),
  id: z.string(),
  snapshot: savedGroupValidator,
  proposedChanges: putSavedGroupBodyValidator.partial(),
});
export type ApprovalFlowSavedGroupTarget = z.infer<
  typeof approvalFlowSavedGroupTargetValidator
>;

export const approvalFlowTargetValidator = z.discriminatedUnion("type", [
  approvalFlowSavedGroupTargetValidator,
]);
export type ApprovalFlowTarget = z.infer<typeof approvalFlowTargetValidator>;

export const approvalFlowValidator = z.object({
  id: z.string(),
  authorId: z.string(),
  target: approvalFlowTargetValidator,
  status: z.enum(approvalFlowStatus),
  reviews: z.array(reviewValidator),
  activityLog: z.array(activityLogEntryValidator),
  resolution: z
    .object({
      action: z.enum(["merged", "closed"]),
      userId: z.string(),
      dateCreated: z.date(),
    })
    .optional(),
  // BaseModel fields
  dateCreated: z.date(),
  dateUpdated: z.date(),
  organization: z.string(),
});
export type ApprovalFlow = z.infer<typeof approvalFlowValidator>;

// Runtime generated types
export type Conflict = {
  field: string;
  baseValue: unknown;
  liveValue: unknown;
  proposedValue: unknown;
};

export type MergeResult = {
  success: boolean;
  conflicts: Conflict[];
  canAutoMerge: boolean;
  fieldsChanged: string[];
  mergedChanges?: Record<string, unknown>;
};
