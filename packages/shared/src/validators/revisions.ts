import { z } from "zod";
import { savedGroupValidator } from "./saved-group";

export const revisionStatus = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
  "merged",
  "discarded",
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
    "discarded",
    "reopened",
  ]),
  description: z.string().nullish(),
  dateCreated: z.date(),
});
export type ActivityLogEntry = z.infer<typeof activityLogEntryValidator>;

// To add a new entity type to the revision system:
// 1. Add the string literal here (e.g. "feature")
// 2. Create revisionFeatureTargetValidator with snapshot: <entityValidator> below
// 3. Add it to revisionTargetValidator's discriminated union
// 4. Create packages/back-end/src/revisions/adapters/feature.adapter.ts
// 5. Register it in packages/back-end/src/revisions/index.ts registry
// 6. Extend getRevisionKey / canUserReviewEntity switches in shared/src/revisions/helpers.ts
export const revisionTargetType = ["saved-group"] as const;
export type RevisionTargetType = (typeof revisionTargetType)[number];

export const jsonPatchOperationValidator = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: z.string(), value: z.unknown() }),
  z.object({ op: z.literal("remove"), path: z.string() }),
  z.object({
    op: z.literal("replace"),
    path: z.string(),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal("move"),
    from: z.string(),
    path: z.string(),
  }),
  z.object({
    op: z.literal("copy"),
    from: z.string(),
    path: z.string(),
  }),
  z.object({ op: z.literal("test"), path: z.string(), value: z.unknown() }),
]);
export type JsonPatchOperation = z.infer<typeof jsonPatchOperationValidator>;

export const revisionSavedGroupTargetValidator = z.object({
  type: z.literal("saved-group"),
  id: z.string(),
  snapshot: savedGroupValidator,
  proposedChanges: z.array(jsonPatchOperationValidator),
});
export type RevisionSavedGroupTarget = z.infer<
  typeof revisionSavedGroupTargetValidator
>;

// Extension point: add new revisionXxxTargetValidator entries here as new entity types are added.
// Each validator must have a unique `type` literal and a `snapshot` field with the entity's schema.
export const revisionTargetValidator = z.discriminatedUnion("type", [
  revisionSavedGroupTargetValidator,
  // revisionFeatureTargetValidator,  ← add future entity types here
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
      action: z.enum(["merged", "discarded"]),
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
    proposedChanges: z.array(jsonPatchOperationValidator),
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
