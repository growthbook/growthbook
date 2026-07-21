import type { RevisionTargetType } from "shared/enterprise";
import type {
  BypassedGate,
  PublishGate,
} from "back-end/src/revisions/publishGates";
import type { BulkRevisionRef } from "back-end/src/revisions/bulkPublish/BulkPublishableAdapter";

/**
 * Entity types that can participate in a bulk (multi-entity) publish. The
 * generic revision system covers RevisionTargetType; features keep their own
 * revision model, so the bulk layer widens the union rather than the shared
 * one. New version-controlled entity types join by registering a generic
 * adapter — see registry.ts.
 */
export type BulkPublishTargetType = RevisionTargetType | "feature";

/** One requested publish: exactly one revision per (entityType, entityId). */
export type BulkPublishItemRef = {
  entityType: BulkPublishTargetType;
  /** Internal entity id (API-layer identifiers like config keys are resolved before planning). */
  entityId: string;
  /** Version number of the revision to publish for this entity. */
  version: number;
  /**
   * The identifier the caller used (config/constant key, or the internal id
   * when that's what they sent). Used in user-facing gate/error MESSAGES so
   * they never leak an internal id. Defaults to entityId when unset.
   */
  displayId?: string;
};

/**
 * Request override flags — exactly the platform's three-class model
 * (publishOverrideBodyFields). There is deliberately no bypassApproval flag:
 * approval-required gates clear by caller authority (bypassApprovalChecks
 * permission or the org restApiBypassesReviews setting), reported via
 * bypassedGates.
 */
export type BulkPublishFlags = {
  /** Acknowledge-class gates: guards, stale-base, warn-mode schema failures. */
  ignoreWarnings: boolean;
  /** Validation-class gates; honored only with bypassApprovalChecks. */
  skipSchemaValidation: boolean;
  /** Custom-hook rejections; honored only with bypassApprovalChecks. */
  skipHooks: boolean;
  /** The org REST-bypass setting applies to this caller (key/PAT, not JWT). */
  restApiBypassesReviews: boolean;
  comment?: string;
};

/** A publish gate attributed to the item that raised it. */
export type BulkPublishGate = PublishGate & {
  entityType: BulkPublishTargetType;
  entityId: string;
  version: number;
};

/**
 * CAS baselines captured at plan time. The commit-phase claim guards on these,
 * so ANY outside change to the revision (content edit, review, discard,
 * competing publish) or entity between planning and claiming fails the claim
 * atomically — optimistic lock-equivalence with nothing to release on a crash.
 */
export type ClaimBaseline = {
  revisionStatus: string;
  revisionDateUpdated: Date;
  entityDateUpdated: Date | null;
};

/** Everything the commit phase needs for one item — no decisions left. */
export type PlannedItemPublish = {
  ref: BulkPublishItemRef;
  /** Live entity doc at plan time; the compensation pre-image. */
  entityPreImage: Record<string, unknown>;
  revision: BulkRevisionRef;
  /** Post-merge changes, adapter-opaque, precomputed and end-state validated. */
  desiredState: Record<string, unknown>;
  /** Post-merge entity doc — the commit-phase write-assert overlay source. */
  proposedEntity: Record<string, unknown>;
  /** False = no-op merge (revision closes as merged, entity untouched). */
  hasChanges: boolean;
  baseline: ClaimBaseline;
  /** True when this publish bypassed approval (recorded on the merge). */
  isApprovalBypass: boolean;
  /** Gates the caller's authority/flags bypassed — the success audit trail. */
  bypassedGates: BypassedGate[];
};

/**
 * The dry-run artifact AND the input to commit — produced by one code path so
 * a dry run can never disagree with a real run. Read-only to produce.
 */
export type BulkPublishPlan = {
  items: PlannedItemPublish[];
  /** Every gate raised across all items, cleared or not (full disclosure). */
  gates: BulkPublishGate[];
  /** Gates the request does NOT clear; commit requires this to be empty. */
  blockingGates: BulkPublishGate[];
  /** Messages from warning-severity gates that flags/authority cleared. */
  warnings: string[];
  flags: BulkPublishFlags;
};

export type BulkPublishItemResult = {
  ref: BulkPublishItemRef;
  status: "published" | "rolled-back" | "not-applied";
  revisionId: string;
};

export type BulkPublishResult = {
  items: BulkPublishItemResult[];
  warnings: string[];
  /** Correlation token stamped on every event this publish emitted. */
  bulkPublishId: string;
};
