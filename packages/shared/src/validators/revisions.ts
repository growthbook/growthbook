import { z } from "zod";
import { savedGroupValidator } from "./saved-group";
import { constantValidator } from "./constant";
import { configValidator } from "./config";

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

// To add a new entity type to the revision system:
// 1. Add the string literal here (e.g. "feature")
// 2. Create revisionFeatureTargetValidator with snapshot: <entityValidator> below
// 3. Add it to revisionTargetValidator's discriminated union
// 4. Create packages/back-end/src/revisions/adapters/feature.adapter.ts
// 5. Register it in packages/back-end/src/revisions/index.ts registry
// 6. Extend getRevisionKey / canUserReviewEntity switches in shared/src/revisions/helpers.ts
export const revisionTargetType = [
  "saved-group",
  "constant",
  "config",
] as const;
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
  // `target.proposedChanges` after this entry; only for content-changing actions.
  // The UI pairs it with the previous entry's snapshot to build a per-entry diff.
  proposedChangesSnapshot: z.array(jsonPatchOperationValidator).optional(),
  // `target.snapshot` after this entry; only persisted on a rebase.
  targetSnapshot: z.unknown().optional(),
});
export type ActivityLogEntry = z.infer<typeof activityLogEntryValidator>;

export const revisionSavedGroupTargetValidator = z.object({
  type: z.literal("saved-group"),
  id: z.string(),
  snapshot: savedGroupValidator,
  proposedChanges: z.array(jsonPatchOperationValidator),
});
export type RevisionSavedGroupTarget = z.infer<
  typeof revisionSavedGroupTargetValidator
>;

export const revisionConstantTargetValidator = z.object({
  type: z.literal("constant"),
  id: z.string(),
  snapshot: constantValidator,
  proposedChanges: z.array(jsonPatchOperationValidator),
});
export type RevisionConstantTarget = z.infer<
  typeof revisionConstantTargetValidator
>;

export const revisionConfigTargetValidator = z.object({
  type: z.literal("config"),
  id: z.string(),
  snapshot: configValidator,
  proposedChanges: z.array(jsonPatchOperationValidator),
});
export type RevisionConfigTarget = z.infer<
  typeof revisionConfigTargetValidator
>;

// Extension point: add new revisionXxxTargetValidator entries here as new entity types are added.
// Each validator must have a unique `type` literal and a `snapshot` field with the entity's schema.
export const revisionTargetValidator = z.discriminatedUnion("type", [
  revisionSavedGroupTargetValidator,
  revisionConstantTargetValidator,
  revisionConfigTargetValidator,
  // revisionFeatureTargetValidator,  ← add future entity types here
]);
export type RevisionTarget = z.infer<typeof revisionTargetValidator>;

export const revisionValidator = z.object({
  id: z.string(),
  authorId: z.string(),
  version: z.number().optional(), // Optional for backward compatibility with existing revisions
  title: z.string().optional(),
  comment: z.string().optional(), // Optional free-form context supplied at draft creation
  revertedFrom: z.string().optional(), // ID of the revision this is reverting
  target: revisionTargetValidator,
  status: z.enum(revisionStatus),
  reviews: z.array(reviewValidator),
  // Everyone who edited this revision (always includes the author); drives
  // `blockSelfApproval`. Optional for backward compatibility.
  contributors: z.array(z.string()).optional(),
  autoPublishOnApproval: z.boolean().optional(),
  // Who armed `autoPublishOnApproval`; auto-publish runs with their authority.
  autoPublishEnabledBy: z.string().optional(),
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
