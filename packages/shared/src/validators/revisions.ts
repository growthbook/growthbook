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
  // A verdict demoted by a later cycle reset (re-submit, approval reset on edit,
  // recall, reopen) — kept for attribution but no longer an active approval or
  // block. Mirrors the feature flow's "-stale" verdict variants; verdict
  // activeness is read from this flag, not recomputed from the activity log.
  stale: z.boolean().optional().meta({
    description:
      "True if a later review cycle (re-submit, approval reset, recall, or reopen) superseded this verdict. Stale verdicts are kept for attribution but no longer count as an active approval or change-request.",
  }),
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
    // Author submitted (or re-submitted) the revision for review. Starts a new
    // review cycle, invalidating any prior verdicts. Distinct from "reopened"
    // (which returns a revision to draft) so the timeline can render it as a
    // dedicated "Review Requested" event.
    "review-requested",
    // A reviewer retracted their own verdict via undo-review. The verdict is
    // removed from reviews[], so this entry preserves a visible trace (and the
    // retracted decision) for the timeline. Does NOT reset the review cycle.
    "review-retracted",
    "merged",
    "discarded",
    "reopened",
    "scheduled-publish",
    "scheduled-publish-updated",
    "scheduled-publish-canceled",
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
  // ── Scheduled / deferred publish (shape mirrors FeatureRevisionInterface) ──
  // Defers an armed revision's auto-publish until on/after this date (and, if
  // required, approved). null/absent = publish as soon as approved.
  scheduledPublishAt: z.union([z.null(), z.date()]).optional(),
  // While pending, freeze content edits to this draft (rebase still allowed).
  scheduledPublishLockEdits: z.boolean().optional(),
  // While pending, block publishing other drafts of the same entity.
  scheduledPublishLockOthers: z.boolean().optional(),
  // True when an admin armed this schedule via the bypass-approval override; the
  // schedule is then cancel-and-re-arm only. Fire-time bypass still derives from
  // the armer's live role, not this flag.
  scheduledPublishBypassApproval: z.boolean().optional(),
  // Poller bookkeeping when a due publish can't go through yet (e.g. awaiting
  // approval, merge conflict). Surfaces a "stuck" schedule instead of silently
  // retrying. Cleared on a successful publish or when the schedule is canceled.
  scheduledPublishAttempts: z.number().optional(),
  scheduledPublishLastError: z.string().optional(),
  // Backoff gate: the poller skips a due-but-failing revision until this time,
  // so doomed retries space out exponentially instead of firing every tick.
  scheduledPublishNextAttemptAt: z.union([z.null(), z.date()]).optional(),
  // Set when the poller gives up on a failing scheduled publish (terminal
  // failure, or transient failures exhausted the attempt cap). The schedule is
  // cleared and the draft left open; this timestamp marks it as abandoned so the
  // UI can flag it. Cleared when the schedule is re-armed or canceled.
  scheduledPublishGaveUpAt: z.union([z.null(), z.date()]).optional(),
  // Deferred-publish guard fingerprints: per-guard (experiment / config-lock /
  // schema-break) sets of conflicting keys the armer acknowledged (bypassed) when
  // arming this deferred publish. At merge time each guard recomputes its live
  // conflict set and compares key-for-key; a divergence fails the publish so a
  // human re-contends. Keys only (not values), so re-editing the shipped values
  // doesn't change conflict identity. Keyed by guard id so the same key acknowledged
  // for different guards never collides. Config/constant revisions; cleared on
  // re-arm/cancel.
  armAcknowledgments: z.record(z.string(), z.array(z.string())).optional(),
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

// Input for arming/canceling a scheduled publish. `scheduledPublishAt: null`
// cancels the schedule (and disarms auto-publish). Mirrors the feature
// schedule-publish request body.
export type ScheduledPublishInput = {
  scheduledPublishAt: Date | null;
  lockEdits?: boolean;
  lockOthers?: boolean;
  bypassApproval?: boolean;
  // Per-guard acknowledgment fingerprints captured at arm time (the conflicting
  // keys the armer bypassed, keyed by guard id). Stored on the revision for the
  // merge-time recheck. Absent/empty clears any prior fingerprint on (re-)arm.
  armAcknowledgments?: Record<string, string[]>;
};

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
