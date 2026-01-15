import { z } from "zod";
import { ConditionInterface,
evalCondition } from "@growthbook/growthbook";

// Approval flow statuses (similar to GitHub PR states)
export const approvalFlowStatusArray = [
  "pending-review",
  "approved",
  "changes-requested",
  "merged", //TODO change to published
  "closed", //TODO move to archived
] as const;
export type ApprovalFlowStatus = (typeof approvalFlowStatusArray)[number];

// Review decision types
export const reviewDecisionArray = [
  "approve",
  "request-changes",
  "comment",
] as const;
export type ReviewDecision = (typeof reviewDecisionArray)[number];

// Entity types that can have approval flows
export const approvalEntityTypeArray = [
  // "experiment",
  "fact-metric",
  // "fact-table",
] as const;
export type ApprovalEntityType = (typeof approvalEntityTypeArray)[number];

// Review/Comment validator
export const reviewValidator = z.object({
  id: z.string(),
  userId: z.string(),
  decision: z.enum(reviewDecisionArray),
  comment: z.string().optional(),
  createdAt: z.date(),
});

// The actual changes being proposed
// This is a flexible object that can contain different fields based on the entity type
export const proposedChangesValidator = z.record(z.string(), z.unknown());

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
    "merged", //TODO change to published
    "closed", //TODO move to archived
    "reopened",
  ]),
  details: z.string().optional(),
  createdAt: z.date(),
});



export const approvalFlowCreateValidator = z.object({
  entityType: z.enum(approvalEntityTypeArray),
  entityId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  proposedChanges: proposedChangesValidator,
});
export type ApprovalFlowCreateInterface = z.infer<typeof approvalFlowCreateValidator>;

// Main approval flow schema
const approvalFlowBaseValidator = approvalFlowCreateValidator.extend({
  status: z.enum(approvalFlowStatusArray).default("pending-review"),
  author: z.string(),
  reviews: z.array(reviewValidator),
  activityLog: z.array(activityLogEntryValidator),
  mergedAt: z.date().optional(),
  closedAt: z.date().optional(),
  mergedBy: z.string().optional(),
  closedBy: z.string().optional(),
  originalEntity: z.record(z.string(), z.unknown()),
  id: z.string(),
});

export const approvalFlowValidator = approvalFlowBaseValidator.strict();

export type ApprovalFlowInterface = z.infer<typeof approvalFlowValidator>;
export type Review = z.infer<typeof reviewValidator>;
export type ProposedChanges = z.infer<typeof proposedChangesValidator>;
export type ActivityLogEntry = z.infer<typeof activityLogEntryValidator>;

// Conflict information computed on-the-fly (not stored)
export type Conflict = {
  field: string; // The field name that has a conflict
  baseValue: unknown; // Value at the time approval flow was created
  liveValue: unknown; // Current value in the entity
  proposedValue: unknown; // Value being proposed in this approval flow
};

// Merge result computed on-the-fly
export type MergeResult = {
  success: boolean;
  conflicts: Conflict[];
  canAutoMerge: boolean;
  fieldsChanged: string[];
  mergedChanges?: Record<string, unknown>;
};