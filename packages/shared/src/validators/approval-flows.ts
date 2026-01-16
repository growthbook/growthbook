import { z } from "zod";
import { factMetricValidator } from "shared/validators";

// Approval flow statuses (similar to GitHub PR states)
export const approvalFlowStatusArray = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
  "merged",
  "closed",
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
  "fact-metric",
] as const;
export type ApprovalEntityType = (typeof approvalEntityTypeArray)[number];

// Review/Comment validator
export const reviewValidator = z.object({
  id: z.string(),
  userId: z.string(),
  decision: z.enum(reviewDecisionArray),
  comment: z.string(),
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
    "merged",
    "closed",
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

// Fact metric approval flow with entity-specific fields
export const factMetricApprovalFlowValidator = z.object({
  entityType: z.literal("fact-metric"),
  entity: factMetricValidator,
});

//TODO: figure out a good way to get this to work
export const originalEntityValidator = z.discriminatedUnion("entityType", [
  factMetricApprovalFlowValidator,
]);

// Base approval flow fields (common to all entity types)
export const approvalFlowValidator = approvalFlowCreateValidator.extend({
  status: z.enum(approvalFlowStatusArray).default("pending-review"),
  author: z.string(),
  reviews: z.array(reviewValidator),
  activityLog: z.array(activityLogEntryValidator),
  mergedAt: z.date().optional(),
  closedAt: z.date().optional(),
  mergedBy: z.string().optional(),
  closedBy: z.string().optional(),
  id: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  organization: z.string(),
  originalEntity: z.record(z.string(), z.unknown()),
});




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

// Validator for entities that can have approval flows
// Includes fields commonly used in approval flow conditions
export const approvalFlowEntityValidator = z.object({
  id: z.string(),
  managedBy: z.enum(["", "api", "admin"]).optional(),
  verified: z.boolean().optional(),
  projects: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
}).strip();

export type ApprovalFlowEntity = z.infer<typeof approvalFlowEntityValidator>;

