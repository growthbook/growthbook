import { z } from "zod";
import {
  savedGroupValidator,
  putSavedGroupBodyValidator,
} from "../../validators/saved-group";

export const revisionStatus = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
  "merged",
  "closed",
] as const;
export type RevisionStatus = (typeof revisionStatus)[number];

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
  comment: z.string().optional(),
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
  description: z.string().nullish(),
  dateCreated: z.date(),
});
export type ActivityLogEntry = z.infer<typeof activityLogEntryValidator>;

export const revisionTargetType = ["saved-group"] as const;
export type RevisionTargetType = (typeof revisionTargetType)[number];

export const revisionSavedGroupTargetValidator = z.object({
  type: z.literal("saved-group"),
  id: z.string(),
  snapshot: savedGroupValidator,
  proposedChanges: putSavedGroupBodyValidator.partial(),
});
export type RevisionSavedGroupTarget = z.infer<
  typeof revisionSavedGroupTargetValidator
>;

export const revisionTargetValidator = z.discriminatedUnion("type", [
  revisionSavedGroupTargetValidator,
]);
export type RevisionTarget = z.infer<typeof revisionTargetValidator>;

export const revisionValidator = z.object({
  id: z.string(),
  authorId: z.string(),
  version: z.number().optional(), // Optional for backward compatibility with existing revisions
  title: z.string().optional(),
  revertedFrom: z.string().optional(), // ID of the revision this is reverting
  target: revisionTargetValidator,
  status: z.enum(revisionStatus),
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
export type Revision = z.infer<typeof revisionValidator>;

export const revisionCreateValidator = z.object({
  target: z.object({
    type: z.enum(revisionTargetType),
    id: z.string(),
    proposedChanges: putSavedGroupBodyValidator.partial(),
  }),
});

export type RevisionEntity = {
  managedBy?: string;
  ownerTeam?: string;
  [key: string]: unknown;
};

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
